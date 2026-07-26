use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::CurrentUser;
use crate::state::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct MealCard {
    pub id: i64,
    pub name: String,
    pub author_id: i64,
    pub author_name: String,
    pub cuisine: String,
    pub meal_type: String,
    pub time_minutes: i32,
    pub rating: f64,
    pub rating_count: i32,
    pub photo_url: Option<String>,
    /// How many of this meal's ingredients the viewer has in their fridge.
    pub have_count: i64,
    pub total_count: i64,
}

#[derive(Deserialize)]
pub struct BrowseParams {
    pub search: Option<String>,
    pub cuisine: Option<String>,
    pub meal_type: Option<String>,
    /// "top" (default) | "canmake" | "fastest"
    pub sort: Option<String>,
}

pub async fn browse(
    State(state): State<AppState>,
    user: Option<CurrentUser>,
    Query(p): Query<BrowseParams>,
) -> Result<Json<Vec<MealCard>>, StatusCode> {
    let viewer = user.map(|u| u.0.id);
    let sort = match p.sort.as_deref() {
        Some("fastest") => "fastest",
        Some("canmake") => "canmake",
        _ => "top",
    };

    // Sort is a bound parameter rather than interpolated SQL: the CASE arms that
    // don't match the chosen mode evaluate to NULL, making those terms a no-op.
    let rows = sqlx::query_as::<_, MealCard>(
        "SELECT m.id, m.name, m.author_id, u.display_name AS author_name, m.cuisine, m.meal_type,
                m.time_minutes, m.rating::float8 AS rating, m.rating_count, m.photo_url,
                COALESCE(m.have_count, 0) AS have_count, COALESCE(m.total_count, 0) AS total_count
         FROM (
           SELECT m.*,
             (SELECT count(*) FROM meal_ingredients mi
                WHERE mi.meal_id = m.id
                  AND EXISTS (SELECT 1 FROM fridge_items f
                              WHERE f.user_id = $1 AND f.ingredient_id = mi.ingredient_id)) AS have_count,
             (SELECT count(*) FROM meal_ingredients mi WHERE mi.meal_id = m.id) AS total_count
           FROM meals m
           WHERE m.visibility = 'public'
             AND ($2::text IS NULL OR m.name ILIKE '%' || $2 || '%')
             AND ($3::text IS NULL OR m.cuisine = $3)
             AND ($4::text IS NULL OR m.meal_type = $4)
         ) m
         JOIN users u ON u.id = m.author_id
         ORDER BY
           CASE WHEN $5 = 'fastest' THEN m.time_minutes END ASC NULLS LAST,
           CASE WHEN $5 = 'canmake'
                THEN (m.have_count::float8 / NULLIF(m.total_count, 0)) END DESC NULLS LAST,
           m.rating DESC, m.rating_count DESC
         LIMIT 200",
    )
        .bind(viewer)
        .bind(p.search.as_deref().filter(|s| !s.is_empty()))
        .bind(p.cuisine.as_deref().filter(|s| !s.is_empty()))
        .bind(p.meal_type.as_deref().filter(|s| !s.is_empty()))
        .bind(sort)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("browse meals failed: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(rows))
}

#[derive(Serialize)]
pub struct MealIngredientRow {
    pub ingredient_id: i64,
    pub name: String,
    pub category: String,
    pub qty: Option<String>,
    pub in_fridge: bool,
}

#[derive(Serialize)]
pub struct MealDetail {
    #[serde(flatten)]
    pub card: MealCard,
    pub description: String,
    pub steps: Vec<String>,
    pub serves: Option<String>,
    pub visibility: String,
    pub ingredients: Vec<MealIngredientRow>,
    pub is_cooked: bool,
    pub is_saved: bool,
    pub your_rating: Option<i16>,
}

pub async fn detail(
    State(state): State<AppState>,
    user: Option<CurrentUser>,
    Path(id): Path<i64>,
) -> Result<Json<MealDetail>, StatusCode> {
    let viewer = user.map(|u| u.0.id);

    let card = sqlx::query_as::<_, MealCard>(
        "SELECT m.id, m.name, m.author_id, u.display_name AS author_name, m.cuisine, m.meal_type,
                m.time_minutes, m.rating::float8 AS rating, m.rating_count, m.photo_url,
                (SELECT count(*) FROM meal_ingredients mi
                   WHERE mi.meal_id = m.id
                     AND EXISTS (SELECT 1 FROM fridge_items f
                                 WHERE f.user_id = $2 AND f.ingredient_id = mi.ingredient_id)) AS have_count,
                (SELECT count(*) FROM meal_ingredients mi WHERE mi.meal_id = m.id) AS total_count
         FROM meals m JOIN users u ON u.id = m.author_id
         WHERE m.id = $1",
    )
    .bind(id)
    .bind(viewer)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    let extra = sqlx::query_as::<_, (String, Vec<String>, Option<String>, String)>(
        "SELECT description, steps, serves, visibility FROM meals WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let ingredients = sqlx::query_as::<_, (i64, String, String, Option<String>, bool)>(
        "SELECT i.id, i.name, i.category, mi.qty,
                EXISTS (SELECT 1 FROM fridge_items f WHERE f.user_id = $2 AND f.ingredient_id = i.id) AS in_fridge
         FROM meal_ingredients mi JOIN ingredients i ON i.id = mi.ingredient_id
         WHERE mi.meal_id = $1 ORDER BY mi.position",
    )
    .bind(id)
    .bind(viewer)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .into_iter()
    .map(|r| MealIngredientRow {
        ingredient_id: r.0,
        name: r.1,
        category: r.2,
        qty: r.3,
        in_fridge: r.4,
    })
    .collect();

    let (is_cooked, is_saved, your_rating) = match viewer {
        Some(uid) => {
            let c: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM cooked_meals WHERE user_id=$1 AND meal_id=$2)",
            )
            .bind(uid).bind(id).fetch_one(&state.db).await.unwrap_or(false);
            let s: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM saved_meals WHERE user_id=$1 AND meal_id=$2)",
            )
            .bind(uid).bind(id).fetch_one(&state.db).await.unwrap_or(false);
            let r: Option<i16> = sqlx::query_scalar(
                "SELECT value FROM ratings WHERE user_id=$1 AND subject_type='meal' AND subject_id=$2",
            )
            .bind(uid).bind(id).fetch_optional(&state.db).await.ok().flatten();
            (c, s, r)
        }
        None => (false, false, None),
    };

    Ok(Json(MealDetail {
        card,
        description: extra.0,
        steps: extra.1,
        serves: extra.2,
        visibility: extra.3,
        ingredients,
        is_cooked,
        is_saved,
        your_rating,
    }))
}

