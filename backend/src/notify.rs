use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;

use crate::auth::CurrentUser;
use crate::state::AppState;

/// Every notification type the app can raise, in the order Settings shows
/// them - `(type key stored in `notifications.type`/`notification_email_prefs.type`,
/// label, description)`. Kept in one place so the settings screen and the
/// email-gating check below can never drift out of sync with what actually
/// gets inserted at each call site.
pub const NOTIFICATION_TYPES: &[(&str, &str, &str)] = &[
    ("new_follower", "New followers", "When someone starts following you"),
    ("meal_cooked", "Recipe cooked", "When someone cooks one of your recipes"),
    ("meal_saved", "Recipe saved", "When someone saves one of your recipes"),
    ("edit_won", "Edit approved", "When a proposed edit you voted in wins"),
    ("review_reply", "Review replies", "When someone replies to your review"),
    ("content_removed", "Content removed", "When a moderator removes something you made"),
    ("flag_resolved", "Flag resolved", "When a flag you filed gets resolved"),
];

/// Best-effort: checks this recipient's opt-in for `kind`, and if it's on,
/// looks up their address and sends. Takes the pool directly rather than a
/// generic executor - every call site already has `&state.db` in scope, and
/// email is a side effect that doesn't need to share a transaction with the
/// notification row it rides along with (same "fire and don't block on it"
/// spirit as the `.ok()` on every `INSERT INTO notifications` already has).
pub async fn send_notification_email(pool: &sqlx::PgPool, recipient_id: i64, kind: &str, subject: &str, body: &str) {
    let enabled: Option<bool> = sqlx::query_scalar(
        "SELECT enabled FROM notification_email_prefs WHERE user_id = $1 AND type = $2",
    )
    .bind(recipient_id)
    .bind(kind)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    // No row = never opted in - the default this table exists to express.
    if enabled != Some(true) {
        return;
    }

    let to: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(recipient_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

    if let Some(to) = to {
        crate::email::send(&to, subject, body).await;
    }
}

#[derive(Serialize)]
pub struct NotificationPref {
    #[serde(rename = "type")]
    kind: &'static str,
    label: &'static str,
    description: &'static str,
    email_enabled: bool,
}

/// The full set of types with this viewer's current opt-in state merged in -
/// a type nobody has ever toggled just reads as `false`, matching the
/// opt-in-only semantics `notification_email_prefs` actually has.
pub async fn list_prefs(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<NotificationPref>>, StatusCode> {
    let enabled_types: Vec<String> = sqlx::query_scalar(
        "SELECT type FROM notification_email_prefs WHERE user_id = $1 AND enabled = true",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let prefs = NOTIFICATION_TYPES
        .iter()
        .map(|&(kind, label, description)| NotificationPref {
            kind,
            label,
            description,
            email_enabled: enabled_types.iter().any(|t| t == kind),
        })
        .collect();

    Ok(Json(prefs))
}

#[derive(serde::Deserialize)]
pub struct SetPref {
    pub enabled: bool,
}

pub async fn set_pref(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(kind): Path<String>,
    Json(body): Json<SetPref>,
) -> Result<StatusCode, StatusCode> {
    if !NOTIFICATION_TYPES.iter().any(|&(k, _, _)| k == kind) {
        return Err(StatusCode::BAD_REQUEST);
    }

    sqlx::query(
        "INSERT INTO notification_email_prefs (user_id, type, enabled) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, type) DO UPDATE SET enabled = EXCLUDED.enabled",
    )
    .bind(user.id)
    .bind(&kind)
    .bind(body.enabled)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::NO_CONTENT)
}
