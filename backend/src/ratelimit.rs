//! A generic per-user rate limiter - the same "count recent rows in a
//! window" shape auth.rs's login-attempts limiter already used, just not
//! specific to login. Deliberately DB-backed rather than in-memory: this
//! process restarts on every deploy, and an in-memory counter that resets
//! on restart isn't a limit anyone can rely on.

use axum::http::StatusCode;
use axum::Json;
use sqlx::PgPool;

/// Returns `Ok(())` and records this attempt if the caller is under the
/// limit, or `Err(429)` without recording anything if they're not - a
/// request that gets rejected shouldn't also count against a future
/// window, or the limit would never recover once tripped. The error is the
/// same `(StatusCode, Json<Value>)` shape every call site's own handler
/// already returns, so `.map_err`-free - just `?` it directly.
pub async fn check(
    db: &PgPool,
    user_id: i64,
    action: &str,
    max_per_window: i64,
    window_minutes: i32,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM rate_limit_events
         WHERE user_id = $1 AND action = $2 AND created_at > now() - make_interval(mins => $3)",
    )
    .bind(user_id)
    .bind(action)
    .bind(window_minutes)
    .fetch_one(db)
    .await
    .unwrap_or(0);

    if count >= max_per_window {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "error": "You're doing that too often - try again in a bit." })),
        ));
    }

    sqlx::query("INSERT INTO rate_limit_events (user_id, action) VALUES ($1, $2)")
        .bind(user_id)
        .bind(action)
        .execute(db)
        .await
        .ok();

    Ok(())
}
