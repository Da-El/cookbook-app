//! Recipe import.
//!
//! Extraction is deliberately layered so the expensive path can be added
//! later without reshaping anything: `Extractor` names who handled a given
//! import, `recipe_imports` records every attempt, and the LLM arm is wired
//! through end-to-end but returns `LlmNotConfigured` until a provider is
//! chosen. Adding it is implementing one function, not a refactor.

use std::net::IpAddr;
use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::CurrentUser;
use crate::state::AppState;
use crate::units::{parse_ingredient_line, ParsedIngredient};

const MAX_HTML_BYTES: usize = 3 * 1024 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DraftIngredient {
    /// The line exactly as the source wrote it, kept so the user can audit any
    /// bad parse rather than silently inheriting it.
    pub raw_line: String,
    pub amount: Option<f64>,
    pub unit: Option<String>,
    pub name: String,
    pub note: Option<String>,
    pub matched_ingredient_id: Option<i64>,
    pub matched_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecipeDraft {
    pub title: String,
    pub description: String,
    pub image_url: Option<String>,
    pub servings: Option<String>,
    pub total_minutes: Option<i32>,
    pub ingredients: Vec<DraftIngredient>,
    pub steps: Vec<String>,
    pub source_url: Option<String>,
    pub source_name: Option<String>,
}

#[derive(Debug)]
pub enum ImportError {
    BadUrl(String),
    Blocked(String),
    Fetch(String),
    NoRecipeFound,
    LlmNotConfigured,
}

impl ImportError {
    fn status(&self) -> StatusCode {
        match self {
            ImportError::BadUrl(_) | ImportError::Blocked(_) => StatusCode::BAD_REQUEST,
            ImportError::Fetch(_) => StatusCode::BAD_GATEWAY,
            ImportError::NoRecipeFound | ImportError::LlmNotConfigured => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
        }
    }

    fn message(&self) -> String {
        match self {
            ImportError::BadUrl(m) => format!("That doesn't look like a web address ({m})."),
            ImportError::Blocked(m) => format!("That address can't be fetched ({m})."),
            ImportError::Fetch(m) => format!("Couldn't load that page ({m})."),
            ImportError::NoRecipeFound => {
                "No recipe data on that page. Sites that don't publish a machine-readable \
                 recipe need the AI importer, which isn't switched on yet — for now you can \
                 paste the recipe in by hand."
                    .into()
            }
            ImportError::LlmNotConfigured => {
                "Reading free-form recipes needs the AI importer, which isn't switched on yet."
                    .into()
            }
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            ImportError::BadUrl(_) => "bad_url",
            ImportError::Blocked(_) => "blocked",
            ImportError::Fetch(_) => "fetch_failed",
            ImportError::NoRecipeFound => "no_recipe",
            ImportError::LlmNotConfigured => "llm_unavailable",
        }
    }
}

// ---------------------------------------------------------------- fetching

/// Rejects addresses that would make the server fetch its own network.
///
/// Without this, `POST /api/import/url` is a proxy into anything the container
/// can reach - most sharply the cloud metadata endpoint at 169.254.169.254.
/// The host is resolved and every returned address checked; a hostname that
/// re-resolves to a private address between this check and the request would
/// still slip through (DNS rebinding), which is why the fetch is also capped
/// in size and time and the final URL is re-validated.
async fn assert_public_url(raw: &str) -> Result<url::Url, ImportError> {
    let parsed = url::Url::parse(raw).map_err(|e| ImportError::BadUrl(e.to_string()))?;

    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(ImportError::Blocked(format!("{other} links aren't supported"))),
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| ImportError::BadUrl("no host".into()))?
        .to_string();
    let port = parsed.port_or_known_default().unwrap_or(80);

    let addrs: Vec<IpAddr> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|e| ImportError::Fetch(format!("couldn't resolve {host}: {e}")))?
        .map(|sa| sa.ip())
        .collect();

    if addrs.is_empty() {
        return Err(ImportError::Fetch(format!("{host} didn't resolve")));
    }
    if let Some(bad) = addrs.iter().find(|ip| !is_public(ip)) {
        return Err(ImportError::Blocked(format!("{bad} is not a public address")));
    }
    Ok(parsed)
}

