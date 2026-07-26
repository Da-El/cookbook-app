use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::CurrentUser;
use crate::state::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct KitchenItem {
    pub id: i64,
    pub ingredient_id: Option<i64>,
    pub name: String,
    pub category: String,
}

#[derive(Deserialize)]
pub struct AddItem {
    pub ingredient_id: Option<i64>,
    pub custom_name: Option<String>,
}

fn clean_custom(b: &AddItem) -> Option<&str> {
    b.custom_name.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

fn db_err(e: sqlx::Error) -> StatusCode {
    tracing::error!("kitchen query failed: {e}");
    StatusCode::INTERNAL_SERVER_ERROR
}

// Catalog items show their real category; free-text ones fall back to "Other".

pub async fn fridge_list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<KitchenItem>>, StatusCode> {
    let rows = sqlx::query_as::<_, KitchenItem>(
        "SELECT t.id, t.ingredient_id, COALESCE(i.name, t.custom_name) AS name,
                COALESCE(i.category, 'Other') AS category
         FROM fridge_items t LEFT JOIN ingredients i ON i.id = t.ingredient_id
         WHERE t.user_id = $1 ORDER BY category, name",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

pub async fn fridge_add(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(b): Json<AddItem>,
) -> Result<StatusCode, StatusCode> {
    let custom = clean_custom(&b);
    if b.ingredient_id.is_none() && custom.is_none() {
        return Err(StatusCode::BAD_REQUEST);
    }
    sqlx::query(
        "INSERT INTO fridge_items (user_id, ingredient_id, custom_name) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING",
    )
    .bind(user.id)
    .bind(b.ingredient_id)
    .bind(if b.ingredient_id.is_some() { None } else { custom })
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn fridge_remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    sqlx::query("DELETE FROM fridge_items WHERE id=$1 AND user_id=$2")
        .bind(id).bind(user.id)
        .execute(&state.db).await.map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn shopping_list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<KitchenItem>>, StatusCode> {
    let rows = sqlx::query_as::<_, KitchenItem>(
        "SELECT t.id, t.ingredient_id, COALESCE(i.name, t.custom_name) AS name,
                COALESCE(i.category, 'Other') AS category
         FROM shopping_items t LEFT JOIN ingredients i ON i.id = t.ingredient_id
         WHERE t.user_id = $1 ORDER BY category, name",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

pub async fn shopping_add(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(b): Json<AddItem>,
) -> Result<StatusCode, StatusCode> {
    let custom = clean_custom(&b);
    if b.ingredient_id.is_none() && custom.is_none() {
        return Err(StatusCode::BAD_REQUEST);
    }
    sqlx::query(
        "INSERT INTO shopping_items (user_id, ingredient_id, custom_name) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING",
    )
    .bind(user.id)
    .bind(b.ingredient_id)
    .bind(if b.ingredient_id.is_some() { None } else { custom })
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct AddMany {
    pub ingredient_ids: Vec<i64>,
}

/// Meal Detail's "add N missing to shopping list" - one round trip instead of N.
pub async fn shopping_add_many(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(b): Json<AddMany>,
) -> Result<StatusCode, StatusCode> {
    let mut tx = state.db.begin().await.map_err(db_err)?;
    for id in b.ingredient_ids {
        sqlx::query(
            "INSERT INTO shopping_items (user_id, ingredient_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        )
        .bind(user.id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    tx.commit().await.map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn shopping_remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    sqlx::query("DELETE FROM shopping_items WHERE id=$1 AND user_id=$2")
        .bind(id).bind(user.id)
        .execute(&state.db).await.map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

/// "Got it ✓" - moves a shopping row into the fridge in one step.
pub async fn shopping_got_it(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    let row = sqlx::query_as::<_, (Option<i64>, Option<String>)>(
        "SELECT ingredient_id, custom_name FROM shopping_items WHERE id=$1 AND user_id=$2",
    )
    .bind(id)
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?
    .ok_or(StatusCode::NOT_FOUND)?;

    let mut tx = state.db.begin().await.map_err(db_err)?;
    sqlx::query(
        "INSERT INTO fridge_items (user_id, ingredient_id, custom_name) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING",
    )
    .bind(user.id).bind(row.0).bind(row.1)
    .execute(&mut *tx).await.map_err(db_err)?;

    sqlx::query("DELETE FROM shopping_items WHERE id=$1 AND user_id=$2")
        .bind(id).bind(user.id)
        .execute(&mut *tx).await.map_err(db_err)?;

    tx.commit().await.map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- the user's own cookbook lists ----------

#[derive(Serialize, sqlx::FromRow)]
pub struct CookbookMeal {
    pub id: i64,
    pub name: String,
    pub author_name: String,
    pub cuisine: String,
    pub time_minutes: i32,
    pub rating: f64,
    pub photo_url: Option<String>,
}

pub async fn cooked(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<CookbookMeal>>, StatusCode> {
    let rows = sqlx::query_as::<_, CookbookMeal>(
        "SELECT m.id, m.name, u.display_name AS author_name, m.cuisine, m.time_minutes,
                m.rating::float8 AS rating, m.photo_url
         FROM meals m JOIN users u ON u.id = m.author_id
         JOIN cooked_meals c ON c.meal_id = m.id
         WHERE c.user_id = $1 ORDER BY c.cooked_at DESC",
    )
    .bind(user.id).fetch_all(&state.db).await.map_err(db_err)?;
    Ok(Json(rows))
}

pub async fn saved(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<CookbookMeal>>, StatusCode> {
    let rows = sqlx::query_as::<_, CookbookMeal>(
        "SELECT m.id, m.name, u.display_name AS author_name, m.cuisine, m.time_minutes,
                m.rating::float8 AS rating, m.photo_url
         FROM meals m JOIN users u ON u.id = m.author_id
         JOIN saved_meals sm ON sm.meal_id = m.id
         WHERE sm.user_id = $1 ORDER BY sm.saved_at DESC",
    )
    .bind(user.id).fetch_all(&state.db).await.map_err(db_err)?;
    Ok(Json(rows))
}

pub async fn published(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<CookbookMeal>>, StatusCode> {
    let rows = sqlx::query_as::<_, CookbookMeal>(
        "SELECT m.id, m.name, u.display_name AS author_name, m.cuisine, m.time_minutes,
                m.rating::float8 AS rating, m.photo_url
         FROM meals m JOIN users u ON u.id = m.author_id
         WHERE m.author_id = $1 ORDER BY m.created_at DESC",
    )
    .bind(user.id).fetch_all(&state.db).await.map_err(db_err)?;
    Ok(Json(rows))
}

pub async fn counts(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let row = sqlx::query_as::<_, (i64, i64, i64, i64, i64)>(
        "SELECT (SELECT count(*) FROM cooked_meals WHERE user_id=$1),
                (SELECT count(*) FROM saved_meals WHERE user_id=$1),
                (SELECT count(*) FROM meals WHERE author_id=$1),
                (SELECT count(*) FROM fridge_items WHERE user_id=$1),
                (SELECT count(*) FROM shopping_items WHERE user_id=$1)",
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;

    Ok(Json(serde_json::json!({
        "cooked": row.0, "saved": row.1, "published": row.2,
        "fridge": row.3, "shopping": row.4
    })))
}
