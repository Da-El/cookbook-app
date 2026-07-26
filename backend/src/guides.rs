//! Beginner guides: short technique explainers, seeded as content rather than
//! hard-coded into the frontend so they can be edited without a deploy.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct GuideSummary {
    pub id: i64,
    pub slug: String,
    pub title: String,
    pub summary: String,
    pub topic: String,
    pub minutes: Option<i32>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct GuideDetail {
    pub id: i64,
    pub slug: String,
    pub title: String,
    pub summary: String,
    pub body: String,
    pub topic: String,
    pub minutes: Option<i32>,
}

pub async fn list(State(state): State<AppState>) -> Result<Json<Vec<GuideSummary>>, StatusCode> {
    let rows = sqlx::query_as::<_, GuideSummary>(
        "SELECT id, slug, title, summary, topic, minutes
         FROM guides ORDER BY topic, position, title",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("list guides failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(rows))
}

pub async fn detail(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<GuideDetail>, StatusCode> {
    sqlx::query_as::<_, GuideDetail>(
        "SELECT id, slug, title, summary, body, topic, minutes FROM guides WHERE slug = $1",
    )
    .bind(&slug)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map(Json)
    .ok_or(StatusCode::NOT_FOUND)
}