fn is_public(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_unspecified()
                || v4.is_multicast()
                // 100.64.0.0/10, carrier-grade NAT - used internally by some hosts.
                || (o[0] == 100 && (o[1] & 0xC0) == 64)
                || o[0] == 0)
        }
        IpAddr::V6(v6) => {
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // fc00::/7 unique-local, fe80::/10 link-local.
                || (v6.segments()[0] & 0xFE00) == 0xFC00
                || (v6.segments()[0] & 0xFFC0) == 0xFE80
                // An IPv4-mapped address smuggling a private v4 in through v6.
                || v6
                    .to_ipv4_mapped()
                    .map(|v4| !is_public(&IpAddr::V4(v4)))
                    .unwrap_or(false))
        }
    }
}

async fn fetch_html(url: &str) -> Result<(String, String), ImportError> {
    let validated = assert_public_url(url).await?;

    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        // Redirects are capped low and confined to http(s); the final URL is
        // re-validated below so a public link can't bounce us somewhere internal.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 4 {
                return attempt.stop();
            }
            if matches!(attempt.url().scheme(), "http" | "https") {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        // Many recipe sites reject non-browser agents outright, so a plain
        // "CookbookApp/1.0" gets a 403 on the public page the user is looking
        // at in their own browser. This isn't a paywall or auth bypass - it's
        // the same page, fetched on their behalf.
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        )
        .build()
        .map_err(|e| ImportError::Fetch(e.to_string()))?;

    let res = client
        .get(validated.clone())
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-GB,en;q=0.9")
        .send()
        .await
        .map_err(|e| ImportError::Fetch(e.to_string()))?;

    if !res.status().is_success() {
        return Err(ImportError::Fetch(format!(
            "the site returned {}",
            res.status().as_u16()
        )));
    }

    let final_url = res.url().clone();
    if final_url != validated {
        assert_public_url(final_url.as_str()).await?;
    }

    let bytes = res.bytes().await.map_err(|e| ImportError::Fetch(e.to_string()))?;
    let truncated = &bytes[..bytes.len().min(MAX_HTML_BYTES)];
    Ok((String::from_utf8_lossy(truncated).to_string(), final_url.to_string()))
}

// ------------------------------------------------------------- extraction

/// Which path produced a draft. Persisted on `recipe_imports.extractor`.
#[derive(Debug, Clone, Copy)]
pub enum Extractor {
    JsonLd,
    Llm,
}

impl Extractor {
    fn as_str(self) -> &'static str {
        match self {
            Extractor::JsonLd => "jsonld",
            Extractor::Llm => "llm",
        }
    }
}

/// Pulls every `<script type="application/ld+json">` payload out of the page.
fn jsonld_blocks(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = html.to_lowercase();
    let mut cursor = 0;

    while let Some(rel) = lower[cursor..].find("<script") {
        let tag_start = cursor + rel;
        let Some(rel_gt) = lower[tag_start..].find('>') else { break };
        let tag_end = tag_start + rel_gt + 1;
        let tag = &lower[tag_start..tag_end];

        if tag.contains("application/ld+json") {
            if let Some(rel_close) = lower[tag_end..].find("</script") {
                out.push(html[tag_end..tag_end + rel_close].trim().to_string());
                cursor = tag_end + rel_close;
                continue;
            }
        }
        cursor = tag_end;
    }
    out
}

fn has_type(node: &serde_json::Value, wanted: &str) -> bool {
    match node.get("@type") {
        Some(serde_json::Value::String(s)) => s.eq_ignore_ascii_case(wanted),
        Some(serde_json::Value::Array(a)) => a
            .iter()
            .any(|v| v.as_str().map(|s| s.eq_ignore_ascii_case(wanted)).unwrap_or(false)),
        _ => false,
    }
}

/// Recipe nodes hide inside arrays and `@graph` wrappers as often as they sit
/// at the top level, so walk the whole document.
fn find_recipe(node: &serde_json::Value) -> Option<serde_json::Value> {
    if has_type(node, "Recipe") {
        return Some(node.clone());
    }
    match node {
        serde_json::Value::Array(items) => items.iter().find_map(find_recipe),
        serde_json::Value::Object(map) => map.values().find_map(find_recipe),
        _ => None,
    }
}

