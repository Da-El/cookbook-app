use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::auth::{AdminUser, CurrentUser};
use crate::state::AppState;
use crate::{guides, ingredients, meals};

/// Every kind of community content that can be flagged. Kept as one list
/// here (mirroring the migration's CHECK constraint) rather than importing
/// it from six different modules, so the valid set is visible in one place.
const CONTENT_TYPES: [&str; 6] =
    ["meal_revision", "review", "ingredient_edit", "alias", "substitute", "guide_edit"];

#[derive(Deserialize)]
pub struct NewFlag {
    pub content_type: String,
    pub content_id: i64,
    pub reason: String,
}

/// Any signed-in user can flag a piece of community content for a human to
/// look at. Voting already handles "most people think this is fine/not" -
/// a flag is for the case that shouldn't wait on a vote count at all
/// (harassment, spam, something actively wrong).
pub async fn create_flag(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<NewFlag>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    // 20 flags/hour is generous for genuine moderation use and tight enough
    // to blunt someone trying to bury the queue.
    crate::ratelimit::check(&state.db, user.id, "flag", 20, 60).await?;

    if !CONTENT_TYPES.contains(&body.content_type.as_str()) {
        return Err(bad("That's not something that can be flagged."));
    }
    let reason = body.reason.trim();
    if reason.is_empty() || reason.chars().count() > 500 {
        return Err(bad("Say a bit about why you're flagging this (up to 500 characters)."));
    }

    let result = sqlx::query(
        "INSERT INTO content_flags (content_type, content_id, reason, flagged_by, flagged_by_name)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&body.content_type)
    .bind(body.content_id)
    .bind(reason)
    .bind(user.id)
    .bind(&user.display_name)
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => Ok(StatusCode::CREATED),
        // The one-open-flag-per-person-per-item index (migration 0012) -
        // repeated flags on the same thing don't raise its priority, so
        // this reads as "already flagged" rather than a real error.
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            Err(bad("You've already flagged this - a moderator will take a look."))
        }
        Err(_) => Err(oops()),
    }
}

#[derive(Serialize)]
pub struct FlagRow {
    pub id: i64,
    pub content_type: String,
    pub content_id: i64,
    pub reason: String,
    pub flagged_by_name: Option<String>,
    pub created_at: DateTime<Utc>,
    /// Short human-readable description of the flagged content itself, so
    /// an admin can judge a flag without opening a second tab.
    pub summary: String,
    pub link: Option<String>,
    /// False when the content was already removed by some other path (the
    /// author deleted their own edit, an alias was withdrawn) between the
    /// flag being raised and a moderator getting to it.
    pub still_exists: bool,
}

