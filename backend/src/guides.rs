//! Beginner guides: short technique explainers, seeded as content rather than
//! hard-coded into the frontend so they can be edited without a deploy.
//!
//! Ranking here is deliberately NOT re-sorted by helpfulness the way meals
//! are: `position` is a curator-set reading order within a topic (a syllabus,
//! not a leaderboard), so `helpful_count` is surfaced as a trust signal
//! alongside it rather than used to reorder the list out from under a
//! deliberate "read this before that" sequence.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::CurrentUser;
use crate::state::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct GuideSummary {
    pub id: i64,
    pub slug: String,
    pub title: String,
    pub summary: String,
    pub topic: String,
    pub minutes: Option<i32>,
    pub helpful_count: i32,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct GuideDetail {
    pub id: i64,
    pub slug: String,
    pub title: String,
    pub summary: String,
    pub body: String,
    pub topic: String,
    pub minutes: Option<i32>,
    pub helpful_count: i32,
    pub your_helpful_vote: bool,
}

pub async fn list(State(state): State<AppState>) -> Result<Json<Vec<GuideSummary>>, StatusCode> {
    let rows = sqlx::query_as::<_, GuideSummary>(
        "SELECT id, slug, title, summary, topic, minutes, helpful_count
         FROM guides ORDER BY topic, position, title",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("list guides failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(rows))
}

pub async fn detail(
    State(state): State<AppState>,
    user: Option<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<Json<GuideDetail>, StatusCode> {
    let viewer = user.map(|u| u.0.id);
    sqlx::query_as::<_, GuideDetail>(
        "SELECT id, slug, title, summary, body, topic, minutes, helpful_count,
                EXISTS (SELECT 1 FROM guide_votes v
                        WHERE v.guide_id = guides.id AND v.user_id = $2) AS your_helpful_vote
         FROM guides WHERE slug = $1",
    )
    .bind(&slug)
    .bind(viewer)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map(Json)
    .ok_or(StatusCode::NOT_FOUND)
}

/// Toggle-only, identical shape to a review's helpful vote (migration 0008).
pub async fn vote_helpful(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(slug): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let guide_id: Option<i64> = sqlx::query_scalar("SELECT id FROM guides WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some(guide_id) = guide_id else { return Err(StatusCode::NOT_FOUND) };

    let mut tx = state.db.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let removed = sqlx::query("DELETE FROM guide_votes WHERE guide_id = $1 AND user_id = $2")
        .bind(guide_id)
        .bind(user.id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected();

    if removed == 0 {
        sqlx::query("INSERT INTO guide_votes (guide_id, user_id) VALUES ($1,$2)")
            .bind(guide_id)
            .bind(user.id)
            .execute(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    let count: i32 = sqlx::query_scalar(
        "UPDATE guides SET helpful_count = (SELECT count(*) FROM guide_votes WHERE guide_id = $1)
         WHERE id = $1 RETURNING helpful_count",
    )
    .bind(guide_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "helpful_count": count, "your_helpful_vote": removed == 0 })))
}

/// Meals whose full-text vector matches the guide's own title/topic words - a
/// loose, honestly-labeled suggestion ("might help you practice this"), not a
/// curated link, since nobody has actually authored guide-to-recipe
/// associations. Reuses meals' own search_vector, so it degrades to nothing
/// rather than a wrong match when the words don't overlap.
#[derive(Serialize, sqlx::FromRow)]
pub struct RelatedMeal {
    pub id: i64,
    pub name: String,
    pub cuisine: String,
    pub photo_url: Option<String>,
}

pub async fn related_meals(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Vec<RelatedMeal>>, StatusCode> {
    let words: Option<(String, String)> = sqlx::query_as("SELECT title, topic FROM guides WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some((title, topic)) = words else { return Err(StatusCode::NOT_FOUND) };

    let rows = sqlx::query_as::<_, RelatedMeal>(
        "SELECT id, name, cuisine, photo_url FROM meals
         WHERE visibility = 'public' AND status = 'live'
           AND search_vector @@ plainto_tsquery('english', $1)
         ORDER BY ranked_score DESC LIMIT 4",
    )
    .bind(format!("{title} {topic}"))
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("related meals failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(rows))
}

// ============ COMMUNITY EDITS TO A GUIDE'S BODY ============
//
// Same propose/vote/materialize shape as ingredient_edits' `description`
// field, kept as a separate table (see migration 0010's comment) rather than
// reusing that one, which is keyed to an ingredient.

#[derive(Deserialize)]
pub struct SubmitGuideEdit {
    pub body: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct GuideEditRow {
    pub id: i64,
    pub body: String,
    pub author_name: Option<String>,
    pub author_id: Option<i64>,
    pub votes: i32,
    pub voted_by_me: bool,
    pub is_mine: bool,
}

pub async fn list_edits(
    State(state): State<AppState>,
    viewer: Option<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<Json<Vec<GuideEditRow>>, StatusCode> {
    let guide_id: Option<i64> = sqlx::query_scalar("SELECT id FROM guides WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some(guide_id) = guide_id else { return Err(StatusCode::NOT_FOUND) };
    let viewer_id = viewer.map(|u| u.0.id);

    let rows = sqlx::query_as::<_, GuideEditRow>(
        "SELECT e.id, e.body, e.author_name, e.author_id, e.votes,
                EXISTS (SELECT 1 FROM guide_edit_votes v WHERE v.user_id = $2 AND v.edit_id = e.id) AS voted_by_me,
                COALESCE(e.author_id = $2, false) AS is_mine
         FROM guide_edits e
         WHERE e.guide_id = $1
         ORDER BY e.votes DESC, e.id ASC",
    )
    .bind(guide_id)
    .bind(viewer_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

pub async fn submit_edit(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(slug): Path<String>,
    Json(body): Json<SubmitGuideEdit>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let text = body.body.trim();
    if text.is_empty() {
        return Err(bad("A guide can't be edited down to nothing."));
    }

    let guide_id: Option<i64> = sqlx::query_scalar("SELECT id FROM guides WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| oops())?;
    let Some(guide_id) = guide_id else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "No such guide." }))));
    };

    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    let edit_id: i64 = sqlx::query_scalar(
        "INSERT INTO guide_edits (guide_id, body, author_id, author_name, votes)
         VALUES ($1,$2,$3,$4,1) RETURNING id",
    )
    .bind(guide_id)
    .bind(text)
    .bind(user.id)
    .bind(&user.display_name)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| oops())?;

    sqlx::query("INSERT INTO guide_edit_votes (user_id, edit_id) VALUES ($1,$2)")
        .bind(user.id)
        .bind(edit_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| oops())?;

    let newly_won = apply_winner(&mut tx, guide_id).await.map_err(|_| oops())?;
    tx.commit().await.map_err(|_| oops())?;
    notify_edit_won(&state, newly_won, guide_id).await;

    Ok(StatusCode::CREATED)
}

pub async fn vote_edit(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((_slug, edit_id)): Path<(String, i64)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let guide_id: Option<i64> = sqlx::query_scalar("SELECT guide_id FROM guide_edits WHERE id = $1")
        .bind(edit_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some(guide_id) = guide_id else { return Err(StatusCode::NOT_FOUND) };

    let mut tx = state.db.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let removed = sqlx::query("DELETE FROM guide_edit_votes WHERE user_id = $1 AND edit_id = $2")
        .bind(user.id)
        .bind(edit_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected();

    if removed == 0 {
        sqlx::query("INSERT INTO guide_edit_votes (user_id, edit_id) VALUES ($1,$2)")
            .bind(user.id)
            .bind(edit_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    sqlx::query(
        "UPDATE guide_edits SET votes = (SELECT count(*) FROM guide_edit_votes WHERE edit_id = $1) WHERE id = $1",
    )
    .bind(edit_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let newly_won = apply_winner(&mut tx, guide_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    notify_edit_won(&state, newly_won, guide_id).await;

    Ok(Json(serde_json::json!({ "voted": removed == 0 })))
}

/// Best-effort email for whoever's edit `apply_winner` just crowned - see
/// ingredients.rs's `notify_edit_won` for why this happens post-commit here
/// rather than inside `apply_winner` itself.
async fn notify_edit_won(state: &AppState, newly_won_author: Option<i64>, guide_id: i64) {
    let Some(author_id) = newly_won_author else { return };
    let title: Option<String> = sqlx::query_scalar("SELECT title FROM guides WHERE id = $1")
        .bind(guide_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    let title = title.unwrap_or_else(|| "a guide".to_string());
    crate::notify::send_notification_email(
        &state.db, author_id, "edit_won",
        "Your edit was approved on Cookbook",
        &format!("Your proposed edit to \"{}\" is now the community-approved version.", title),
    ).await;
}

/// Author-only withdrawal, same as ingredients.rs's `delete_edit`.
pub async fn delete_edit(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((_slug, edit_id)): Path<(String, i64)>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    let row: Option<(Option<i64>, i64)> =
        sqlx::query_as("SELECT author_id, guide_id FROM guide_edits WHERE id = $1")
            .bind(edit_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| oops())?;
    let Some((author_id, guide_id)) = row else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Not found." }))));
    };
    if author_id != Some(user.id) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "You can only delete your own submission." })),
        ));
    }

    sqlx::query("DELETE FROM guide_edits WHERE id = $1")
        .bind(edit_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| oops())?;

    let newly_won = apply_winner(&mut tx, guide_id).await.map_err(|_| oops())?;
    tx.commit().await.map_err(|_| oops())?;
    notify_edit_won(&state, newly_won, guide_id).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Highest votes wins, ties to the oldest edit - same rule as ingredients.rs's
/// `apply_winner`. No edits left just means the guide's own seeded body
/// stands: unlike description/photo, there's no "blank" fallback for a
/// guide's teaching content.
/// Returns the winning edit's author when this call is the one that just
/// made them the winner, same contract as ingredients.rs's `apply_winner`.
pub(crate) async fn apply_winner(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    guide_id: i64,
) -> Result<Option<i64>, sqlx::Error> {
    let winner: Option<(i64, Option<i64>, String)> = sqlx::query_as(
        "SELECT id, author_id, body FROM guide_edits WHERE guide_id = $1 ORDER BY votes DESC, id ASC LIMIT 1",
    )
    .bind(guide_id)
    .fetch_optional(&mut **tx)
    .await?;

    let mut newly_won_author = None;
    if let Some((edit_id, author_id, body)) = winner {
        sqlx::query("UPDATE guides SET body = $1 WHERE id = $2")
            .bind(body)
            .bind(guide_id)
            .execute(&mut **tx)
            .await?;

        // No linkable subject: guides are routed by slug, not the numeric id
        // notifications carry, so this is copy-only, same as new_follower.
        let newly_won: Option<bool> = sqlx::query_scalar(
            "UPDATE guide_edits SET notified_win = true WHERE id = $1 AND notified_win = false RETURNING true",
        )
        .bind(edit_id)
        .fetch_optional(&mut **tx)
        .await?;
        if newly_won.is_some() {
            if let Some(author_id) = author_id {
                sqlx::query(
                    "INSERT INTO notifications (recipient_id, actor_id, type) VALUES ($1, NULL, 'edit_won')",
                )
                .bind(author_id)
                .execute(&mut **tx)
                .await
                .ok();
                newly_won_author = Some(author_id);
            }
        }
    }
    Ok(newly_won_author)
}

fn bad(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg })))
}
fn oops() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Could not save that." })))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct GuideComment {
    pub id: i64,
    /// NULL for a former user whose account was deleted (FK `SET NULL`) -
    /// still shown with their name at the time, just not linkable.
    pub user_id: Option<i64>,
    pub author_name: String,
    pub body: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list_comments(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Vec<GuideComment>>, StatusCode> {
    sqlx::query_as::<_, GuideComment>(
        "SELECT c.id, c.user_id, c.author_name, c.body, c.created_at
         FROM guide_comments c JOIN guides g ON g.id = c.guide_id
         WHERE g.slug = $1
         ORDER BY c.created_at",
    )
    .bind(slug)
    .fetch_all(&state.db)
    .await
    .map(Json)
    .map_err(|e| {
        tracing::error!("list guide comments failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

#[derive(Deserialize)]
pub struct NewComment {
    pub body: String,
}

pub async fn create_comment(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(slug): Path<String>,
    Json(body): Json<NewComment>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    crate::ratelimit::check(&state.db, user.id, "guide_comment", 20, 10).await?;

    let text = body.body.trim();
    if text.is_empty() || text.chars().count() > 1000 {
        return Err(bad("Say something between 1 and 1000 characters."));
    }

    let guide_id: Option<i64> = sqlx::query_scalar("SELECT id FROM guides WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| oops())?;
    let Some(guide_id) = guide_id else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "No such guide." }))));
    };

    let comment_id: i64 = sqlx::query_scalar(
        "INSERT INTO guide_comments (guide_id, user_id, author_name, body) VALUES ($1,$2,$3,$4) RETURNING id",
    )
    .bind(guide_id)
    .bind(user.id)
    .bind(&user.display_name)
    .bind(text)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("create guide comment failed: {e}");
        oops()
    })?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({ "id": comment_id }))))
}

/// Author-only: withdraw your own comment. Plain hard delete, same
/// "closer to a chat message than catalog content" reasoning as
/// review_replies - no edit history worth preserving for a comment thread.
pub async fn delete_comment(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((_slug, comment_id)): Path<(String, i64)>,
) -> Result<StatusCode, StatusCode> {
    let deleted = sqlx::query("DELETE FROM guide_comments WHERE id = $1 AND user_id = $2")
        .bind(comment_id)
        .bind(user.id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected();

    if deleted == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}