/// "PT1H30M" -> 90. None for anything unparseable.
fn iso8601_minutes(text: &str) -> Option<i32> {
    let t = text.trim().to_uppercase();
    let t = t.strip_prefix('P')?;
    let time_part = t.split_once('T').map(|(_, r)| r).unwrap_or("");
    let mut minutes = 0i32;
    let mut num = String::new();
    for ch in time_part.chars() {
        if ch.is_ascii_digit() {
            num.push(ch);
        } else {
            let v: i32 = num.parse().unwrap_or(0);
            num.clear();
            match ch {
                'H' => minutes += v * 60,
                'M' => minutes += v,
                _ => {}
            }
        }
    }
    if minutes > 0 { Some(minutes) } else { None }
}

fn strip_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut depth = 0usize;
    for ch in input.chars() {
        match ch {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn as_text(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(strip_tags(s)),
        serde_json::Value::Array(a) => a.first().and_then(as_text),
        serde_json::Value::Object(o) => o
            .get("text")
            .or_else(|| o.get("name"))
            .or_else(|| o.get("url"))
            .and_then(as_text),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn image_url(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(a) => a.first().and_then(image_url),
        serde_json::Value::Object(o) => o.get("url").and_then(image_url),
        _ => None,
    }
}

/// Instructions arrive as plain strings, HowToStep objects, or HowToSection
/// wrappers containing more of either. Flatten all three into ordered text.
fn collect_steps(v: &serde_json::Value, out: &mut Vec<String>) {
    match v {
        serde_json::Value::String(s) => {
            for line in s.split('\n') {
                let t = strip_tags(line);
                if !t.trim().is_empty() {
                    out.push(t.trim().to_string());
                }
            }
        }
        serde_json::Value::Array(items) => items.iter().for_each(|i| collect_steps(i, out)),
        serde_json::Value::Object(o) => {
            if has_type(v, "HowToSection") {
                if let Some(list) = o.get("itemListElement") {
                    collect_steps(list, out);
                    return;
                }
            }
            if let Some(t) = o.get("text").and_then(as_text) {
                if !t.trim().is_empty() {
                    out.push(t.trim().to_string());
                    return;
                }
            }
            if let Some(t) = o.get("name").and_then(as_text) {
                if !t.trim().is_empty() {
                    out.push(t.trim().to_string());
                }
            }
        }
        _ => {}
    }
}

fn draft_from_jsonld(recipe: &serde_json::Value, source_url: &str) -> RecipeDraft {
    let title = recipe
        .get("name")
        .and_then(as_text)
        .unwrap_or_else(|| "Imported recipe".into());
    let description = recipe.get("description").and_then(as_text).unwrap_or_default();

    let total_minutes = ["totalTime", "cookTime", "prepTime"]
        .iter()
        .filter_map(|k| recipe.get(*k).and_then(as_text))
        .find_map(|t| iso8601_minutes(&t));

    let ingredients = recipe
        .get("recipeIngredient")
        .or_else(|| recipe.get("ingredients"))
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(as_text)
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let ParsedIngredient { amount, unit, name, note } = parse_ingredient_line(&line);
            DraftIngredient {
                raw_line: line,
                amount,
                unit,
                name,
                note,
                matched_ingredient_id: None,
                matched_name: None,
            }
        })
        .collect();

    let mut steps = Vec::new();
    if let Some(v) = recipe.get("recipeInstructions") {
        collect_steps(v, &mut steps);
    }

    let source_name = url::Url::parse(source_url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string()));

    RecipeDraft {
        title,
        description,
        image_url: recipe.get("image").and_then(image_url),
        servings: recipe.get("recipeYield").and_then(as_text),
        total_minutes,
        ingredients,
        steps,
        source_url: Some(source_url.to_string()),
        source_name,
    }
}

// ------------------------------------------------------ pasted-text import

fn looks_like_heading(line: &str, words: &[&str]) -> bool {
    let l = line.trim().trim_end_matches(':').trim().to_lowercase();
    l.len() <= 24 && words.iter().any(|w| l == *w || l.starts_with(w))
}

const INGREDIENT_HEADINGS: &[&str] = &["ingredients", "you will need", "you'll need", "shopping list"];
const STEP_HEADINGS: &[&str] =
    &["instructions", "method", "directions", "steps", "preparation", "to make", "how to"];