#[derive(Deserialize)]
pub struct NewMeal {
    pub name: String,
    pub cuisine: String,
    pub meal_type: String,
    pub time_minutes: i32,
    pub serves: Option<String>,
    pub description: Option<String>,
    pub steps: Vec<String>,
    pub ingredients: Vec<NewMealIngredient>,
    pub photo_url: Option<String>,
    pub visibility: Option<String>,
    pub rating: Option<i16>,
}

#[derive(Deserialize)]
pub struct NewMealIngredient {
    pub ingredient_id: i64,
    pub qty: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<NewMeal>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(bad("Give your meal a name."));
    }
    if body.time_minutes <= 0 {
        return Err(bad("How long does it take to cook?"));
    }

    let visibility = match body.visibility.as_deref() {
        Some("personal") => "personal",
        _ => "public",
    };
    let steps: Vec<String> = body.steps.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();

    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    let meal_id: i64 = sqlx::query_scalar(
        "INSERT INTO meals (name, author_id, cuisine, meal_type, time_minutes, serves,
                            description, steps, photo_url, visibility, rating, rating_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id",
    )
    .bind(name)
    .bind(user.id)
    .bind(body.cuisine.trim())
    .bind(body.meal_type.trim())
    .bind(body.time_minutes)
    .bind(body.serves.as_deref())
    .bind(body.description.as_deref().unwrap_or("").trim())
    .bind(&steps)
    .bind(body.photo_url.as_deref())
    .bind(visibility)
    .bind(body.rating.map(f64::from).unwrap_or(0.0))
    .bind(i32::from(body.rating.is_some()))
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("create meal failed: {e}");
        oops()
    })?;

    for (idx, ing) in body.ingredients.iter().enumerate() {
        sqlx::query(
            "INSERT INTO meal_ingredients (meal_id, ingredient_id, qty, position)
             VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        )
        .bind(meal_id)
        .bind(ing.ingredient_id)
        .bind(ing.qty.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .bind(idx as i32)
        .execute(&mut *tx)
        .await
        .map_err(|_| oops())?;
    }

    if let Some(v) = body.rating {
        sqlx::query(
            "INSERT INTO ratings (user_id, subject_type, subject_id, value) VALUES ($1,'meal',$2,$3)",
        )
        .bind(user.id).bind(meal_id).bind(v)
        .execute(&mut *tx).await.ok();
    }

    tx.commit().await.map_err(|_| oops())?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({ "id": meal_id }))))
}