/// Admin-only queue of unresolved flags, oldest first (first reported,
/// first reviewed). Each row is hydrated with a preview of the underlying
/// content - the flags table itself is deliberately polymorphic and can't
/// join to six different tables in one query.
pub async fn list_flags(
    State(state): State<AppState>,
    AdminUser(_admin): AdminUser,
) -> Result<Json<Vec<FlagRow>>, StatusCode> {
    let rows: Vec<(i64, String, i64, String, Option<String>, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, content_type, content_id, reason, flagged_by_name, created_at
         FROM content_flags WHERE resolved = FALSE ORDER BY created_at ASC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut out = Vec::with_capacity(rows.len());
    for (id, content_type, content_id, reason, flagged_by_name, created_at) in rows {
        let (summary, link, still_exists) = describe(&state, &content_type, content_id).await;
        out.push(FlagRow { id, content_type, content_id, reason, flagged_by_name, created_at, summary, link, still_exists });
    }
    Ok(Json(out))
}

/// Best-effort preview of the flagged row. Missing content (already deleted
/// or withdrawn some other way) is reported, not treated as an error - the
/// admin still needs to see the flag to resolve (likely dismiss) it.
async fn describe(state: &AppState, content_type: &str, content_id: i64) -> (String, Option<String>, bool) {
    match content_type {
        "meal_revision" => {
            let row: Option<(i64, Option<String>, String)> = sqlx::query_as(
                "SELECT meal_id, editor_name, summary FROM meal_revisions WHERE id = $1",
            )
            .bind(content_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);
            match row {
                Some((meal_id, editor_name, summary)) => (
                    format!("{}: {summary}", editor_name.as_deref().unwrap_or("Someone")),
                    Some(format!("/meals/{meal_id}")),
                    true,
                ),
                None => ("This revision no longer exists.".into(), None, false),
            }
        }
        "review" => {
            let row: Option<(i64, Option<String>, Option<i16>)> = sqlx::query_as(
                "SELECT meal_id, note, score FROM reviews WHERE id = $1 AND is_public",
            )
            .bind(content_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);
            match row {
                Some((meal_id, note, score)) => {
                    let text = note.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "(no written note)".into());
                    let scored = score.map(|s| format!("{s}/10 - ")).unwrap_or_default();
                    (format!("{scored}{text}"), Some(format!("/meals/{meal_id}")), true)
                }
                None => ("This review no longer exists or is already hidden.".into(), None, false),
            }
        }
        "ingredient_edit" => {
            let row: Option<(i64, String, serde_json::Value)> = sqlx::query_as(
                "SELECT ingredient_id, field, value FROM ingredient_edits WHERE id = $1",
            )
            .bind(content_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);
            match row {
                Some((ingredient_id, field, value)) => {
                    let value = value.as_str().map(str::to_string).unwrap_or_else(|| value.to_string());
                    (format!("{field}: {value}"), Some(format!("/ingredients/{ingredient_id}")), true)
                }
                None => ("This edit no longer exists.".into(), None, false),
            }
        }
        "alias" => {
            let row: Option<(i64, String)> = sqlx::query_as(
                "SELECT ingredient_id, name FROM ingredient_aliases WHERE id = $1 AND status = 'live'",
            )
            .bind(content_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);
            match row {
                Some((ingredient_id, name)) => (format!("also called \"{name}\""), Some(format!("/ingredients/{ingredient_id}")), true),
                None => ("This alias is no longer active.".into(), None, false),
            }
        }
        "substitute" => {
            let row: Option<(i64, String, Option<String>)> = sqlx::query_as(
                "SELECT s.ingredient_id, sub.name, s.note
                 FROM ingredient_substitutes s JOIN ingredients sub ON sub.id = s.substitute_id
                 WHERE s.id = $1 AND s.status = 'live'",
            )
            .bind(content_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);
            match row {
                Some((ingredient_id, sub_name, note)) => {
                    let note = note.map(|n| format!(" ({n})")).unwrap_or_default();
                    (format!("substitute: {sub_name}{note}"), Some(format!("/ingredients/{ingredient_id}")), true)
                }
                None => ("This substitute is no longer active.".into(), None, false),
            }
        }
        "guide_edit" => {
            let row: Option<(String, String)> = sqlx::query_as(
                "SELECT g.slug, ge.body FROM guide_edits ge JOIN guides g ON g.id = ge.guide_id WHERE ge.id = $1",
            )
            .bind(content_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);
            match row {
                Some((slug, body)) => {
                    let preview: String = body.chars().take(140).collect();
                    (preview, Some(format!("/guides/{slug}")), true)
                }
                None => ("This suggested edit no longer exists.".into(), None, false),
            }
        }
        _ => ("Unrecognized content.".into(), None, false),
    }
}

#[derive(Deserialize)]
pub struct ResolveFlag {
    pub resolution: String,
}