/// True when a line reads like a shopping quantity rather than a sentence.
fn looks_like_ingredient(line: &str) -> bool {
    let t = line.trim().trim_start_matches(['-', '*', '•', '·']).trim();
    if t.is_empty() || t.len() > 90 {
        return false;
    }
    let starts_numeric = t
        .chars()
        .next()
        .map(|c| c.is_ascii_digit() || "½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞".contains(c))
        .unwrap_or(false);
    // A parsed unit is strong evidence even without a leading number
    // ("a pinch of salt"); a trailing full stop suggests prose instead.
    let parsed = parse_ingredient_line(t);
    (starts_numeric || parsed.unit.is_some()) && !t.ends_with('.')
}

/// Splits pasted text into a draft using layout cues.
///
/// This is the path that works when a site blocks server-side fetching, which
/// a growing number do. It's heuristic by nature - the review screen exists so
/// the user can correct it - and it's the same shape the LLM extractor will
/// return, so swapping in a better parser changes nothing downstream.
fn draft_from_text(text: &str, title_hint: Option<&str>) -> RecipeDraft {
    let lines: Vec<&str> = text.lines().map(|l| l.trim()).collect();

    let mut title = title_hint.map(|s| s.to_string()).unwrap_or_default();
    let mut ingredients_raw: Vec<String> = Vec::new();
    let mut steps: Vec<String> = Vec::new();

    // Section headings are the strongest signal when the paste has them.
    let ing_at = lines.iter().position(|l| looks_like_heading(l, INGREDIENT_HEADINGS));
    let step_at = lines.iter().position(|l| looks_like_heading(l, STEP_HEADINGS));

    match (ing_at, step_at) {
        (Some(i), Some(s)) if s > i => {
            for l in &lines[i + 1..s] {
                if !l.is_empty() {
                    ingredients_raw.push(l.to_string());
                }
            }
            for l in &lines[s + 1..] {
                if !l.is_empty() {
                    steps.push(strip_step_number(l));
                }
            }
            if title.is_empty() {
                title = lines[..i].iter().find(|l| !l.is_empty()).unwrap_or(&"").to_string();
            }
        }
        _ => {
            // No headings: classify line by line, and treat the first
            // non-ingredient line as the title if we still need one.
            for l in &lines {
                if l.is_empty() {
                    continue;
                }
                if looks_like_ingredient(l) {
                    ingredients_raw.push(l.to_string());
                } else if title.is_empty() && ingredients_raw.is_empty() && steps.is_empty() {
                    title = l.to_string();
                } else {
                    steps.push(strip_step_number(l));
                }
            }
        }
    }

    let ingredients = ingredients_raw
        .into_iter()
        .map(|line| {
            let cleaned = line.trim_start_matches(['-', '*', '•', '·']).trim().to_string();
            let ParsedIngredient { amount, unit, name, note } = parse_ingredient_line(&cleaned);
            DraftIngredient {
                raw_line: cleaned,
                amount,
                unit,
                name,
                note,
                matched_ingredient_id: None,
                matched_name: None,
            }
        })
        .collect();

    RecipeDraft {
        title: if title.is_empty() { "Pasted recipe".into() } else { title },
        description: String::new(),
        image_url: None,
        servings: None,
        total_minutes: None,
        ingredients,
        steps,
        source_url: None,
        source_name: None,
    }
}