/// Saving is a plain toggle; cooking is one-way (and moves the meal out of Saved).
pub async fn toggle_save(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let deleted = sqlx::query("DELETE FROM saved_meals WHERE user_id=$1 AND meal_id=$2")
        .bind(user.id).bind(id)
        .execute(&state.db).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected();

    if deleted == 0 {
        sqlx::query("INSERT INTO saved_meals (user_id, meal_id) VALUES ($1,$2) ON CONFLICT DO NOTHING")
            .bind(user.id).bind(id)
            .execute(&state.db).await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    Ok(Json(serde_json::json!({ "saved": deleted == 0 })))
}

#[derive(Deserialize)]
pub struct CookBody {
    pub note: Option<String>,
    pub score: Option<i16>,
    pub is_public: Option<bool>,
}

pub async fn cook(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<CookBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut tx = state.db.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    sqlx::query("INSERT INTO cooked_meals (user_id, meal_id) VALUES ($1,$2) ON CONFLICT DO NOTHING")
        .bind(user.id).bind(id).execute(&mut *tx).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Cooking it fulfils the intent to save it, so drop it from the saved list.
    sqlx::query("DELETE FROM saved_meals WHERE user_id=$1 AND meal_id=$2")
        .bind(user.id).bind(id).execute(&mut *tx).await.ok();

    if body.note.is_some() || body.score.is_some() {
        sqlx::query(
            "INSERT INTO reviews (user_id, meal_id, score, note, is_public) VALUES ($1,$2,$3,$4,$5)",
        )
        .bind(user.id).bind(id)
        .bind(body.score)
        .bind(body.note.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .bind(body.is_public.unwrap_or(true))
        .execute(&mut *tx).await.ok();
    }

    if let Some(score) = body.score {
        upsert_rating(&mut tx, user.id, "meal", id, score).await;
    }

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "cooked": true })))
}

#[derive(Deserialize)]
pub struct RateBody {
    pub value: i16,
}

pub async fn rate(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<RateBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !(1..=10).contains(&body.value) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut tx = state.db.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    upsert_rating(&mut tx, user.id, "meal", id, body.value).await;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "rated": body.value })))
}

/// Writes the user's rating then recomputes the subject's cached average.
async fn upsert_rating(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: i64,
    subject_type: &str,
    subject_id: i64,
    value: i16,
) {
    sqlx::query(
        "INSERT INTO ratings (user_id, subject_type, subject_id, value) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, subject_type, subject_id)
         DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(user_id).bind(subject_type).bind(subject_id).bind(value)
    .execute(&mut **tx).await.ok();

    if subject_type == "meal" {
        sqlx::query(
            "UPDATE meals SET
               rating = COALESCE((SELECT round(avg(value)::numeric,1) FROM ratings
                                  WHERE subject_type='meal' AND subject_id=$1), 0),
               rating_count = (SELECT count(*) FROM ratings WHERE subject_type='meal' AND subject_id=$1)
             WHERE id = $1",
        )
        .bind(subject_id).execute(&mut **tx).await.ok();
    } else {
        sqlx::query(
            "UPDATE ingredients SET
               rating = COALESCE((SELECT round(avg(value)::numeric,1) FROM ratings
                                  WHERE subject_type='ingredient' AND subject_id=$1), 0),
               rating_count = (SELECT count(*) FROM ratings WHERE subject_type='ingredient' AND subject_id=$1)
             WHERE id = $1",
        )
        .bind(subject_id).execute(&mut **tx).await.ok();
    }
}

pub async fn filters(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cuisines: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT cuisine FROM meals WHERE visibility='public' ORDER BY cuisine",
    )
    .fetch_all(&state.db).await.unwrap_or_default();
    let types: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT meal_type FROM meals WHERE visibility='public' ORDER BY meal_type",
    )
    .fetch_all(&state.db).await.unwrap_or_default();
    Json(serde_json::json!({ "cuisines": cuisines, "meal_types": types }))
}

fn bad(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg })))
}
fn oops() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Could not save that meal." })))
}
