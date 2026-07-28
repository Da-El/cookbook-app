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
    pub cover_photo_url: Option<String>,
}

/// Always the caller's own, public or private alike - this is the owner's
/// management view, not the public-facing one (see `detail` for that).
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<CollectionRow>>, StatusCode> {
    let rows = sqlx::query_as::<_, CollectionRow>(
        "SELECT c.id, c.name, c.created_at, c.is_public, c.cover_photo_url,
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

#[derive(Deserialize)]
pub struct SetCover {
    /// `None`/omitted clears the cover, falling back to whatever the
    /// detail page shows in its absence (the same "no photo" state a
    /// brand-new collection already starts in).
    pub photo_url: Option<String>,
}

pub async fn set_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<SetCover>,
) -> Result<StatusCode, StatusCode> {
    let updated = sqlx::query("UPDATE meal_collections SET cover_photo_url = $1 WHERE id = $2 AND user_id = $3")
        .bind(body.photo_url.as_deref())
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
    pub follower_count: i64,
    /// Always false for the owner - following your own collection is a
    /// no-op the UI doesn't offer (see `toggle_follow`).
    pub is_following: bool,
    pub cover_photo_url: Option<String>,
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
    let row: Option<(String, i64, bool, String, Option<String>)> = sqlx::query_as(
        "SELECT c.name, c.user_id, c.is_public, u.display_name, c.cover_photo_url
         FROM meal_collections c JOIN users u ON u.id = c.user_id
         WHERE c.id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some((name, owner_id, is_public, owner_name, cover_photo_url)) = row else {
        return Err(StatusCode::NOT_FOUND);
    };

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
         ORDER BY i.position, i.meal_id",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let follower_count: i64 = sqlx::query_scalar("SELECT count(*) FROM collection_follows WHERE collection_id = $1")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let is_following = match viewer_id {
        Some(v) if !is_mine => {
            sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM collection_follows WHERE collection_id = $1 AND user_id = $2)",
            )
            .bind(id)
            .bind(v)
            .fetch_one(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        }
        _ => false,
    };

    Ok(Json(CollectionDetail {
        id, name, meals, is_public, is_mine, owner_name, follower_count, is_following, cover_photo_url,
    }))
}

/// Public collections the caller follows - the counterpart to `list()`'s
/// "my own collections" view, for a "Following" section elsewhere in the
/// Cookbook. Unlike `list()` this can't assume the viewer owns every row,
/// so it carries `owner_name` the way `detail()` does.
#[derive(Serialize, sqlx::FromRow)]
pub struct FollowedCollectionRow {
    pub id: i64,
    pub name: String,
    pub owner_name: String,
    pub meal_count: i64,
    pub cover_photo_url: Option<String>,
}