/// "1. Heat the oil" -> "Heat the oil"; the UI numbers steps itself.
fn strip_step_number(line: &str) -> String {
    let t = line.trim().trim_start_matches(['-', '*', '•', '·']).trim();
    let digits: String = t.chars().take_while(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty() && digits.len() <= 2 {
        let rest = &t[digits.len()..];
        let rest = rest.trim_start_matches([')', '.', ':']).trim();
        if !rest.is_empty() {
            return rest.to_string();
        }
    }
    t.to_string()
}

#[derive(Deserialize)]
pub struct ImportTextBody {
    pub text: String,
    pub title: Option<String>,
}

pub async fn import_text(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<ImportTextBody>,
) -> Result<(StatusCode, Json<ImportResponse>), (StatusCode, Json<serde_json::Value>)> {
    let text = body.text.trim().to_string();
    if text.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Paste a recipe first.", "kind": "empty" })),
        ));
    }

    let mut draft = draft_from_text(&text, body.title.as_deref());
    attach_matches(&state.db, &mut draft).await;

    let matched_count = draft
        .ingredients
        .iter()
        .filter(|i| i.matched_ingredient_id.is_some())
        .count();
    let total_count = draft.ingredients.len();

    let import_id: i64 = sqlx::query_scalar(
        "INSERT INTO recipe_imports (user_id, source_kind, source_text, extractor, status, draft)
         VALUES ($1,'text',$2,'manual','extracted',$3) RETURNING id",
    )
    .bind(user.id)
    .bind(&text)
    .bind(serde_json::to_value(&draft).unwrap_or(serde_json::Value::Null))
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("recording text import failed: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Could not save that import." })),
        )
    })?;

    Ok((
        StatusCode::OK,
        Json(ImportResponse {
            import_id,
            extractor: "manual".into(),
            draft,
            matched_count,
            total_count,
        }),
    ))
}

/// The LLM arm, wired through but not implemented.
///
/// Everything around it is finished: the route, the staging table, the
/// extractor tag, the draft shape, and the review screen. Turning it on means
/// filling this in and setting `LLM_API_KEY` - no schema or API change.
async fn llm_extract(_html: &str, _source_url: &str) -> Result<RecipeDraft, ImportError> {
    Err(ImportError::LlmNotConfigured)
}

fn llm_available() -> bool {
    std::env::var("LLM_API_KEY").is_ok()
}

// --------------------------------------------------------------- matching

/// Links a written ingredient name to a catalog page when one plausibly fits.
///
/// USDA names are formal and comma-qualified ("Tomatoes, grape, raw"), so the
/// part before the first comma is the noun worth matching. The four-character
/// floor stops short nouns over-matching - without it "Egg" swallows
/// "eggplant".
async fn match_ingredient(db: &sqlx::PgPool, name: &str) -> Option<(i64, String)> {
    let cleaned = name.trim().to_lowercase();
    if cleaned.is_empty() {
        return None;
    }
    sqlx::query_as::<_, (i64, String)>(
        "SELECT id, name FROM ingredients
         WHERE lower(name) = $1
            OR lower(split_part(name, ',', 1)) = $1
            OR (length(split_part(name, ',', 1)) >= 4
                AND $1 LIKE '%' || lower(split_part(name, ',', 1)) || '%')
         ORDER BY
           (lower(name) = $1) DESC,
           (lower(split_part(name, ',', 1)) = $1) DESC,
           length(name)
         LIMIT 1",
    )
    .bind(&cleaned)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
}

async fn attach_matches(db: &sqlx::PgPool, draft: &mut RecipeDraft) {
    for ing in &mut draft.ingredients {
        if let Some((id, name)) = match_ingredient(db, &ing.name).await {
            ing.matched_ingredient_id = Some(id);
            ing.matched_name = Some(name);
        }
    }
}

// ----------------------------------------------------------------- routes

#[derive(Deserialize)]
pub struct ImportUrlBody {
    pub url: String,
}

#[derive(Serialize)]
pub struct ImportResponse {
    pub import_id: i64,
    pub extractor: String,
    pub draft: RecipeDraft,
    /// How many lines found a catalog page, so the review screen can say so.
    pub matched_count: usize,
    pub total_count: usize,
}

