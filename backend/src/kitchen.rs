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
         WHERE c.user_id = $1 AND m.status = 'live' ORDER BY c.cooked_at DESC",
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
         WHERE sm.user_id = $1 AND m.status = 'live' ORDER BY sm.saved_at DESC",
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
         WHERE m.author_id = $1 AND m.status = 'live' ORDER BY m.created_at DESC",
    )
    .bind(user.id).fetch_all(&state.db).await.map_err(db_err)?;
    Ok(Json(rows))
}

pub async fn counts(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let row = sqlx::query_as::<_, (i64, i64, i64, i64, i64, i64, i64, i64, i64)>(
        "SELECT (SELECT count(*) FROM cooked_meals WHERE user_id=$1),
                (SELECT count(*) FROM saved_meals WHERE user_id=$1),
                (SELECT count(*) FROM meals WHERE author_id=$1 AND status='live'),
                (SELECT count(*) FROM fridge_items WHERE user_id=$1),
                (SELECT count(*) FROM shopping_items WHERE user_id=$1),
                (SELECT count(*) FROM reviews WHERE user_id=$1),
                (SELECT count(*) FROM ingredient_edits WHERE author_id=$1),
                (SELECT count(*) FROM ratings WHERE user_id=$1),
                ((SELECT count(*) FROM revision_votes WHERE user_id=$1)
                 + (SELECT count(*) FROM alias_votes WHERE user_id=$1))",
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;

    Ok(Json(serde_json::json!({
        "cooked": row.0, "saved": row.1, "published": row.2,
        "fridge": row.3, "shopping": row.4,
        "reviews": row.5, "edits": row.6,
        "ratings": row.7, "votes": row.8
    })))
}

// ---------- the user's own contributions: reviews written, edits submitted ----------

#[derive(Serialize, sqlx::FromRow)]
pub struct MyReview {
    pub id: i64,
    pub meal_id: i64,
    pub meal_name: String,
    pub photo_url: Option<String>,
    pub score: Option<i16>,
    pub note: Option<String>,
    pub is_public: bool,
    pub cooked_at: chrono::DateTime<chrono::Utc>,
}

pub async fn my_reviews(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<MyReview>>, StatusCode> {
    let rows = sqlx::query_as::<_, MyReview>(
        "SELECT r.id, r.meal_id, m.name AS meal_name, m.photo_url, r.score, r.note,
                r.is_public, r.cooked_at
         FROM reviews r JOIN meals m ON m.id = r.meal_id
         WHERE r.user_id = $1 AND m.status = 'live'
         ORDER BY r.cooked_at DESC",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct MyEdit {
    pub id: i64,
    pub ingredient_id: i64,
    pub ingredient_name: String,
    pub ingredient_category: String,
    pub field: String,
    pub value: serde_json::Value,
    pub votes: i32,
    /// Whether this is the currently-winning edit for its field - same
    /// highest-votes-then-oldest rule as `apply_winner` in ingredients.rs.
    pub is_winning: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn my_edits(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<MyEdit>>, StatusCode> {
    let rows = sqlx::query_as::<_, MyEdit>(
        "SELECT e.id, e.ingredient_id, ing.name AS ingredient_name, ing.category AS ingredient_category,
                e.field, e.value, e.votes,
                e.id = (SELECT id FROM ingredient_edits e2
                        WHERE e2.ingredient_id = e.ingredient_id AND e2.field = e.field
                        ORDER BY e2.votes DESC, e2.id ASC LIMIT 1) AS is_winning,
                e.created_at
         FROM ingredient_edits e JOIN ingredients ing ON ing.id = e.ingredient_id
         WHERE e.author_id = $1
         ORDER BY e.created_at DESC",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

// ---------- the user's own rating and voting history ----------

/// One row per meal the viewer has rated. Meal ratings are keyed
/// `(user_id, subject_type, subject_id)` in `ratings` - one live value per
/// meal, not a log of changes - so this is "what you currently have this
/// recipe rated," not a change-by-change history. `updated_at` moves when a
/// rating is revised, which is the honest signal available: it says *that*
/// it changed, not what it changed from.
#[derive(Serialize, sqlx::FromRow)]
pub struct MyRating {
    pub meal_id: i64,
    pub meal_name: String,
    pub photo_url: Option<String>,
    pub value: i16,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

pub async fn my_ratings(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<MyRating>>, StatusCode> {
    let rows = sqlx::query_as::<_, MyRating>(
        "SELECT r.subject_id AS meal_id, m.name AS meal_name, m.photo_url,
                r.value, r.created_at, r.updated_at
         FROM ratings r JOIN meals m ON m.id = r.subject_id
         WHERE r.user_id = $1 AND r.subject_type = 'meal' AND m.status = 'live'
         ORDER BY r.updated_at DESC",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

/// A vote on a recipe edit and a vote on an ingredient alias are different
/// tables with different shapes, so this normalises both into one feed with
/// a `kind` discriminator - the person asking "what have I voted on" doesn't
/// think in terms of the schema, they think in terms of one activity.
#[derive(Serialize, sqlx::FromRow)]
pub struct MyVote {
    pub kind: String,
    pub target_id: i64,
    /// The meal (for a revision vote) or ingredient (for an alias vote) the
    /// vote is ultimately about, so the client can always link somewhere.
    pub subject_id: i64,
    pub subject_name: String,
    pub label: String,
    pub value: i16,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn my_votes(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<MyVote>>, StatusCode> {
    let rows = sqlx::query_as::<_, MyVote>(
        "SELECT 'revision' AS kind, v.revision_id AS target_id, r.meal_id AS subject_id,
                m.name AS subject_name, COALESCE(NULLIF(r.summary, ''), 'an edit') AS label,
                v.value, v.created_at
         FROM revision_votes v
         JOIN meal_revisions r ON r.id = v.revision_id
         JOIN meals m ON m.id = r.meal_id
         WHERE v.user_id = $1 AND m.status = 'live'
         UNION ALL
         SELECT 'alias' AS kind, v.alias_id AS target_id, a.ingredient_id AS subject_id,
                i.name AS subject_name, a.name AS label,
                v.value, v.created_at
         FROM alias_votes v
         JOIN ingredient_aliases a ON a.id = v.alias_id
         JOIN ingredients i ON i.id = a.ingredient_id
         WHERE v.user_id = $1
         ORDER BY created_at DESC",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}
