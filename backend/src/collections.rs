use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::CurrentUser;
use crate::state::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct CollectionRow {
    pub id: i64,
    pub name: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub meal_count: i64,
    /// Every meal id currently in the collection - collections stay small
    /// in practice, so sending the whole set means an "add to collection"
    /// picker elsewhere in the app can show what's already in each one
    /// without a second round trip per collection.
    pub meal_ids: Vec<i64>,
    pub is_public: bool,
}

/// Always the caller's own, public or private alike - this is the owner's
/// management view, not the public-facing one (see `detail` for that).
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<CollectionRow>>, StatusCode> {
    let rows = sqlx::query_as::<_, CollectionRow>(
        "SELECT c.id, c.name, c.created_at, c.is_public,
                count(i.meal_id) AS meal_count,
                COALESCE(array_agg(i.meal_id) FILTER (WHERE i.meal_id IS NOT NULL), '{}') AS meal_ids
         FROM meal_collections c
         LEFT JOIN meal_collection_items i ON i.collection_id = c.id
         WHERE c.user_id = $1
         GROUP BY c.id
         ORDER BY c.created_at DESC",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct NewCollection {
    pub name: String,
}

pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<NewCollection>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err(bad("Give it a name, up to 60 characters."));
    }

    let id: i64 = sqlx::query_scalar("INSERT INTO meal_collections (user_id, name) VALUES ($1,$2) RETURNING id")
        .bind(user.id)
        .bind(name)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("create collection failed: {e}");
            oops()
        })?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({ "id": id }))))
}

#[derive(Deserialize)]
pub struct SetVisibility {
    pub is_public: bool,
}

pub async fn set_visibility(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<SetVisibility>,
) -> Result<StatusCode, StatusCode> {
    let updated = sqlx::query("UPDATE meal_collections SET is_public = $1 WHERE id = $2 AND user_id = $3")
        .bind(body.is_public)
        .bind(id)
        .bind(user.id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected();

    if updated == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    let deleted = sqlx::query("DELETE FROM meal_collections WHERE id = $1 AND user_id = $2")
        .bind(id)
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

#[derive(Serialize, sqlx::FromRow)]
pub struct CollectionMeal {
    pub id: i64,
    pub name: String,
    pub cuisine: String,
    pub time_minutes: i32,
    pub rating: f64,
    pub photo_url: Option<String>,
}

#[derive(Serialize)]
pub struct CollectionDetail {
    pub id: i64,
    pub name: String,
    pub meals: Vec<CollectionMeal>,
    pub is_public: bool,
    pub is_mine: bool,
    pub owner_name: String,
}

/// Optional auth at the API level - the frontend router still gates every
/// page but /legal behind sign-in, so "public" in practice means "any
/// signed-in Cookbook user with the link," not the open internet. The API
/// itself doesn't need to enforce that routing choice, so this stays
/// permissive rather than baking the frontend's decision in twice. A
/// private collection still 404s for everyone except its owner - same
/// "don't even reveal it exists" choice the rest of this app makes for
/// private content, rather than a 403 that confirms something is there.
pub async fn detail(
    State(state): State<AppState>,
    viewer: Option<CurrentUser>,
    Path(id): Path<i64>,
) -> Result<Json<CollectionDetail>, StatusCode> {
    let viewer_id = viewer.map(|u| u.0.id);
    let row: Option<(String, i64, bool, String)> = sqlx::query_as(
        "SELECT c.name, c.user_id, c.is_public, u.display_name
         FROM meal_collections c JOIN users u ON u.id = c.user_id
         WHERE c.id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some((name, owner_id, is_public, owner_name)) = row else { return Err(StatusCode::NOT_FOUND) };

    let is_mine = viewer_id == Some(owner_id);
    if !is_public && !is_mine {
        return Err(StatusCode::NOT_FOUND);
    }

    // A meal soft-deleted after being added just quietly drops out of the
    // list here - same "collections aren't the source of truth" reasoning
    // as saved_meals/cooked_meals already follow elsewhere.
    let meals = sqlx::query_as::<_, CollectionMeal>(
        "SELECT m.id, m.name, m.cuisine, m.time_minutes, m.rating::float8 AS rating, m.photo_url
         FROM meal_collection_items i JOIN meals m ON m.id = i.meal_id
         WHERE i.collection_id = $1 AND m.status = 'live'
         ORDER BY i.added_at DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(CollectionDetail { id, name, meals, is_public, is_mine, owner_name }))
}

#[derive(Deserialize)]
pub struct AddMeal {
    pub meal_id: i64,
}

pub async fn add_meal(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<AddMeal>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let owns: Option<i64> = sqlx::query_scalar("SELECT id FROM meal_collections WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user.id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| oops())?;
    if owns.is_none() {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Collection not found." }))));
    }

    sqlx::query("INSERT INTO meal_collection_items (collection_id, meal_id) VALUES ($1,$2) ON CONFLICT DO NOTHING")
        .bind(id)
        .bind(body.meal_id)
        .execute(&state.db)
        .await
        .map_err(|_| oops())?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_meal(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((id, meal_id)): Path<(i64, i64)>,
) -> Result<StatusCode, StatusCode> {
    let deleted = sqlx::query(
        "DELETE FROM meal_collection_items i USING meal_collections c
         WHERE i.collection_id = c.id AND c.id = $1 AND c.user_id = $2 AND i.meal_id = $3",
    )
    .bind(id)
    .bind(user.id)
    .bind(meal_id)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .rows_affected();

    if deleted == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

fn bad(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg })))
}

fn oops() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Something went wrong." })))
}
