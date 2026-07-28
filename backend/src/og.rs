use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse, Response};

use crate::state::AppState;

const START: &str = "<!--OG-META-START-->";
const END: &str = "<!--OG-META-END-->";

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

/// A short, single-line description reads better in a link preview than a
/// full paragraph, which most unfurlers truncate awkwardly mid-word anyway.
fn clip(s: &str, max: usize) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() <= max {
        return s;
    }
    let truncated: String = s.chars().take(max).collect();
    format!("{}…", truncated.trim_end())
}

fn splice(template: &str, title: &str, description: &str, image: &str) -> String {
    let (Some(s), Some(e)) = (template.find(START), template.find(END)) else {
        return template.to_string();
    };
    if e < s {
        return template.to_string();
    }
    let tags = format!(
        "<title>{title} - Cookbook</title>\n\
         <meta property=\"og:type\" content=\"article\" />\n\
         <meta property=\"og:site_name\" content=\"Cookbook\" />\n\
         <meta property=\"og:title\" content=\"{title}\" />\n\
         <meta property=\"og:description\" content=\"{description}\" />\n\
         <meta property=\"og:image\" content=\"{image}\" />\n\
         <meta name=\"twitter:card\" content=\"summary_large_image\" />",
        title = escape(title),
        description = escape(description),
        image = escape(image),
    );
    format!("{}{}{}", &template[..s], tags, &template[e + END.len()..])
}

fn html_response(body: String) -> Response {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        Html(body),
    )
        .into_response()
}

/// Serves the app shell with this recipe's own name/photo/description
/// spliced into the `<head>`, instead of the generic default every other
/// path gets from the plain static-file fallback. A crawler or link
/// unfurler that doesn't run JavaScript sees real content on the very first
/// response; a real browser gets the exact same HTML and mounts the SPA
/// from it exactly as it would from the untouched file.
pub async fn meal_page(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let Some(template) = &state.index_template else {
        return StatusCode::NOT_FOUND.into_response();
    };
    // A malformed id (never produced by this app's own links, but a raw
    // typed-in URL is anyone's guess) falls back to the untouched shell
    // instead of a bare 400 - the SPA's own router still knows what to do
    // with it once it mounts.
    let Ok(id) = id.parse::<i64>() else {
        return html_response(template.as_str().to_string());
    };
    let row: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT name, description, photo_url FROM meals WHERE id = $1 AND status = 'live' AND visibility = 'public'",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    let Some((name, description, photo_url)) = row else {
        return html_response(template.as_str().to_string());
    };
    let description = description
        .filter(|d| !d.trim().is_empty())
        .map(|d| clip(&d, 160))
        .unwrap_or_else(|| "A recipe on Cookbook.".into());
    let image = photo_url.unwrap_or_else(|| "/pwa-512x512.png".into());
    html_response(splice(template, &name, &description, &image))
}

pub async fn ingredient_page(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let Some(template) = &state.index_template else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(id) = id.parse::<i64>() else {
        return html_response(template.as_str().to_string());
    };
    let row: Option<(String, Option<String>, Option<String>)> =
        sqlx::query_as("SELECT name, description, photo_url FROM ingredients WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);

    let Some((name, description, photo_url)) = row else {
        return html_response(template.as_str().to_string());
    };
    let description = description
        .filter(|d| !d.trim().is_empty())
        .map(|d| clip(&d, 160))
        .unwrap_or_else(|| format!("{name} on Cookbook: nutrition facts, substitutes, and the recipes that use it."));
    let image = photo_url.unwrap_or_else(|| "/pwa-512x512.png".into());
    html_response(splice(template, &name, &description, &image))
}

pub async fn guide_page(State(state): State<AppState>, Path(slug): Path<String>) -> Response {
    let Some(template) = &state.index_template else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT title, summary FROM guides WHERE slug = $1")
            .bind(&slug)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);

    let Some((title, summary)) = row else {
        return html_response(template.as_str().to_string());
    };
    html_response(splice(template, &title, &clip(&summary, 160), "/pwa-512x512.png"))
}
