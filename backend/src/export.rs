//! "Download my data" - a GDPR/CCPA-style export of a user's own content,
//! not the whole database's view of them. Assembled from plain queries into
//! one JSON document rather than named structs per section: the shape here
//! is a one-way snapshot for a human (or another app) to read, not a
//! contract any other part of this codebase parses back.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde_json::json;

use crate::auth::CurrentUser;
use crate::state::AppState;

pub async fn export(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let db = &state.db;
    let err = |e: sqlx::Error| {
        tracing::error!("data export failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    };

    let profile: (String, String, Option<String>, Vec<String>, chrono::DateTime<chrono::Utc>) = sqlx::query_as(
        "SELECT display_name, email, bio, diet_prefs, created_at FROM users WHERE id = $1",
    )
    .bind(user.id)
    .fetch_one(db)
    .await
    .map_err(err)?;

    let published_meals: Vec<(i64, String, String, String, Option<String>, f64, i32, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as(
            "SELECT id, name, cuisine, meal_type, description, rating::float8, rating_count, created_at
             FROM meals WHERE author_id = $1 AND status = 'live'
             ORDER BY created_at",
        )
        .bind(user.id)
        .fetch_all(db)
        .await
        .map_err(err)?;

    let meal_reviews: Vec<(String, Option<i16>, Option<String>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT m.name, r.score, r.note, r.cooked_at
         FROM reviews r JOIN meals m ON m.id = r.meal_id
         WHERE r.user_id = $1 ORDER BY r.cooked_at",
    )
    .bind(user.id)
    .fetch_all(db)
    .await
    .map_err(err)?;

    let ingredient_reviews: Vec<(String, Option<i16>, Option<String>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT i.name, r.score, r.note, r.created_at
         FROM ingredient_reviews r JOIN ingredients i ON i.id = r.ingredient_id
         WHERE r.user_id = $1 ORDER BY r.created_at",
    )
    .bind(user.id)
    .fetch_all(db)
    .await
    .map_err(err)?;

    let collections: Vec<(String, Vec<String>)> = sqlx::query_as(
        "SELECT c.name,
                COALESCE(array_agg(m.name) FILTER (WHERE m.name IS NOT NULL), '{}')
         FROM meal_collections c
         LEFT JOIN meal_collection_items i ON i.collection_id = c.id
         LEFT JOIN meals m ON m.id = i.meal_id
         WHERE c.user_id = $1
         GROUP BY c.id, c.name
         ORDER BY c.name",
    )
    .bind(user.id)
    .fetch_all(db)
    .await
    .map_err(err)?;

    let saved_meals: Vec<String> = sqlx::query_scalar(
        "SELECT m.name FROM saved_meals s JOIN meals m ON m.id = s.meal_id WHERE s.user_id = $1",
    )
    .bind(user.id)
    .fetch_all(db)
    .await
    .map_err(err)?;

    let cooked_meals: Vec<String> = sqlx::query_scalar(
        "SELECT m.name FROM cooked_meals c JOIN meals m ON m.id = c.meal_id WHERE c.user_id = $1",
    )
    .bind(user.id)
    .fetch_all(db)
    .await
    .map_err(err)?;

    Ok(Json(json!({
        "exported_at": chrono::Utc::now(),
        "profile": {
            "display_name": profile.0,
            "email": profile.1,
            "bio": profile.2,
            "diet_prefs": profile.3,
            "member_since": profile.4,
        },
        "published_meals": published_meals.into_iter().map(|m| json!({
            "id": m.0, "name": m.1, "cuisine": m.2, "meal_type": m.3,
            "description": m.4, "rating": m.5, "rating_count": m.6, "created_at": m.7,
        })).collect::<Vec<_>>(),
        "meal_reviews": meal_reviews.into_iter().map(|r| json!({
            "meal_name": r.0, "score": r.1, "note": r.2, "cooked_at": r.3,
        })).collect::<Vec<_>>(),
        "ingredient_reviews": ingredient_reviews.into_iter().map(|r| json!({
            "ingredient_name": r.0, "score": r.1, "note": r.2, "created_at": r.3,
        })).collect::<Vec<_>>(),
        "collections": collections.into_iter().map(|c| json!({
            "name": c.0, "meals": c.1,
        })).collect::<Vec<_>>(),
        "saved_meals": saved_meals,
        "cooked_meals": cooked_meals,
    })))
}
