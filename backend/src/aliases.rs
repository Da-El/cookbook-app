//! Community-proposed alternate names for an ingredient.
//!
//! The catalog speaks USDA ("Coriander, leaves, raw"); cooks speak English
//! ("cilantro"). Rather than maintain a synonym table by hand, the people who
//! cook propose the names and vote on them.
//!
//! Two rules keep this from becoming a vandalism surface:
//!
//!   * A proposal does not touch search until it clears `SEARCH_THRESHOLD`.
//!     One account cannot inject a search term on its own say-so.
//!   * Nothing is hard-deleted. Withdrawing sets status='withdrawn' and leaves
//!     the row, so the same name can't be cycled to launder its vote history.
//!
//! Votes are directional, unlike `ingredient_edits`' single undirected toggle:
//! "that name is wrong" needs to be sayable, not merely witholdable.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::CurrentUser;
use crate::state::AppState;

/// Net score an alias needs before search will match on it. Two, not one, so
/// that it takes a second person - the author's own vote can't carry it alone.
pub const SEARCH_THRESHOLD: i32 = 2;

#[derive(Serialize, sqlx::FromRow)]
pub struct AliasRow {
    pub id: i64,
    pub name: String,
    pub author_name: Option<String>,
    /// Net of up and down votes.
    pub score: i32,
    /// How many people weighed in either way - a 0 from thirty voters means
    /// something different from a 0 nobody has looked at.
    pub vote_count: i32,
    /// This viewer's vote: 1, -1, or 0 for none.
    pub your_vote: i32,
    pub is_mine: bool,
    /// Whether this alias is live in search yet. The client shows the
    /// difference rather than implying every proposal already counts.
    pub in_search: bool,
}

#[derive(Deserialize)]
pub struct NewAlias {
    pub name: String,
}

#[derive(Deserialize)]
pub struct AliasVote {
    /// 1 or -1. Repeating your current vote clears it.
    pub value: i16,
}

fn bad(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg })))
}

pub async fn list(
    State(state): State<AppState>,
    user: Option<CurrentUser>,
    Path(ingredient_id): Path<i64>,
) -> Result<Json<Vec<AliasRow>>, StatusCode> {
    let viewer = user.map(|u| u.0.id);
    let rows = sqlx::query_as::<_, AliasRow>(
        "SELECT a.id, a.name, a.author_name, a.score, a.vote_count,
                COALESCE((SELECT v.value FROM alias_votes v
                          WHERE v.alias_id = a.id AND v.user_id = $2), 0)::int4 AS your_vote,
                (a.author_id IS NOT DISTINCT FROM $2) AS is_mine,
                (a.score >= $3) AS in_search
         FROM ingredient_aliases a
         WHERE a.ingredient_id = $1 AND a.status = 'live'
         ORDER BY a.score DESC, a.created_at ASC",
    )
    .bind(ingredient_id)
    .bind(viewer)
    .bind(SEARCH_THRESHOLD)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("list aliases failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(rows))
}

pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(ingredient_id): Path<i64>,
    Json(body): Json<NewAlias>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(bad("Type the other name first."));
    }
    if name.chars().count() > 80 {
        return Err(bad("That's too long for a name - 80 characters at most."));
    }

    let exists: Option<(i64, String)> =
        sqlx::query_as("SELECT id, name FROM ingredients WHERE id = $1")
            .bind(ingredient_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| oops())?;
    let Some((_, canonical)) = exists else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "No such ingredient." }))));
    };
    if canonical.eq_ignore_ascii_case(name) {
        return Err(bad("That's already what it's called here."));
    }

    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    // A resubmission of an existing name is a vote for it, not a second row -
    // otherwise the same alias splits its support across duplicates. A
    // withdrawn one comes back live, since someone is vouching for it again.
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM ingredient_aliases WHERE ingredient_id = $1 AND lower(name) = lower($2)",
    )
    .bind(ingredient_id)
    .bind(name)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| oops())?;

    let alias_id = match existing {
        Some(id) => {
            sqlx::query("UPDATE ingredient_aliases SET status = 'live' WHERE id = $1")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|_| oops())?;
            id
        }
        None => sqlx::query_scalar::<_, i64>(
            "INSERT INTO ingredient_aliases (ingredient_id, name, author_id, author_name)
             VALUES ($1,$2,$3,$4) RETURNING id",
        )
        .bind(ingredient_id)
        .bind(name)
        .bind(user.id)
        .bind(&user.display_name)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| oops())?,
    };

    // Proposing is itself an endorsement, so it counts as the author's +1 -
    // matching how ingredient_edits rows start at one vote.
    sqlx::query(
        "INSERT INTO alias_votes (alias_id, user_id, value) VALUES ($1,$2,1)
         ON CONFLICT (alias_id, user_id) DO UPDATE SET value = 1",
    )
    .bind(alias_id)
    .bind(user.id)
    .execute(&mut *tx)
    .await
    .map_err(|_| oops())?;

    recount(&mut tx, alias_id).await.map_err(|_| oops())?;
    tx.commit().await.map_err(|_| oops())?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({ "id": alias_id }))))
}

