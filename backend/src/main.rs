mod auth;
mod ingredients;
mod seed;
mod state;

use axum::{
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;
use std::path::Path;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let state = AppState::connect().await?;
    sqlx::migrate!().run(&state.db).await?;
    seed::seed_ingredients(&state.db).await?;

    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/ingredients", get(ingredients::list))
        .route("/ingredients/categories", get(ingredients::categories))
        .route("/ingredients/{id}", get(ingredients::detail))
        .with_state(state);

    let mut app = Router::new().nest("/api", api);

    // In production the built frontend is copied next to the binary; unknown paths
    // fall back to index.html so client-side routes survive a hard refresh.
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "static".into());
    if Path::new(&static_dir).is_dir() {
        let index = format!("{static_dir}/index.html");
        app = app.fallback_service(ServeDir::new(&static_dir).fallback(ServeFile::new(index)));
        tracing::info!("serving frontend from {static_dir}");
    }

    let app = app.layer(TraceLayer::new_for_http());

    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8090);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}
