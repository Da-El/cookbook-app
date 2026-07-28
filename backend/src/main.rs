mod aliases;
mod auth;
mod diet;
mod guides;
mod import;
mod ingredients;
mod kitchen;
mod meals;
mod moderation;
mod nutrition;
mod planner;
mod search;
mod seed;
mod social;
mod state;
mod substitutes;
mod units;

use axum::{
    routing::{delete, get, post},
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
    seed::seed_guides(&state.db).await?;
    seed::backfill_diet_flags(&state.db).await?;

    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/auth/account", post(auth::update_account).delete(auth::delete_account))
        .route("/auth/forgot-password", post(auth::forgot_password))
        .route("/auth/reset-password", post(auth::reset_password))
        .route("/auth/sessions", get(auth::list_sessions))
        .route("/auth/sessions/revoke-others", post(auth::revoke_other_sessions))
        .route("/auth/sessions/{id}", delete(auth::revoke_session))
        .route("/settings", get(auth::settings))
        .route("/ingredients", get(ingredients::list).post(ingredients::create))
        .route("/ingredients/categories", get(ingredients::categories))
        .route("/ingredients/{id}", get(ingredients::detail))
        .route("/ingredients/{id}/used-in", get(ingredients::used_in_meals))
        .route("/ingredients/{id}/edits", post(ingredients::submit_edit))
        .route(
            "/ingredients/{id}/edits/{field}",
            get(ingredients::list_edits).delete(ingredients::delete_edit),
        )
        .route("/ingredients/{id}/edits/{edit_id}/vote", post(ingredients::vote_edit))
        .route("/ingredients/{id}/aliases", get(aliases::list).post(aliases::create))
        .route("/ingredients/{id}/aliases/{alias_id}/vote", post(aliases::vote))
        .route("/ingredients/{id}/aliases/{alias_id}", delete(aliases::withdraw))
        .route("/ingredients/{id}/substitutes", get(substitutes::list).post(substitutes::create))
        .route("/ingredients/{id}/substitutes/{sub_id}/vote", post(substitutes::vote))
        .route("/ingredients/{id}/substitutes/{sub_id}", delete(substitutes::withdraw))
        // search
        .route("/search", get(search::search))
        // meals
        .route("/meals", get(meals::browse).post(meals::create))
        .route("/meals/filters", get(meals::filters))
        .route("/meals/discover", get(meals::discover))
        .route("/meals/{id}", get(meals::detail).post(meals::update).delete(meals::delete))
        .route("/meals/{id}/save", post(meals::toggle_save))
        .route("/meals/{id}/photo", post(meals::update_photo))
        .route("/meals/{id}/cook", post(meals::cook))
        .route("/meals/{id}/rate", post(meals::rate))
        .route("/meals/{id}/journal", get(meals::my_journal))
        .route("/meals/{id}/reviews", get(meals::meal_reviews))
        .route("/meals/{id}/reviews/{review_id}/helpful", post(meals::vote_review_helpful))
        .route("/meals/{id}/revisions", get(meals::revisions))
        .route("/meals/{id}/revisions/{rev_id}/revert", post(meals::revert))
        .route("/meals/{id}/revisions/{rev_id}/vote", post(meals::vote_revision))
        .route("/meals/{id}/restore", post(meals::restore))
        .route("/meals/{id}/like", post(social::toggle_like))
        // kitchen
        .route("/fridge", get(kitchen::fridge_list).post(kitchen::fridge_add))
        .route("/fridge/{id}", delete(kitchen::fridge_remove))
        .route("/shopping", get(kitchen::shopping_list).post(kitchen::shopping_add))
        .route("/shopping/many", post(kitchen::shopping_add_many))
        .route("/shopping/{id}", delete(kitchen::shopping_remove))
        .route("/shopping/{id}/got-it", post(kitchen::shopping_got_it))
        // cookbook lists
        .route("/cookbook/counts", get(kitchen::counts))
        .route("/cookbook/cooked", get(kitchen::cooked))
        .route("/cookbook/saved", get(kitchen::saved))
        .route("/cookbook/published", get(kitchen::published))
        .route("/cookbook/reviews", get(kitchen::my_reviews))
        .route("/cookbook/edits", get(kitchen::my_edits))
        .route("/cookbook/ratings", get(kitchen::my_ratings))
        .route("/cookbook/votes", get(kitchen::my_votes))
        // import
        .route("/import/url", post(import::import_url))
        .route("/import/text", post(import::import_text))
        .route("/import/capabilities", get(import::capabilities))
        // meal planning
        .route("/plan", get(planner::list_plan).post(planner::add_plan_entry))
        .route("/plan/{id}", post(planner::update_plan_entry).delete(planner::remove_plan_entry))
        .route("/plan/grocery", get(planner::grocery_list))
        .route("/plan/grocery/push", post(planner::push_to_shopping))
        .route("/plan/suggestions", get(planner::suggestions))
        // guides
        .route("/guides", get(guides::list))
        .route("/guides/{slug}", get(guides::detail))
        .route("/guides/{slug}/helpful", post(guides::vote_helpful))
        .route("/guides/{slug}/related-meals", get(guides::related_meals))
        .route("/guides/{slug}/edits", get(guides::list_edits).post(guides::submit_edit))
        .route("/guides/{slug}/edits/{edit_id}", delete(guides::delete_edit))
        .route("/guides/{slug}/edits/{edit_id}/vote", post(guides::vote_edit))
        // social
        .route("/feed", get(social::feed))
        .route("/activity", get(social::activity).post(social::mark_activity_seen))
        .route("/chefs", get(social::search_chefs))
        .route("/chefs/suggested", get(social::suggested_chefs))
        .route("/chefs/following", get(social::following))
        .route("/chefs/{id}", get(social::profile))
        .route("/chefs/{id}/follow", post(social::toggle_follow))
        .route("/chefs/{id}/published", get(social::chef_published))
        .route("/chefs/{id}/cooked", get(social::chef_cooked))
        .route("/chefs/{id}/reviews", get(social::chef_reviews))
        .route("/profile", post(social::update_profile))
        .route("/profile/theme", get(social::my_theme))
        .route("/profile/customize", post(social::update_customize))
        // moderation
        .route("/flags", post(moderation::create_flag))
        .route("/admin/flags", get(moderation::list_flags))
        .route("/admin/flags/{id}/resolve", post(moderation::resolve_flag))
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
