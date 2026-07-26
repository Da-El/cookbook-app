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
