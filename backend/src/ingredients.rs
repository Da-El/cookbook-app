use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::state::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct IngredientSummary {
    pub id: i64,
    pub name: String,
    pub category: String,
    pub foodb_group: Option<String>,
    pub foodb_subgroup: Option<String>,
    pub rating: f64,
    pub rating_count: i32,
}

#[derive(Serialize)]
pub struct Nutrition {
    pub serving_size: String,
    pub calories: Option<i32>,
    pub protein: Option<f64>,
    pub carbs: Option<f64>,
    pub fat: Option<f64>,
    pub fiber: Option<f64>,
    pub sugar: Option<f64>,
    pub source: String,
    pub micros: Micros,
}

#[derive(Serialize)]
pub struct Micros {
    pub vit_c_mg: Option<f64>,
    pub calcium_mg: Option<f64>,
    pub iron_mg: Option<f64>,
    pub potassium_mg: Option<f64>,
    pub magnesium_mg: Option<f64>,
    pub sodium_mg: Option<f64>,
}

#[derive(Serialize)]
pub struct IngredientDetail {
    #[serde(flatten)]
    pub summary: IngredientSummary,
    pub description: String,
    pub photo_url: Option<String>,
    pub nutrition: Option<Nutrition>,
}

#[derive(Deserialize)]
pub struct ListParams {
    pub search: Option<String>,
    pub category: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<IngredientSummary>>, StatusCode> {
    let limit = params.limit.unwrap_or(500).clamp(1, 500);
    let offset = params.offset.unwrap_or(0).max(0);

    let rows = sqlx::query_as::<_, IngredientSummary>(
        "SELECT id, name, category, foodb_group, foodb_subgroup,
                rating::float8 AS rating, rating_count
         FROM ingredients
         WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%')
           AND ($2::text IS NULL OR category = $2)
         ORDER BY name
         LIMIT $3 OFFSET $4",
    )
    .bind(params.search.as_deref().filter(|s| !s.is_empty()))
    .bind(params.category.as_deref().filter(|s| !s.is_empty()))
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("list ingredients failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(rows))
}

pub async fn categories(
    State(state): State<AppState>,
) -> Result<Json<Vec<String>>, StatusCode> {
    let rows: Vec<String> =
        sqlx::query_scalar("SELECT DISTINCT category FROM ingredients ORDER BY category")
            .fetch_all(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("list categories failed: {e}");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct NewIngredient {
    pub name: String,
    pub category: String,
    pub description: Option<String>,
    pub photo_url: Option<String>,
    pub serving_size: Option<String>,
    pub calories: Option<i32>,
    pub protein: Option<f64>,
    pub carbs: Option<f64>,
    pub fat: Option<f64>,
    pub rating: Option<i16>,
    /// Set once the user has seen and dismissed the "looks similar to…" warning.
    pub confirmed_new: Option<bool>,
}

#[derive(Serialize)]
pub struct CreateIngredientResponse {
    pub id: Option<i64>,
    /// Present when a near-duplicate blocked the create.
    pub close_match: Option<CloseMatch>,
}

#[derive(Serialize)]
pub struct CloseMatch {
    pub id: i64,
    pub name: String,
    pub used_in_meals: i64,
}

pub async fn create(
    State(state): State<AppState>,
    crate::auth::CurrentUser(user): crate::auth::CurrentUser,
    Json(body): Json<NewIngredient>,
) -> Result<(StatusCode, Json<CreateIngredientResponse>), (StatusCode, Json<serde_json::Value>)> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(bad("Please enter an ingredient name."));
    }

    // One page per ingredient: an exact name clash is always rejected.
    let exact: Option<i64> = sqlx::query_scalar("SELECT id FROM ingredients WHERE lower(name) = lower($1)")
        .bind(name)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| oops())?;
    if exact.is_some() {
        return Err(bad(&format!(
            "\u{201c}{name}\u{201d} already has a page — only one page per ingredient."
        )));
    }

    // A fuzzy hit only warns: the user can confirm and create anyway.
    if !body.confirmed_new.unwrap_or(false) {
        let close = sqlx::query_as::<_, (i64, String, i64)>(
            "SELECT i.id, i.name,
                    (SELECT count(*) FROM meal_ingredients mi WHERE mi.ingredient_id = i.id)
             FROM ingredients i
             WHERE i.name ILIKE '%' || $1 || '%' OR $1 ILIKE '%' || i.name || '%'
             ORDER BY length(i.name) LIMIT 1",
        )
        .bind(name)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| oops())?;

        if let Some((id, matched, used)) = close {
            return Ok((
                StatusCode::OK,
                Json(CreateIngredientResponse {
                    id: None,
                    close_match: Some(CloseMatch { id, name: matched, used_in_meals: used }),
                }),
            ));
        }
    }

    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO ingredients (name, category, description, photo_url, author_id, rating, rating_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    )
    .bind(name)
    .bind(body.category.trim())
    .bind(body.description.as_deref().unwrap_or("").trim())
    .bind(body.photo_url.as_deref())
    .bind(user.id)
    .bind(body.rating.map(f64::from).unwrap_or(0.0))
    .bind(i32::from(body.rating.is_some()))
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("create ingredient failed: {e}");
        oops()
    })?;

    let has_nutrition = body.calories.is_some()
        || body.protein.is_some()
        || body.carbs.is_some()
        || body.fat.is_some()
        || body.serving_size.is_some();

    if has_nutrition {
        sqlx::query(
            "INSERT INTO ingredient_nutrition
               (ingredient_id, serving_size, calories, protein, carbs, fat, source)
             VALUES ($1,$2,$3,$4,$5,$6,'Community')",
        )
        .bind(id)
        .bind(body.serving_size.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or("1 serving"))
        .bind(body.calories)
        .bind(body.protein)
        .bind(body.carbs)
        .bind(body.fat)
        .execute(&mut *tx)
        .await
        .map_err(|_| oops())?;
    }

    if let Some(v) = body.rating {
        sqlx::query("INSERT INTO ratings (user_id, subject_type, subject_id, value) VALUES ($1,'ingredient',$2,$3)")
            .bind(user.id).bind(id).bind(v)
            .execute(&mut *tx).await.ok();
    }

    tx.commit().await.map_err(|_| oops())?;

    Ok((StatusCode::CREATED, Json(CreateIngredientResponse { id: Some(id), close_match: None })))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct UsedInMeal {
    pub id: i64,
    pub name: String,
    pub cuisine: String,
    /// Whether the viewer's fridge already covers every ingredient this meal needs.
    pub can_make: bool,
}