pub async fn import_url(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<ImportUrlBody>,
) -> Result<(StatusCode, Json<ImportResponse>), (StatusCode, Json<serde_json::Value>)> {
    let raw = body.url.trim().to_string();
    if raw.is_empty() {
        return Err(fail(&ImportError::BadUrl("empty".into())));
    }
    // A bare domain is the common paste, so assume https. Only add the scheme
    // when there isn't one at all - prefixing "file://..." would turn a clear
    // "unsupported scheme" into a confusing DNS failure.
    let url = if raw.contains("://") { raw } else { format!("https://{raw}") };

    match extract_from_url(&url).await {
        Ok((mut draft, extractor)) => {
            attach_matches(&state.db, &mut draft).await;
            let matched_count = draft
                .ingredients
                .iter()
                .filter(|i| i.matched_ingredient_id.is_some())
                .count();
            let total_count = draft.ingredients.len();

            let import_id: i64 = sqlx::query_scalar(
                "INSERT INTO recipe_imports (user_id, source_kind, source_url, extractor, status, draft)
                 VALUES ($1,'url',$2,$3,'extracted',$4) RETURNING id",
            )
            .bind(user.id)
            .bind(&url)
            .bind(extractor.as_str())
            .bind(serde_json::to_value(&draft).unwrap_or(serde_json::Value::Null))
            .fetch_one(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("recording import failed: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "Could not save that import." })),
                )
            })?;

            Ok((
                StatusCode::OK,
                Json(ImportResponse {
                    import_id,
                    extractor: extractor.as_str().to_string(),
                    draft,
                    matched_count,
                    total_count,
                }),
            ))
        }
        Err(err) => {
            // Failures are recorded too: they're the backlog of pages the LLM
            // extractor should be measured against once it exists.
            sqlx::query(
                "INSERT INTO recipe_imports (user_id, source_kind, source_url, extractor, status, error)
                 VALUES ($1,'url',$2,'jsonld','failed',$3)",
            )
            .bind(user.id)
            .bind(&url)
            .bind(err.message())
            .execute(&state.db)
            .await
            .ok();
            Err(fail(&err))
        }
    }
}

async fn extract_from_url(url: &str) -> Result<(RecipeDraft, Extractor), ImportError> {
    let (html, final_url) = fetch_html(url).await?;

    for block in jsonld_blocks(&html) {
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&block) else { continue };
        if let Some(recipe) = find_recipe(&parsed) {
            let draft = draft_from_jsonld(&recipe, &final_url);
            if !draft.ingredients.is_empty() || !draft.steps.is_empty() {
                return Ok((draft, Extractor::JsonLd));
            }
        }
    }

    // No structured data: precisely the case the LLM extractor exists for.
    if !llm_available() {
        return Err(ImportError::NoRecipeFound);
    }
    llm_extract(&html, &final_url).await.map(|d| (d, Extractor::Llm))
}

fn fail(err: &ImportError) -> (StatusCode, Json<serde_json::Value>) {
    (
        err.status(),
        Json(serde_json::json!({ "error": err.message(), "kind": err.kind() })),
    )
}