/// Admin-only: close out a flag. "dismissed" just records the decision;
/// "removed" also performs whatever the right cleanup action is for that
/// content type - each one reuses the same mechanism a regular user would
/// (revert, withdraw, delete-then-recompute-the-winner) rather than a
/// moderation-only code path, so removed content stays consistent with
/// everything else those systems already guarantee.
pub async fn resolve_flag(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(flag_id): Path<i64>,
    Json(body): Json<ResolveFlag>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    if body.resolution != "removed" && body.resolution != "dismissed" {
        return Err(bad("Resolution must be \"removed\" or \"dismissed\"."));
    }

    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    let flag: Option<(String, i64, bool, Option<i64>)> = sqlx::query_as(
        "SELECT content_type, content_id, resolved, flagged_by FROM content_flags WHERE id = $1 FOR UPDATE",
    )
    .bind(flag_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| oops())?;

    let Some((content_type, content_id, already_resolved, flagged_by)) = flag else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Flag not found." }))));
    };
    if already_resolved {
        return Err(bad("That flag has already been resolved."));
    }

    let mut removed_author = None;
    if body.resolution == "removed" {
        removed_author = remove_content(&mut tx, &content_type, content_id, admin.id, &admin.display_name)
            .await
            .map_err(|_| oops())?;
    }

    sqlx::query(
        "UPDATE content_flags SET resolved = TRUE, resolved_by = $1, resolution = $2, resolved_at = now() WHERE id = $3",
    )
    .bind(admin.id)
    .bind(&body.resolution)
    .bind(flag_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| oops())?;

    // Told back to the flagger regardless of which way it went - "removed"
    // vindicates the report, "dismissed" says a human looked and disagreed.
    // No admin_id as actor: this is the system's answer, not a personal one.
    if let Some(flagged_by) = flagged_by {
        sqlx::query("INSERT INTO notifications (recipient_id, actor_id, type) VALUES ($1, NULL, 'flag_resolved')")
            .bind(flagged_by)
            .execute(&mut *tx)
            .await
            .ok();
    }

    tx.commit().await.map_err(|_| oops())?;

    if let Some(author_id) = removed_author {
        crate::notify::send_notification_email(
            &state.db, author_id, "content_removed",
            "Content removed on Cookbook",
            &format!("Your {} was removed by a moderator.", content_type.replace('_', " ")),
        ).await;
    }
    if let Some(flagged_by) = flagged_by {
        crate::notify::send_notification_email(
            &state.db, flagged_by, "flag_resolved",
            "Your flag was resolved on Cookbook",
            &format!("A moderator {} the content you flagged.", if body.resolution == "removed" { "removed" } else { "reviewed and dismissed" }),
        ).await;
    }

    Ok(StatusCode::NO_CONTENT)
}

/// Tells whoever authored the removed content that it's gone - a moderator
/// acting on their work without a word back would just look like it
/// vanished on its own. `author_id` is `None` for content whose author
/// already left (FK `SET NULL`), which is a no-op here, same as everywhere
/// else attribution can go missing.
async fn notify_removed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    author_id: Option<i64>,
    subject_type: Option<&str>,
    subject_id: Option<i64>,
) -> Option<i64> {
    let author_id = author_id?;
    sqlx::query(
        "INSERT INTO notifications (recipient_id, actor_id, type, subject_type, subject_id)
         VALUES ($1, NULL, 'content_removed', $2, $3)",
    )
    .bind(author_id)
    .bind(subject_type)
    .bind(subject_id)
    .execute(&mut **tx)
    .await
    .ok();
    Some(author_id)
}

