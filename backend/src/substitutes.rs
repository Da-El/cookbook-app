//! "No X? try Y" - community-proposed substitutions between two different
//! catalog ingredients. See migration 0011 for why this isn't the same table
//! as aliases (a substitute is a different ingredient, not another name for
//! the same one) and why votes are directional here but not on aliases.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::CurrentUser;
use crate::state::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct SubstituteRow {
    pub id: i64,
    pub substitute_id: i64,
    pub substitute_name: String,
    pub note: Option<String>,
    pub author_name: Option<String>,
    pub score: i32,
    pub vote_count: i32,
    pub your_vote: i32,
    pub is_mine: bool,
}

#[derive(Deserialize)]
pub struct NewSubstitute {
    pub substitute_id: i64,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct SubstituteVote {
    pub value: i16,
}

fn bad(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg })))
}
fn oops() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Could not save that." })))
}

pub async fn list(
    State(state): State<AppState>,
    user: Option<CurrentUser>,
    Path(ingredient_id): Path<i64>,
) -> Result<Json<Vec<SubstituteRow>>, StatusCode> {
    let viewer = user.map(|u| u.0.id);
    let rows = sqlx::query_as::<_, SubstituteRow>(
        "SELECT s.id, s.substitute_id, i.name AS substitute_name, s.note, s.author_name,
                s.score, s.vote_count,
                COALESCE((SELECT v.value FROM substitute_votes v
                          WHERE v.substitute_id = s.id AND v.user_id = $2), 0)::int4 AS your_vote,
                (s.author_id IS NOT DISTINCT FROM $2) AS is_mine
         FROM ingredient_substitutes s
         JOIN ingredients i ON i.id = s.substitute_id
         WHERE s.ingredient_id = $1 AND s.status = 'live'
         ORDER BY s.score DESC, s.created_at ASC",
    )
    .bind(ingredient_id)
    .bind(viewer)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("list substitutes failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(rows))
}

pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(ingredient_id): Path<i64>,
    Json(body): Json<NewSubstitute>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    if body.substitute_id == ingredient_id {
        return Err(bad("An ingredient can't substitute for itself."));
    }
    let note = body.note.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if let Some(n) = note {
        if n.chars().count() > 140 {
            return Err(bad("Keep the note under 140 characters."));
        }
    }

    let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM ingredients WHERE id = $1")
        .bind(body.substitute_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| oops())?;
    if exists.is_none() {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "No such ingredient." }))));
    }

    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    // Resubmitting an existing pair is a vote for it, not a duplicate row -
    // same reasoning as aliases.rs's create(). A withdrawn one comes back
    // live, and its note is refreshed to whatever was just proposed.
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM ingredient_substitutes WHERE ingredient_id = $1 AND substitute_id = $2",
    )
    .bind(ingredient_id)
    .bind(body.substitute_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| oops())?;

    let sub_id = match existing {
        Some(id) => {
            sqlx::query("UPDATE ingredient_substitutes SET status = 'live', note = COALESCE($2, note) WHERE id = $1")
                .bind(id)
                .bind(note)
                .execute(&mut *tx)
                .await
                .map_err(|_| oops())?;
            id
        }
        None => sqlx::query_scalar::<_, i64>(
            "INSERT INTO ingredient_substitutes (ingredient_id, substitute_id, note, author_id, author_name)
             VALUES ($1,$2,$3,$4,$5) RETURNING id",
        )
        .bind(ingredient_id)
        .bind(body.substitute_id)
        .bind(note)
        .bind(user.id)
        .bind(&user.display_name)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            if let sqlx::Error::Database(db) = &e {
                if db.is_unique_violation() {
                    return bad("That substitution has already been suggested.");
                }
            }
            oops()
        })?,
    };

    sqlx::query(
        "INSERT INTO substitute_votes (substitute_id, user_id, value) VALUES ($1,$2,1)
         ON CONFLICT (substitute_id, user_id) DO UPDATE SET value = 1",
    )
    .bind(sub_id)
    .bind(user.id)
    .execute(&mut *tx)
    .await
    .map_err(|_| oops())?;

    recount(&mut tx, sub_id).await.map_err(|_| oops())?;
    tx.commit().await.map_err(|_| oops())?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({ "id": sub_id }))))
}

pub async fn vote(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((ingredient_id, sub_id)): Path<(i64, i64)>,
    Json(body): Json<SubstituteVote>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if body.value != 1 && body.value != -1 {
        return Err(StatusCode::BAD_REQUEST);
    }

    let belongs: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM ingredient_substitutes WHERE id = $1 AND ingredient_id = $2 AND status = 'live'",
    )
    .bind(sub_id)
    .bind(ingredient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if belongs.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut tx = state.db.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let current: Option<i16> =
        sqlx::query_scalar("SELECT value FROM substitute_votes WHERE substitute_id = $1 AND user_id = $2")
            .bind(sub_id)
            .bind(user.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if current == Some(body.value) {
        sqlx::query("DELETE FROM substitute_votes WHERE substitute_id = $1 AND user_id = $2")
            .bind(sub_id)
            .bind(user.id)
            .execute(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        sqlx::query(
            "INSERT INTO substitute_votes (substitute_id, user_id, value) VALUES ($1,$2,$3)
             ON CONFLICT (substitute_id, user_id) DO UPDATE SET value = EXCLUDED.value",
        )
        .bind(sub_id)
        .bind(user.id)
        .bind(body.value)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    let (score, vote_count) = recount(&mut tx, sub_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({
        "score": score,
        "vote_count": vote_count,
        "your_vote": if current == Some(body.value) { 0 } else { body.value },
    })))
}

pub async fn withdraw(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((ingredient_id, sub_id)): Path<(i64, i64)>,
) -> Result<StatusCode, StatusCode> {
    let author: Option<Option<i64>> = sqlx::query_scalar(
        "SELECT author_id FROM ingredient_substitutes WHERE id = $1 AND ingredient_id = $2",
    )
    .bind(sub_id)
    .bind(ingredient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    match author {
        None => Err(StatusCode::NOT_FOUND),
        Some(a) if a != Some(user.id) => Err(StatusCode::FORBIDDEN),
        Some(_) => {
            sqlx::query("UPDATE ingredient_substitutes SET status = 'withdrawn' WHERE id = $1")
                .bind(sub_id)
                .execute(&state.db)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            Ok(StatusCode::NO_CONTENT)
        }
    }
}

async fn recount(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    sub_id: i64,
) -> Result<(i32, i32), sqlx::Error> {
    sqlx::query_as::<_, (i32, i32)>(
        "UPDATE ingredient_substitutes SET
           score = COALESCE((SELECT round(sum(value * reputation_weight(user_id)))
                              FROM substitute_votes WHERE substitute_id = $1), 0),
           vote_count = (SELECT count(*) FROM substitute_votes WHERE substitute_id = $1)
         WHERE id = $1
         RETURNING score, vote_count",
    )
    .bind(sub_id)
    .fetch_one(&mut **tx)
    .await
}