/// Reports whether the free-form/AI importer is usable, so the UI can label
/// the manual-paste path honestly instead of offering something that 422s.
pub async fn capabilities() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "url_import": true,
        "ai_import": llm_available(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_recipe_inside_graph_wrapper() {
        let doc: serde_json::Value = serde_json::from_str(
            r#"{"@graph":[{"@type":"WebSite"},{"@type":["Recipe"],"name":"Soup"}]}"#,
        )
        .unwrap();
        let found = find_recipe(&doc).expect("recipe in @graph");
        assert_eq!(found.get("name").unwrap(), "Soup");
    }

    #[test]
    fn extracts_jsonld_script_blocks() {
        let html = r#"<html><head>
            <script type="application/ld+json">{"a":1}</script>
            <script src="x.js"></script>
            <script type="application/ld+json">{"b":2}</script>
        </head></html>"#;
        let blocks = jsonld_blocks(html);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0], r#"{"a":1}"#);
    }

    #[test]
    fn parses_iso_durations() {
        assert_eq!(iso8601_minutes("PT30M"), Some(30));
        assert_eq!(iso8601_minutes("PT1H30M"), Some(90));
        assert_eq!(iso8601_minutes("PT2H"), Some(120));
        assert_eq!(iso8601_minutes("garbage"), None);
    }

    #[test]
    fn flattens_howto_sections() {
        let v: serde_json::Value = serde_json::from_str(
            r#"[{"@type":"HowToSection","itemListElement":[
                 {"@type":"HowToStep","text":"Chop onions"},
                 {"@type":"HowToStep","text":"Fry them"}]}]"#,
        )
        .unwrap();
        let mut steps = Vec::new();
        collect_steps(&v, &mut steps);
        assert_eq!(steps, vec!["Chop onions", "Fry them"]);
    }

    #[test]
    fn strips_markup_from_instructions() {
        assert_eq!(strip_tags("<p>Mix <b>well</b>&amp; rest</p>"), "Mix well& rest");
    }

    #[test]
    fn builds_a_draft_from_a_realistic_payload() {
        let recipe: serde_json::Value = serde_json::from_str(
            r#"{"@type":"Recipe","name":"Tomato Soup","description":"Cosy.",
                "totalTime":"PT45M","recipeYield":"4 servings",
                "image":["https://example.com/a.jpg"],
                "recipeIngredient":["2 cups whole milk","1 (14 oz) can diced tomatoes","Salt to taste"],
                "recipeInstructions":[{"@type":"HowToStep","text":"Warm the milk."},
                                      {"@type":"HowToStep","text":"Add tomatoes."}]}"#,
        )
        .unwrap();
        let d = draft_from_jsonld(&recipe, "https://www.example.com/soup");

        assert_eq!(d.title, "Tomato Soup");
        assert_eq!(d.total_minutes, Some(45));
        assert_eq!(d.servings.as_deref(), Some("4 servings"));
        assert_eq!(d.source_name.as_deref(), Some("example.com"));
        assert_eq!(d.steps.len(), 2);
        assert_eq!(d.ingredients.len(), 3);

        assert_eq!(d.ingredients[0].amount, Some(2.0));
        assert_eq!(d.ingredients[0].unit.as_deref(), Some("cup"));
        assert_eq!(d.ingredients[0].name, "whole milk");
        // The unparsed line is retained so a bad parse stays auditable.
        assert_eq!(d.ingredients[2].raw_line, "Salt to taste");
        assert_eq!(d.ingredients[2].amount, None);
    }

    #[test]
    fn text_import_uses_section_headings() {
        let d = draft_from_text(
            "Garlic Butter Pasta\n\nIngredients\n200g spaghetti\n3 cloves garlic\n50 g butter\n\n\
             Method\n1. Boil the pasta.\n2. Melt the butter with the garlic.\n",
            None,
        );
        assert_eq!(d.title, "Garlic Butter Pasta");
        assert_eq!(d.ingredients.len(), 3);
        assert_eq!(d.steps, vec!["Boil the pasta.", "Melt the butter with the garlic."]);
        assert_eq!(d.ingredients[1].amount, Some(3.0));
        assert_eq!(d.ingredients[1].unit.as_deref(), Some("clove"));
    }

    #[test]
    fn text_import_classifies_without_headings() {
        let d = draft_from_text(
            "Quick Eggs\n2 eggs\n1 tbsp butter\nBeat the eggs in a bowl and season them.\n\
             Melt the butter in a pan over a low heat.\n",
            None,
        );
        assert_eq!(d.title, "Quick Eggs");
        assert_eq!(d.ingredients.len(), 2);
        assert_eq!(d.steps.len(), 2);
    }

    #[test]
    fn step_numbering_is_stripped() {
        assert_eq!(strip_step_number("1. Heat the oil"), "Heat the oil");
        assert_eq!(strip_step_number("- Chop it"), "Chop it");
        assert_eq!(strip_step_number("12) Rest"), "Rest");
        // A quantity that happens to lead a line must survive intact.
        assert_eq!(strip_step_number("350 F oven"), "350 F oven");
    }

    #[test]
    fn prose_is_not_mistaken_for_an_ingredient() {
        assert!(looks_like_ingredient("2 cups flour"));
        assert!(looks_like_ingredient("- 3 cloves garlic"));
        assert!(!looks_like_ingredient("Preheat the oven to 200C."));
        assert!(!looks_like_ingredient(
            "2 minutes later, once the butter has melted, add the garlic and stir it through."
        ));
    }

    #[test]
    fn private_addresses_are_not_public() {
        for ip in ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "172.16.0.1", "::1"] {
            assert!(!is_public(&ip.parse().unwrap()), "{ip} must be blocked");
        }
        for ip in ["1.1.1.1", "93.184.216.34"] {
            assert!(is_public(&ip.parse().unwrap()), "{ip} should be allowed");
        }
    }

    #[test]
    fn ipv4_mapped_private_v6_is_blocked() {
        assert!(!is_public(&"::ffff:127.0.0.1".parse().unwrap()));
        assert!(!is_public(&"::ffff:10.0.0.1".parse().unwrap()));
    }
}