pub async fn list_followed(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<FollowedCollectionRow>>, StatusCode> {
    let rows = sqlx::query_as::<_, FollowedCollectionRow>(
        "SELECT c.id, c.name, u.display_name AS owner_name, c.cover_photo_url,
                (SELECT count(*) FROM meal_collection_items i WHERE i.collection_id = c.id) AS meal_count
         FROM collection_follows f
         JOIN meal_collections c ON c.id = f.collection_id
         JOIN users u ON u.id = c.user_id
         WHERE f.user_id = $1 AND c.is_public = TRUE
         ORDER BY f.created_at DESC",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

/// Author-only visibility is a separate switch from following: turning a
/// collection private again doesn't un-follow anyone, it just means
/// `detail()` (and thus `list_followed`'s `is_public = TRUE` filter) stops
/// showing it to them until it's public again - same as a blocked/unfollowed
/// meal author's existing content doesn't retroactively delete anything.
pub async fn toggle_follow(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let row: Option<(i64, bool)> = sqlx::query_as("SELECT user_id, is_public FROM meal_collections WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| oops())?;
    let Some((owner_id, is_public)) = row else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Collection not found." }))));
    };
    if owner_id == user.id {
        return Err(bad("You can't follow your own collection."));
    }
    if !is_public {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Collection not found." }))));
    }

    let deleted = sqlx::query("DELETE FROM collection_follows WHERE collection_id = $1 AND user_id = $2")
        .bind(id)
        .bind(user.id)
        .execute(&state.db)
        .await
        .map_err(|_| oops())?
        .rows_affected();

    if deleted == 0 {
        sqlx::query("INSERT INTO collection_follows (collection_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING")
            .bind(id)
            .bind(user.id)
            .execute(&state.db)
            .await
            .map_err(|_| oops())?;
    }

    Ok(Json(serde_json::json!({ "following": deleted == 0 })))
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
    let owned: Option<(String, bool)> =
        sqlx::query_as("SELECT name, is_public FROM meal_collections WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| oops())?;
    let Some((collection_name, is_public)) = owned else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Collection not found." }))));
    };

    // Lands after every existing meal in the collection, same appending
    // logic as `planner::add_plan_entry`'s position assignment.
    let inserted = sqlx::query(
        "INSERT INTO meal_collection_items (collection_id, meal_id, position)
         VALUES ($1,$2, COALESCE((SELECT max(position) + 1 FROM meal_collection_items WHERE collection_id = $1), 0))
         ON CONFLICT DO NOTHING",
    )
    .bind(id)
    .bind(body.meal_id)
    .execute(&state.db)
    .await
    .map_err(|_| oops())?
    .rows_affected()
        > 0;

    // Only a genuinely new addition to a public collection is worth telling
    // followers about - a no-op re-add (already in the collection) or a
    // private collection's followers (there are none, `toggle_follow`
    // refuses those) never reaches here.
    if inserted && is_public {
        let meal_name: Option<String> = sqlx::query_scalar("SELECT name FROM meals WHERE id = $1")
            .bind(body.meal_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| oops())?;
        if let Some(meal_name) = meal_name {
            let followers: Vec<i64> = sqlx::query_scalar("SELECT user_id FROM collection_follows WHERE collection_id = $1")
                .bind(id)
                .fetch_all(&state.db)
                .await
                .map_err(|_| oops())?;
            for follower_id in followers {
                sqlx::query(
                    "INSERT INTO notifications (recipient_id, actor_id, type, subject_type, subject_id)
                     VALUES ($1, $2, 'collection_meal_added', 'collection', $3)",
                )
                .bind(follower_id)
                .bind(user.id)
                .bind(id)
                .execute(&state.db)
                .await
                .ok();
                crate::notify::send_notification_email(
                    &state.db,
                    follower_id,
                    "collection_meal_added",
                    "New recipe in a collection you follow",
                    &format!("\"{meal_name}\" was just added to \"{collection_name}\" on Cookbook."),
                )
                .await;
            }
        }
    }

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

#[derive(Deserialize)]
pub struct MoveMeal {
    pub direction: String,
}

/// Owner-only reorder within a collection - swaps position with the
/// adjacent sibling, same shape as `planner::move_plan_entry`. A no-op
/// (still 204) at either edge of the list.
pub async fn move_meal(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((id, meal_id)): Path<(i64, i64)>,
    Json(b): Json<MoveMeal>,
) -> Result<StatusCode, StatusCode> {
    if b.direction != "up" && b.direction != "down" {
        return Err(StatusCode::BAD_REQUEST);
    }

    let mut tx = state.db.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let position: Option<i32> = sqlx::query_scalar(
        "SELECT i.position FROM meal_collection_items i JOIN meal_collections c ON c.id = i.collection_id
         WHERE i.collection_id = $1 AND i.meal_id = $2 AND c.user_id = $3",
    )
    .bind(id)
    .bind(meal_id)
    .bind(user.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some(position) = position else { return Err(StatusCode::NOT_FOUND) };

    let neighbor_sql = if b.direction == "up" {
        "SELECT meal_id, position FROM meal_collection_items
         WHERE collection_id = $1 AND position < $2 ORDER BY position DESC LIMIT 1"
    } else {
        "SELECT meal_id, position FROM meal_collection_items
         WHERE collection_id = $1 AND position > $2 ORDER BY position ASC LIMIT 1"
    };
    let neighbor: Option<(i64, i32)> = sqlx::query_as(neighbor_sql)
        .bind(id)
        .bind(position)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Some((neighbor_meal_id, neighbor_position)) = neighbor {
        sqlx::query("UPDATE meal_collection_items SET position = $1 WHERE collection_id = $2 AND meal_id = $3")
            .bind(neighbor_position)
            .bind(id)
            .bind(meal_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        sqlx::query("UPDATE meal_collection_items SET position = $1 WHERE collection_id = $2 AND meal_id = $3")
            .bind(position)
            .bind(id)
            .bind(neighbor_meal_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

fn bad(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg })))
}

fn oops() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Something went wrong." })))
}