pub async fn used_in_meals(
    State(state): State<AppState>,
    user: Option<crate::auth::CurrentUser>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<UsedInMeal>>, StatusCode> {
    let viewer = user.map(|u| u.0.id);
    let rows = sqlx::query_as::<_, UsedInMeal>(
        "SELECT m.id, m.name, m.cuisine,
                NOT EXISTS (
                  SELECT 1 FROM meal_ingredients mi2
                  WHERE mi2.meal_id = m.id
                    AND NOT EXISTS (SELECT 1 FROM fridge_items f
                                    WHERE f.user_id = $2 AND f.ingredient_id = mi2.ingredient_id)
                ) AS can_make
         FROM meals m
         JOIN meal_ingredients mi ON mi.meal_id = m.id
         WHERE mi.ingredient_id = $1 AND m.visibility = 'public'
         ORDER BY m.rating DESC
         LIMIT 30",
    )
    .bind(id)
    .bind(viewer)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("used_in_meals failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(rows))
}

fn bad(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg })))
}
fn oops() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": "Could not save that ingredient." })),
    )
}

pub async fn detail(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<IngredientDetail>, StatusCode> {
    let row = sqlx::query_as::<_, (i64, String, String, Option<String>, Option<String>, f64, i32, String, Option<String>)>(
        "SELECT id, name, category, foodb_group, foodb_subgroup,
                rating::float8, rating_count, description, photo_url
         FROM ingredients WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("ingredient detail failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or(StatusCode::NOT_FOUND)?;

    let nutrition = sqlx::query_as::<_, (String, Option<i32>, Option<f64>, Option<f64>, Option<f64>, Option<f64>, Option<f64>, String, Option<f64>, Option<f64>, Option<f64>, Option<f64>, Option<f64>, Option<f64>)>(
        "SELECT serving_size, calories, protein::float8, carbs::float8, fat::float8,
                fiber::float8, sugar::float8, source,
                vit_c_mg::float8, calcium_mg::float8, iron_mg::float8,
                potassium_mg::float8, magnesium_mg::float8, sodium_mg::float8
         FROM ingredient_nutrition WHERE ingredient_id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("nutrition fetch failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .map(|n| Nutrition {
        serving_size: n.0,
        calories: n.1,
        protein: n.2,
        carbs: n.3,
        fat: n.4,
        fiber: n.5,
        sugar: n.6,
        source: n.7,
        micros: Micros {
            vit_c_mg: n.8,
            calcium_mg: n.9,
            iron_mg: n.10,
            potassium_mg: n.11,
            magnesium_mg: n.12,
            sodium_mg: n.13,
        },
    });

    Ok(Json(IngredientDetail {
        summary: IngredientSummary {
            id: row.0,
            name: row.1,
            category: row.2,
            foodb_group: row.3,
            foodb_subgroup: row.4,
            rating: row.5,
            rating_count: row.6,
        },
        description: row.7,
        photo_url: row.8,
        nutrition,
    }))
}