pub async fn vote(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((ingredient_id, alias_id)): Path<(i64, i64)>,
    Json(body): Json<AliasVote>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if body.value != 1 && body.value != -1 {
        return Err(StatusCode::BAD_REQUEST);
    }

    // The alias must belong to the ingredient in the path, or the URL becomes a
    // way to vote on any alias in the database by guessing its id.
    let belongs: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM ingredient_aliases WHERE id = $1 AND ingredient_id = $2 AND status = 'live'",
    )
    .bind(alias_id)
    .bind(ingredient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if belongs.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut tx = state.db.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let current: Option<i16> =
        sqlx::query_scalar("SELECT value FROM alias_votes WHERE alias_id = $1 AND user_id = $2")
            .bind(alias_id)
            .bind(user.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Clicking the arrow you already chose takes the vote back - the only way
    // to return to "no opinion" without a third button for it.
    if current == Some(body.value) {
        sqlx::query("DELETE FROM alias_votes WHERE alias_id = $1 AND user_id = $2")
            .bind(alias_id)
            .bind(user.id)
            .execute(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        sqlx::query(
            "INSERT INTO alias_votes (alias_id, user_id, value) VALUES ($1,$2,$3)
             ON CONFLICT (alias_id, user_id) DO UPDATE SET value = EXCLUDED.value",
        )
        .bind(alias_id)
        .bind(user.id)
        .bind(body.value)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    let (score, vote_count) = recount(&mut tx, alias_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Score and count, never the arithmetic behind them: how a vote was
    // weighted is exactly the thing that stays server-side.
    Ok(Json(serde_json::json!({
        "score": score,
        "vote_count": vote_count,
        "your_vote": if current == Some(body.value) { 0 } else { body.value },
        "in_search": score >= SEARCH_THRESHOLD,
    })))
}

/// Author-only withdrawal. Soft, like every other removal in this app.
pub async fn withdraw(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((ingredient_id, alias_id)): Path<(i64, i64)>,
) -> Result<StatusCode, StatusCode> {
    let author: Option<Option<i64>> = sqlx::query_scalar(
        "SELECT author_id FROM ingredient_aliases WHERE id = $1 AND ingredient_id = $2",
    )
    .bind(alias_id)
    .bind(ingredient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    match author {
        None => Err(StatusCode::NOT_FOUND),
        Some(a) if a != Some(user.id) => Err(StatusCode::FORBIDDEN),
        Some(_) => {
            sqlx::query("UPDATE ingredient_aliases SET status = 'withdrawn' WHERE id = $1")
                .bind(alias_id)
                .execute(&state.db)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            Ok(StatusCode::NO_CONTENT)
        }
    }
}

/// Re-derives the cached score/count from the vote rows themselves rather than
/// incrementing, so a miscount can't accumulate across concurrent writes.
///
/// `score` is weighted by each voter's `reputation_weight` (people with a
/// track record of good contributions move the needle a bit more); `vote_count`
/// stays a plain headcount so the UI can still say "6 people voted" honestly
/// rather than a number that mixes people with weight.
async fn recount(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    alias_id: i64,
) -> Result<(i32, i32), sqlx::Error> {
    sqlx::query_as::<_, (i32, i32)>(
        "UPDATE ingredient_aliases SET
           score = COALESCE((SELECT round(sum(value * reputation_weight(user_id)))
                              FROM alias_votes WHERE alias_id = $1), 0),
           vote_count = (SELECT count(*) FROM alias_votes WHERE alias_id = $1)
         WHERE id = $1
         RETURNING score, vote_count",
    )
    .bind(alias_id)
    .fetch_one(&mut **tx)
    .await
}

fn oops() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": "Could not save that name." })),
    )
}
