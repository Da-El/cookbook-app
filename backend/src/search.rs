//! Search that ranks, stems, and tolerates a typo.
//!
//! What it replaces was `name ILIKE '%term%'`: no ordering (so the best match
//! sat wherever the table happened to put it), no stemming ("tomatoes" missed
//! "tomato"), and blind to everything but the title.
//!
//! Two passes, unioned:
//!
//!   * **tsvector** does the real work - weighted so a title match outranks a
//!     step-4 mention, and stemmed so plurals and tenses collapse.
//!   * **trigram similarity** catches what tsvector structurally cannot: a
//!     misspelling never produces the right lexeme, so "carbonarra" matches
//!     nothing at all until you compare the strings themselves.
//!
//! Rank and the Bayesian `ranked_score` are combined rather than one replacing
//! the other: relevance decides *whether* something is an answer, quality
//! decides which of several equally-relevant answers to read first.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::CurrentUser;
use crate::state::AppState;

/// Below this, a trigram match is noise rather than a near-miss. 0.3 is
/// postgres' own default for the `%` operator; kept explicit so it's tunable
/// and doesn't silently change with a server setting.
const TRIGRAM_FLOOR: f64 = 0.3;

#[derive(Deserialize)]
pub struct SearchParams {
    #[serde(alias = "search")]
    pub q: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct MealHit {
    pub id: i64,
    pub name: String,
    pub author_id: i64,
    pub author_name: String,
    pub cuisine: String,
    pub meal_type: String,
    pub time_minutes: i32,
    pub rating: f64,
    pub rating_count: i32,
    pub ranked_score: f64,
    pub photo_url: Option<String>,
    pub have_count: i64,
    pub total_count: i64,
    /// Why this row is here - the UI says so rather than leaving a fuzzy match
    /// looking like an exact one.
    pub match_kind: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct IngredientHit {
    pub id: i64,
    pub name: String,
    pub category: String,
    pub food_group: Option<String>,
    pub food_subgroup: Option<String>,
    pub rating: f64,
    pub rating_count: i32,
    pub ranked_score: f64,
    /// Set when the hit came from a community alias rather than the catalog
    /// name, so the page can say "matched 'cilantro'" instead of looking wrong.
    pub matched_alias: Option<String>,
    pub match_kind: String,
}

#[derive(Serialize)]
pub struct SearchResults {
    pub query: String,
    pub meals: Vec<MealHit>,
    pub ingredients: Vec<IngredientHit>,
}

/// Turns typed text into a prefix-matching tsquery.
///
/// `websearch_to_tsquery` would handle quotes and OR, but it can't do prefix
/// matching, and search-as-you-type is mostly half-typed words - "chick"
/// should find chicken before the user finishes. So: split on non-alphanumerics
/// and AND the terms together, last one prefixed.
///
/// Terms are passed as a parameter to `to_tsquery`, never concatenated into
/// SQL, so a stray `&` or `!` can't become query syntax.
fn to_prefix_query(raw: &str) -> Option<String> {
    let terms: Vec<String> = raw
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_lowercase())
        .collect();
    if terms.is_empty() {
        return None;
    }
    let last = terms.len() - 1;
    Some(
        terms
            .iter()
            .enumerate()
            .map(|(i, t)| if i == last { format!("{t}:*") } else { t.clone() })
            .collect::<Vec<_>>()
            .join(" & "),
    )
}

pub async fn search(
    State(state): State<AppState>,
    user: Option<CurrentUser>,
    Query(p): Query<SearchParams>,
) -> Result<Json<SearchResults>, StatusCode> {
    let viewer = user.map(|u| u.0.id);
    let raw = p.q.unwrap_or_default();
    let raw = raw.trim();
    let limit = p.limit.unwrap_or(30).clamp(1, 100);

    let Some(tsq) = to_prefix_query(raw) else {
        return Ok(Json(SearchResults { query: raw.into(), meals: vec![], ingredients: vec![] }));
    };

    let meals = search_meals(&state, &tsq, raw, viewer, limit).await.map_err(|e| {
        tracing::error!("meal search failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let ingredients = search_ingredients(&state, &tsq, raw, limit).await.map_err(|e| {
        tracing::error!("ingredient search failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(SearchResults { query: raw.into(), meals, ingredients }))
}

pub async fn search_meals(
    state: &AppState,
    tsq: &str,
    raw: &str,
    viewer: Option<i64>,
    limit: i64,
) -> Result<Vec<MealHit>, sqlx::Error> {
    // ts_rank_cd over the weighted vector, then ranked_score as a tiebreak
    // scaled down enough that quality orders equal relevance without ever
    // overturning it. A 9-rated meal about something else is still not the
    // answer to what was asked.
    sqlx::query_as::<_, MealHit>(
        "SELECT m.id, m.name, m.author_id, u.display_name AS author_name, m.cuisine, m.meal_type,
                m.time_minutes, m.rating::float8 AS rating, m.rating_count,
                m.ranked_score::float8 AS ranked_score, m.photo_url,
                COALESCE(m.have_count, 0) AS have_count, COALESCE(m.total_count, 0) AS total_count,
                m.match_kind
         FROM (
           SELECT m.*,
             (SELECT count(*) FROM meal_ingredients mi
                WHERE mi.meal_id = m.id AND mi.ingredient_id IS NOT NULL
                  AND EXISTS (SELECT 1 FROM fridge_items f
                              WHERE f.user_id = $1 AND f.ingredient_id = mi.ingredient_id)) AS have_count,
             (SELECT count(*) FROM meal_ingredients mi WHERE mi.meal_id = m.id) AS total_count,
             ts_rank_cd(m.search_vector, to_tsquery('english', $2)) AS rank,
             -- Ordered so 'former-name' is claimed only when the *current*
             -- name doesn't already match: a rename shouldn't relabel a row
             -- that would have been found anyway.
             CASE
               WHEN to_tsvector('english', m.name) @@ to_tsquery('english', $2) THEN 'text'
               WHEN m.former_names <> ''
                 AND to_tsvector('english', m.former_names) @@ to_tsquery('english', $2)
                 THEN 'former-name'
               WHEN m.search_vector @@ to_tsquery('english', $2) THEN 'text'
               ELSE 'fuzzy'
             END AS match_kind
           FROM meals m
           WHERE m.visibility = 'public' AND m.status = 'live'
             AND (m.search_vector @@ to_tsquery('english', $2)
                  OR similarity(m.name, $3) >= $4)
         ) m
         JOIN users u ON u.id = m.author_id
         ORDER BY
           (m.rank * 4 + GREATEST(similarity(m.name, $3), 0) * 2 + m.ranked_score / 40) DESC,
           m.rating_count DESC
         LIMIT $5",
    )
    .bind(viewer)
    .bind(tsq)
    .bind(raw)
    .bind(TRIGRAM_FLOOR)
    .bind(limit)
    .fetch_all(&state.db)
    .await
}

pub async fn search_ingredients(
    state: &AppState,
    tsq: &str,
    raw: &str,
    limit: i64,
) -> Result<Vec<IngredientHit>, sqlx::Error> {
    // The alias join is the reason this can find "Coriander, leaves, raw" from
    // the word cilantro. It only considers aliases the community has actually
    // endorsed - a lone proposal must not steer search.
    //
    // The lateral runs per catalog row, which forgoes the GIN index; on a few
    // hundred ingredients that's a handful of index probes on a tiny table and
    // cheaper than the alternative. Split this into a UNION of an
    // index-driven text branch and an alias branch if the catalog reaches the
    // tens of thousands.
    sqlx::query_as::<_, IngredientHit>(
        "SELECT i.id, i.name, i.category, i.food_group, i.food_subgroup,
                i.rating::float8 AS rating, i.rating_count,
                i.ranked_score::float8 AS ranked_score,
                al.name AS matched_alias,
                CASE
                  WHEN i.search_vector @@ to_tsquery('english', $1) THEN 'text'
                  WHEN al.name IS NOT NULL THEN 'alias'
                  ELSE 'fuzzy'
                END AS match_kind
         FROM ingredients i
         LEFT JOIN LATERAL (
           SELECT a.name, similarity(a.name, $2) AS sim
           FROM ingredient_aliases a
           WHERE a.ingredient_id = i.id AND a.status = 'live' AND a.score >= $5
             AND (a.name ILIKE '%' || $2 || '%' OR similarity(a.name, $2) >= $3)
           ORDER BY sim DESC LIMIT 1
         ) al ON TRUE
         WHERE i.search_vector @@ to_tsquery('english', $1)
            OR similarity(i.name, $2) >= $3
            OR al.name IS NOT NULL
         ORDER BY
           (ts_rank_cd(i.search_vector, to_tsquery('english', $1)) * 4
            + GREATEST(similarity(i.name, $2), 0) * 2
            + CASE WHEN al.name IS NOT NULL THEN 2.0 ELSE 0 END
            + i.ranked_score / 40) DESC,
           i.rating_count DESC,
           length(i.name)
         LIMIT $4",
    )
    .bind(tsq)
    .bind(raw)
    .bind(TRIGRAM_FLOOR)
    .bind(limit)
    .bind(crate::aliases::SEARCH_THRESHOLD)
    .fetch_all(&state.db)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_term_is_a_prefix_so_half_typed_words_match() {
        assert_eq!(to_prefix_query("chick").unwrap(), "chick:*");
        assert_eq!(to_prefix_query("roast chick").unwrap(), "roast & chick:*");
    }

    #[test]
    fn punctuation_is_a_separator_not_query_syntax() {
        // '&', '!' and '|' are tsquery operators. Reaching to_tsquery as
        // operators they'd either error or silently change the query's meaning.
        assert_eq!(to_prefix_query("egg & bacon").unwrap(), "egg & bacon:*");
        assert_eq!(to_prefix_query("mac!cheese").unwrap(), "mac & cheese:*");
        assert_eq!(to_prefix_query("a|b").unwrap(), "a & b:*");
        assert_eq!(to_prefix_query("Tomatoes, raw").unwrap(), "tomatoes & raw:*");
    }

    #[test]
    fn blank_and_punctuation_only_queries_yield_nothing_rather_than_a_broken_tsquery() {
        assert!(to_prefix_query("").is_none());
        assert!(to_prefix_query("   ").is_none());
        assert!(to_prefix_query("!!!").is_none());
        assert!(to_prefix_query("&|!():*").is_none());
    }

    #[test]
    fn case_is_folded_so_the_query_matches_the_lexemes_postgres_stored() {
        assert_eq!(to_prefix_query("CHICKEN Soup").unwrap(), "chicken & soup:*");
    }
}
