mod aliases;
mod auth;
mod collections;
mod diet;
mod email;
mod export;
mod guides;
mod import;
mod ingredients;
mod kitchen;
mod meals;
mod moderation;
mod notify;
mod nutrition;
mod og;
mod planner;
mod ratelimit;
mod search;
mod seed;
mod social;
mod state;
mod substitutes;
mod units;

use axum::{
    routing::{delete, get, post, put},
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

    let mut state = AppState::connect().await?;
    sqlx::migrate!().run(&state.db).await?;
    seed::seed_ingredients(&state.db).await?;
    seed::seed_guides(&state.db).await?;
    seed::backfill_diet_flags(&state.db).await?;

    // Computed before `state` moves into `api`'s `.with_state()` below, so
    // the og:: routes (registered after api, once static_dir is known) can
    // still get their own clone of it with the template attached.
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "static".into());
    let has_static = Path::new(&static_dir).is_dir();
    if has_static {
        if let Ok(content) = std::fs::read_to_string(format!("{static_dir}/index.html")) {
            state.index_template = Some(std::sync::Arc::new(content));
        }
    }
    let og_state = state.clone();

    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/2fa/verify", post(auth::verify_two_factor))
        .route("/auth/2fa/enable", post(auth::enable_two_factor))
        .route("/auth/2fa/disable", post(auth::disable_two_factor))
        .route("/auth/2fa/recovery-codes/regenerate", post(auth::regenerate_recovery_codes))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/auth/account", post(auth::update_account).delete(auth::delete_account))
        .route("/auth/forgot-password", post(auth::forgot_password))
        .route("/auth/reset-password", post(auth::reset_password))
        .route("/auth/login-history", get(auth::login_history))
        .route("/auth/sessions", get(auth::list_sessions))
        .route("/auth/sessions/revoke-others", post(auth::revoke_other_sessions))
        .route("/auth/sessions/{id}", delete(auth::revoke_session))
        .route("/settings", get(auth::settings))
        .route("/nutrition/today", get(nutrition::today))
        .route("/account/export", get(export::export))
        .route("/settings/notification-prefs", get(notify::list_prefs))
        .route("/settings/notification-prefs/{type}", put(notify::set_pref))
        .route("/ingredients", get(ingredients::list).post(ingredients::create))
        .route("/ingredients/categories", get(ingredients::categories))
        .route("/ingredients/{id}", get(ingredients::detail))
        .route("/ingredients/{id}/used-in", get(ingredients::used_in_meals))
        .route("/ingredients/{id}/reviews", get(ingredients::list_reviews).post(ingredients::submit_review))
        .route("/ingredients/{id}/reviews/{review_id}/helpful", post(ingredients::vote_review_helpful))
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
        .route("/meals/random", get(meals::random))
        .route("/meals/discover", get(meals::discover))
        .route("/meals/{id}", get(meals::detail).post(meals::update).delete(meals::delete))
        .route("/meals/{id}/fork", post(meals::fork))
        .route("/meals/{id}/duplicate", post(meals::duplicate))
        .route("/meals/{id}/save", post(meals::toggle_save))
        .route("/meals/{id}/occasions", get(meals::list_occasions))
        .route("/meals/{id}/occasions/{tag}/vote", post(meals::vote_occasion))
        .route("/meals/{id}/photo", post(meals::update_photo))
        .route("/meals/{id}/cook", post(meals::cook))
        .route("/meals/{id}/rate", post(meals::rate).delete(meals::unrate))
        .route("/meals/{id}/journal", get(meals::my_journal))
        .route("/meals/{id}/reviews", get(meals::meal_reviews))
        .route("/meals/{id}/reviews/{review_id}", put(meals::update_review))
        .route("/meals/{id}/reviews/{review_id}/helpful", post(meals::vote_review_helpful))
        .route("/meals/{id}/reviews/{review_id}/replies", post(meals::create_reply))
        .route("/meals/{id}/reviews/{review_id}/replies/{reply_id}", delete(meals::delete_reply))
        .route("/meals/{id}/revisions", get(meals::revisions))
        .route("/meals/{id}/revisions/{rev_id}/revert", post(meals::revert))
        .route("/meals/{id}/revisions/{rev_id}/vote", post(meals::vote_revision))
        .route("/meals/{id}/restore", post(meals::restore))
        .route("/meals/{id}/like", post(social::toggle_like))
        // kitchen
        .route("/fridge", get(kitchen::fridge_list).post(kitchen::fridge_add))
        .route("/fridge/{id}", delete(kitchen::fridge_remove))
        .route("/fridge/{id}/staple", post(kitchen::toggle_staple))
        .route("/shopping", get(kitchen::shopping_list).post(kitchen::shopping_add))
        .route("/shopping/many", post(kitchen::shopping_add_many))
        .route("/shopping/clear", delete(kitchen::shopping_clear))
        .route("/shopping/{id}", delete(kitchen::shopping_remove))
        .route("/shopping/{id}/got-it", post(kitchen::shopping_got_it))
        // cookbook lists
        .route("/cookbook/counts", get(kitchen::counts))
        .route("/cookbook/streak", get(kitchen::streak))
        .route("/cookbook/cooked", get(kitchen::cooked))
        .route("/cookbook/saved", get(kitchen::saved))
        .route("/cookbook/published", get(kitchen::published))
        .route("/cookbook/reviews", get(kitchen::my_reviews))
        .route("/cookbook/edits", get(kitchen::my_edits))
        .route("/cookbook/ratings", get(kitchen::my_ratings))
        .route("/cookbook/votes", get(kitchen::my_votes))
        // collections
        .route("/collections", get(collections::list).post(collections::create))
        .route("/collections/followed", get(collections::list_followed))
        .route("/collections/{id}", get(collections::detail).delete(collections::delete))
        .route("/collections/{id}/visibility", post(collections::set_visibility))
        .route("/collections/{id}/cover", post(collections::set_cover))
        .route("/collections/{id}/follow", post(collections::toggle_follow))
        .route("/collections/{id}/meals", post(collections::add_meal))
        .route("/collections/{id}/meals/{meal_id}", delete(collections::remove_meal))
        .route("/collections/{id}/meals/{meal_id}/move", post(collections::move_meal))
        .route("/collections/{id}/comments", get(collections::list_comments).post(collections::create_comment))
        .route("/collections/{id}/comments/{comment_id}", delete(collections::delete_comment))
        // import
        .route("/import/url", post(import::import_url))
        .route("/import/text", post(import::import_text))
        .route("/import/capabilities", get(import::capabilities))
        // meal planning
        .route("/plan", get(planner::list_plan).post(planner::add_plan_entry))
        .route("/plan/{id}", post(planner::update_plan_entry).delete(planner::remove_plan_entry))
        .route("/plan/{id}/move", post(planner::move_plan_entry))
        .route("/plan/templates", get(planner::list_templates).post(planner::save_template))
        .route("/plan/templates/{id}", delete(planner::delete_template))
        .route("/plan/templates/{id}/apply", post(planner::apply_template))
        .route("/plan/grocery", get(planner::grocery_list))
        .route("/plan/grocery/push", post(planner::push_to_shopping))
        .route("/plan/suggestions", get(planner::suggestions))
        // guides
        .route("/guides", get(guides::list))
        .route("/guides/{slug}", get(guides::detail))
        .route("/guides/{slug}/save", post(guides::toggle_save))
        .route("/guides/{slug}/complete", post(guides::toggle_complete))
        .route("/guides/{slug}/helpful", post(guides::vote_helpful))
        .route("/guides/{slug}/rate", post(guides::rate).delete(guides::unrate))
        .route("/guides/{slug}/related-meals", get(guides::related_meals))
        .route("/guides/{slug}/comments", get(guides::list_comments).post(guides::create_comment))
        .route("/guides/{slug}/comments/{comment_id}", delete(guides::delete_comment))
        .route("/guides/{slug}/edits", get(guides::list_edits).post(guides::submit_edit))
        .route("/guides/{slug}/edits/{edit_id}", delete(guides::delete_edit))
        .route("/guides/{slug}/edits/{edit_id}/vote", post(guides::vote_edit))
        // social
        .route("/feed", get(social::feed))
        .route("/activity", get(social::activity).post(social::mark_activity_seen))
        .route("/chefs", get(social::search_chefs))
        .route("/chefs/suggested", get(social::suggested_chefs))
        .route("/chefs/leaderboard", get(social::leaderboard))
        .route("/chefs/following", get(social::following))
        .route("/chefs/blocked", get(social::blocked_list))
        .route("/chefs/{id}", get(social::profile))
        .route("/chefs/{id}/follow", post(social::toggle_follow))
        .route("/chefs/{id}/block", post(social::toggle_block))
        .route("/chefs/{id}/published", get(social::chef_published))
        .route("/chefs/{id}/cooked", get(social::chef_cooked))
        .route("/chefs/{id}/reviews", get(social::chef_reviews))
        .route("/chefs/{id}/plan", get(planner::chef_plan))
        .route("/chefs/{id}/followers", get(social::chef_followers))
        .route("/chefs/{id}/following", get(social::chef_following))
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
    if has_static {
        let index = format!("{static_dir}/index.html");
        // These three paths get real per-page meta tags spliced into the
        // same shell (see og.rs) instead of falling straight through to the
        // generic static file below - everything else still does.
        let og_router = Router::new()
            .route("/meals/{id}", get(og::meal_page))
            .route("/ingredients/{id}", get(og::ingredient_page))
            .route("/guides/{slug}", get(og::guide_page))
            .with_state(og_state);
        app = app
            .merge(og_router)
            .fallback_service(ServeDir::new(&static_dir).fallback(ServeFile::new(index)));
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