/// Returns whoever `notify_removed` just notified, if anyone - the caller
/// sends the actual email post-commit, same pattern as `apply_winner` in
/// ingredients.rs/guides.rs and for the same reason (only a transaction is
/// available here, not the pool `send_notification_email` needs).
async fn remove_content(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    content_type: &str,
    content_id: i64,
    admin_id: i64,
    admin_name: &str,
) -> Result<Option<i64>, sqlx::Error> {
    let notified = match content_type {
        "review" => {
            let target: Option<(i64, i64)> =
                sqlx::query_as("SELECT user_id, meal_id FROM reviews WHERE id = $1")
                    .bind(content_id)
                    .fetch_optional(&mut **tx)
                    .await?;
            sqlx::query("UPDATE reviews SET is_public = FALSE WHERE id = $1")
                .bind(content_id)
                .execute(&mut **tx)
                .await?;
            match target {
                Some((user_id, meal_id)) => notify_removed(tx, Some(user_id), Some("meal"), Some(meal_id)).await,
                None => None,
            }
        }
        // Removing a bad revision means undoing exactly the edit it
        // recorded - which is precisely what reverting *to* it does, since
        // a revision snapshots the meal as it looked right before that
        // edit was applied. Same core as the author-facing revert, just
        // authorized differently and worded differently in the trail.
        "meal_revision" => {
            let target: Option<(i64, Option<i64>)> =
                sqlx::query_as("SELECT meal_id, editor_id FROM meal_revisions WHERE id = $1")
                    .bind(content_id)
                    .fetch_optional(&mut **tx)
                    .await?;
            match target {
                Some((meal_id, editor_id)) => {
                    meals::revert_to_revision(tx, meal_id, content_id, admin_id, admin_name, "removed by a moderator")
                        .await?;
                    notify_removed(tx, editor_id, Some("meal"), Some(meal_id)).await
                }
                None => None,
            }
        }
        "ingredient_edit" => {
            let target: Option<(i64, String, Option<i64>)> =
                sqlx::query_as("SELECT ingredient_id, field, author_id FROM ingredient_edits WHERE id = $1")
                    .bind(content_id)
                    .fetch_optional(&mut **tx)
                    .await?;
            match target {
                Some((ingredient_id, field, author_id)) => {
                    sqlx::query("DELETE FROM ingredient_edits WHERE id = $1")
                        .bind(content_id)
                        .execute(&mut **tx)
                        .await?;
                    ingredients::apply_winner(tx, ingredient_id, &field).await?;
                    notify_removed(tx, author_id, Some("ingredient"), Some(ingredient_id)).await
                }
                None => None,
            }
        }
        "alias" => {
            let target: Option<(i64, Option<i64>)> =
                sqlx::query_as("SELECT ingredient_id, author_id FROM ingredient_aliases WHERE id = $1")
                    .bind(content_id)
                    .fetch_optional(&mut **tx)
                    .await?;
            sqlx::query("UPDATE ingredient_aliases SET status = 'withdrawn' WHERE id = $1")
                .bind(content_id)
                .execute(&mut **tx)
                .await?;
            match target {
                Some((ingredient_id, author_id)) => {
                    notify_removed(tx, author_id, Some("ingredient"), Some(ingredient_id)).await
                }
                None => None,
            }
        }
        "substitute" => {
            let target: Option<(i64, Option<i64>)> =
                sqlx::query_as("SELECT ingredient_id, author_id FROM ingredient_substitutes WHERE id = $1")
                    .bind(content_id)
                    .fetch_optional(&mut **tx)
                    .await?;
            sqlx::query("UPDATE ingredient_substitutes SET status = 'withdrawn' WHERE id = $1")
                .bind(content_id)
                .execute(&mut **tx)
                .await?;
            match target {
                Some((ingredient_id, author_id)) => {
                    notify_removed(tx, author_id, Some("ingredient"), Some(ingredient_id)).await
                }
                None => None,
            }
        }
        "guide_edit" => {
            let target: Option<(i64, Option<i64>)> =
                sqlx::query_as("SELECT guide_id, author_id FROM guide_edits WHERE id = $1")
                    .bind(content_id)
                    .fetch_optional(&mut **tx)
                    .await?;
            match target {
                Some((guide_id, author_id)) => {
                    sqlx::query("DELETE FROM guide_edits WHERE id = $1")
                        .bind(content_id)
                        .execute(&mut **tx)
                        .await?;
                    guides::apply_winner(tx, guide_id).await?;
                    // No subject: guides route by slug, not the numeric id here.
                    notify_removed(tx, author_id, None, None).await
                }
                None => None,
            }
        }
        _ => None,
    };
    Ok(notified)
}

fn bad(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg })))
}

fn oops() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Something went wrong." })))
}
