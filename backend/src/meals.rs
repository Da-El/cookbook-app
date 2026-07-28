use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::CurrentUser;
use crate::state::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct MealCard {
    pub id: i64,
    pub name: String,
    pub author_id: i64,
    pub author_name: String,
    pub cuisine: String,
    pub meal_type: String,
    pub time_minutes: i32,
    pub rating: f64,
    pub rating_count: i32,
    pub photo_url: Option<String>,
    /// How many of this meal's ingredients the viewer has in their fridge.
    pub have_count: i64,
    pub total_count: i64,
    /// The single highest `ranked_score` in its cuisine among meals with
    /// enough ratings to trust - visible proof the Bayesian ranking is doing
    /// something, not just an invisible sort tweak.
    pub is_top_in_cuisine: bool,
    /// Diets every catalog-matched ingredient supports - a free-text or
    /// unmatched line neither confirms nor rules one out, so it's simply not
    /// counted (same "don't claim more than is known" rule nutrition.rs
    /// uses). Empty when nothing is matched yet, not "compatible with nothing."
    pub diet_tags: Vec<String>,
    /// "easy" | "medium" | "hard" - heuristic, see `meal_difficulty_sql!`.
    pub difficulty: String,
}

/// Appended to a `MealCard`-shaped SELECT: true only for the single meal in
/// its cuisine with the highest ranked_score, and only once it has enough
/// ratings (>= 3) to trust that ranking rather than one enthusiastic vote.
/// A correlated NOT EXISTS rather than a window function on purpose - a
/// window function's partition would only ever see the current filtered/
/// paginated result set, which would crown a false "top" whenever a search
/// or cuisine filter hides the real one.
macro_rules! is_top_in_cuisine_sql {
    () => {
        "(m.rating_count >= 3 AND NOT EXISTS (
            SELECT 1 FROM meals m2
            WHERE m2.cuisine = m.cuisine AND m2.visibility = 'public' AND m2.status = 'live'
              AND m2.rating_count >= 3 AND m2.ranked_score > m.ranked_score
          )) AS is_top_in_cuisine"
    };
}

/// Appended alongside `is_top_in_cuisine_sql!`: the diet tags every
/// catalog-matched ingredient in the meal shares. Requires at least one
/// matched ingredient (an all-unmatched recipe claims nothing, rather than
/// vacuously "compatible with every diet" because there's nothing to
/// disqualify it).
macro_rules! meal_diet_tags_sql {
    () => {
        "(SELECT COALESCE(array_agg(d ORDER BY d), '{}')
            FROM unnest(ARRAY['vegetarian','vegan','pescatarian','gluten-free','dairy-free','nut-free']) d
            WHERE EXISTS (
                    SELECT 1 FROM meal_ingredients mi3
                    WHERE mi3.meal_id = m.id AND mi3.ingredient_id IS NOT NULL
                  )
              AND NOT EXISTS (
                    SELECT 1 FROM meal_ingredients mi2
                    JOIN ingredients i2 ON i2.id = mi2.ingredient_id
                    WHERE mi2.meal_id = m.id AND mi2.ingredient_id IS NOT NULL
                      AND NOT (d = ANY(i2.diet_flags))
                  )
          ) AS diet_tags"
    };
}

/// Appended alongside `is_top_in_cuisine_sql!`/`meal_diet_tags_sql!`: a
/// rough difficulty label with no dedicated column behind it, in the same
/// spirit as diet.rs's heuristic - derived from what's already on the row
/// (step count, time) rather than asking every author to self-rate
/// something notoriously inconsistent between people. Self-contained (only
/// reads `m.steps`/`m.time_minutes`), so it drops into any query that
/// already has `m` in scope without needing sibling aliases computed first.
macro_rules! meal_difficulty_case_sql {
    () => {
        "CASE
            WHEN COALESCE(array_length(m.steps, 1), 0) <= 4 AND m.time_minutes <= 25 THEN 'easy'
            WHEN COALESCE(array_length(m.steps, 1), 0) > 10 OR m.time_minutes > 75 THEN 'hard'
            ELSE 'medium'
          END"
    };
}
macro_rules! meal_difficulty_sql {
    () => {
        concat!("(", meal_difficulty_case_sql!(), ") AS difficulty")
    };
}

#[derive(Deserialize)]
pub struct BrowseParams {
    pub search: Option<String>,
    pub cuisine: Option<String>,
    pub meal_type: Option<String>,
    /// One of diet.rs's ALL_DIET_FLAGS, e.g. "vegan" - single-select, like
    /// cuisine/meal_type, not a set (mirrors the chip-row filter UI).
    pub diet: Option<String>,
    /// "top" (default) | "canmake" | "fastest" | "rising"
    pub sort: Option<String>,
    /// Upper bound on `time_minutes`, e.g. 30 for "30 minutes or less".
    pub max_time: Option<i32>,
    /// "easy" | "medium" | "hard" - see `meal_difficulty_sql!`.
    pub difficulty: Option<String>,
}

pub async fn browse(
    State(state): State<AppState>,
    user: Option<CurrentUser>,
    Query(p): Query<BrowseParams>,
) -> Result<Json<Vec<MealCard>>, StatusCode> {
    let viewer = user.map(|u| u.0.id);
    let sort = match p.sort.as_deref() {
        Some("fastest") => "fastest",
        Some("canmake") => "canmake",
        Some("rising") => "rising",
        _ => "top",
    };

    // Sort is a bound parameter rather than interpolated SQL: the CASE arms that
    // don't match the chosen mode evaluate to NULL, making those terms a no-op.
    let rows = sqlx::query_as::<_, MealCard>(
        concat!(
        "SELECT m.id, m.name, m.author_id, u.display_name AS author_name, m.cuisine, m.meal_type,
                m.time_minutes, m.rating::float8 AS rating, m.rating_count, m.photo_url,
                COALESCE(m.have_count, 0) AS have_count, COALESCE(m.total_count, 0) AS total_count,
                ", is_top_in_cuisine_sql!(), ", ", meal_diet_tags_sql!(), ", ", meal_difficulty_sql!(), "
         FROM (
           SELECT m.*,
             (SELECT count(*) FROM meal_ingredients mi
                WHERE mi.meal_id = m.id
                  AND EXISTS (SELECT 1 FROM fridge_items f
                              WHERE f.user_id = $1 AND f.ingredient_id = mi.ingredient_id)) AS have_count,
             (SELECT count(*) FROM meal_ingredients mi WHERE mi.meal_id = m.id) AS total_count
           FROM meals m
           WHERE m.visibility = 'public' AND m.status = 'live'
             AND ($2::text IS NULL OR m.name ILIKE '%' || $2 || '%')
             AND ($3::text IS NULL OR m.cuisine = $3)
             AND ($4::text IS NULL OR m.meal_type = $4)
             AND ($6::text IS NULL OR NOT EXISTS (
                   SELECT 1 FROM meal_ingredients mi2
                   JOIN ingredients i2 ON i2.id = mi2.ingredient_id
                   WHERE mi2.meal_id = m.id AND mi2.ingredient_id IS NOT NULL
                     AND NOT ($6 = ANY(i2.diet_flags))
                 ) AND EXISTS (SELECT 1 FROM meal_ingredients mi3
                                WHERE mi3.meal_id = m.id AND mi3.ingredient_id IS NOT NULL))
             AND ($7::int IS NULL OR m.time_minutes <= $7)
             AND ($8::text IS NULL OR (", meal_difficulty_case_sql!(), ") = $8)
         ) m
         JOIN users u ON u.id = m.author_id
         ORDER BY
           CASE WHEN $5 = 'fastest' THEN m.time_minutes END ASC NULLS LAST,
           CASE WHEN $5 = 'canmake'
                THEN (m.have_count::float8 / NULLIF(m.total_count, 0)) END DESC NULLS LAST,
           -- Rising sort: a fresh meal's Bayesian score alone doesn't have enough
           -- ratings yet to compete with an established favorite, so this adds
           -- a boost that's strongest the day it's posted and fades to nothing
           -- over two weeks - long enough to catch a reasonable first look,
           -- short enough that lasting placement still has to be earned on
           -- ranked_score like everything else.
           CASE WHEN $5 = 'rising'
                THEN m.ranked_score + GREATEST(0, 14 - EXTRACT(DAY FROM (now() - m.created_at))) * 0.15
                END DESC NULLS LAST,
           m.ranked_score DESC, m.rating_count DESC
         LIMIT 200"
        ),
    )
        .bind(viewer)
        .bind(p.search.as_deref().filter(|s| !s.is_empty()))
        .bind(p.cuisine.as_deref().filter(|s| !s.is_empty()))
        .bind(p.meal_type.as_deref().filter(|s| !s.is_empty()))
        .bind(sort)
        .bind(p.diet.as_deref().filter(|s| !s.is_empty()))
        .bind(p.max_time)
        .bind(p.difficulty.as_deref().filter(|s| !s.is_empty()))
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("browse meals failed: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(rows))
}

#[derive(Serialize)]
pub struct MealIngredientRow {
    /// Present only when the line was matched to a catalog page; imported
    /// recipes routinely contain ingredients the catalog has never heard of.
    pub ingredient_id: Option<i64>,
    /// What the recipe called it, which is what the cook should read.
    pub name: String,
    pub category: String,
    pub amount: Option<f64>,
    pub unit: Option<String>,
    pub note: Option<String>,
    /// Rendered quantity, e.g. "2 cups" - built server-side so every client
    /// formats amounts the same way.
    pub qty: Option<String>,
    pub in_fridge: bool,
}

fn render_qty(amount: Option<f64>, unit: Option<&str>) -> Option<String> {
    match (amount, unit) {
        (Some(a), Some(u)) => Some(format!("{} {}", crate::units::format_amount(a), u)),
        (Some(a), None) => Some(crate::units::format_amount(a)),
        _ => None,
    }
}

#[derive(Serialize)]
pub struct MealDetail {
    #[serde(flatten)]
    pub card: MealCard,
    pub description: String,
    pub steps: Vec<String>,
    pub serves: Option<String>,
    pub visibility: String,
    pub ingredients: Vec<MealIngredientRow>,
    pub is_cooked: bool,
    pub is_saved: bool,
    pub your_rating: Option<i16>,
    /// Attribution for imported recipes.
    pub source_url: Option<String>,
    pub source_name: Option<String>,
    pub nutrition: crate::nutrition::MealNutrition,
    pub rating_distribution: RatingDistribution,
    /// Present only when this recipe is itself a fork. `meal_id`/`author_id`
    /// go NULL if the source was since deleted or its author's account
    /// removed - the name/author_name stay put either way (denormalised at
    /// fork time), so attribution never just disappears.
    pub forked_from: Option<ForkSource>,
    /// Whether the viewer can fork this recipe - false when it's already
    /// theirs (forking your own recipe is a no-op the UI shouldn't offer).
    pub can_fork: bool,
}

#[derive(Serialize)]
pub struct ForkSource {
    pub meal_id: Option<i64>,
    pub name: String,
    pub author_id: Option<i64>,
    pub author_name: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct RatingDistribution {
    /// Count at each value 1..=10, index 0 unused so `counts[v]` reads directly.
    pub counts: Vec<i64>,
    /// The middle vote, not the mean - the mean already lives on `rating`.
    /// The two diverge exactly when a rating is worth a second look: a
    /// bimodal "everyone either loves or hates this" split can average out to
    /// a bland-looking 5.5 that the median won't paper over.
    pub median: Option<f64>,
}

async fn rating_distribution(db: &sqlx::PgPool, meal_id: i64) -> Result<RatingDistribution, sqlx::Error> {
    let rows: Vec<(i16, i64)> = sqlx::query_as(
        "SELECT value, count(*) FROM ratings WHERE subject_type='meal' AND subject_id=$1 GROUP BY value",
    )
    .bind(meal_id)
    .fetch_all(db)
    .await?;

    let mut counts = vec![0i64; 11];
    for (value, n) in rows {
        if (1..=10).contains(&value) {
            counts[value as usize] = n;
        }
    }

    let median: Option<f64> = sqlx::query_scalar(
        "SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY value)
         FROM ratings WHERE subject_type='meal' AND subject_id=$1",
    )
    .bind(meal_id)
    .fetch_one(db)
    .await?;

    Ok(RatingDistribution { counts, median })
}

pub async fn detail(
    State(state): State<AppState>,
    user: Option<CurrentUser>,
    Path(id): Path<i64>,
) -> Result<Json<MealDetail>, StatusCode> {
    let viewer = user.map(|u| u.0.id);

    let card = sqlx::query_as::<_, MealCard>(concat!(
        "SELECT m.id, m.name, m.author_id, u.display_name AS author_name, m.cuisine, m.meal_type,
                m.time_minutes, m.rating::float8 AS rating, m.rating_count, m.photo_url,
                (SELECT count(*) FROM meal_ingredients mi
                   WHERE mi.meal_id = m.id
                     AND EXISTS (SELECT 1 FROM fridge_items f
                                 WHERE f.user_id = $2 AND f.ingredient_id = mi.ingredient_id)) AS have_count,
                (SELECT count(*) FROM meal_ingredients mi WHERE mi.meal_id = m.id) AS total_count,
                ", is_top_in_cuisine_sql!(), ", ", meal_diet_tags_sql!(), ", ", meal_difficulty_sql!(), "
         FROM meals m JOIN users u ON u.id = m.author_id
         WHERE m.id = $1 AND m.status = 'live'"
    ))
    .bind(id)
    .bind(viewer)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    let extra = sqlx::query_as::<_, (String, Vec<String>, Option<String>, String, Option<String>, Option<String>, Option<i64>, Option<String>, Option<i64>, Option<String>)>(
        "SELECT description, steps, serves, visibility, source_url, source_name,
                forked_from_id, forked_from_name, forked_from_author_id, forked_from_author_name
         FROM meals WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // LEFT JOIN, not JOIN: an unmatched line still belongs on the page.
    let ingredients = sqlx::query_as::<_, (Option<i64>, String, Option<String>, Option<f64>, Option<String>, Option<String>, bool)>(
        "SELECT mi.ingredient_id, mi.raw_name, i.category,
                mi.amount::float8, mi.unit, mi.note,
                EXISTS (SELECT 1 FROM fridge_items f
                        WHERE f.user_id = $2 AND f.ingredient_id = mi.ingredient_id) AS in_fridge
         FROM meal_ingredients mi
         LEFT JOIN ingredients i ON i.id = mi.ingredient_id
         WHERE mi.meal_id = $1 ORDER BY mi.position",
    )
    .bind(id)
    .bind(viewer)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("meal ingredients failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .into_iter()
    .map(|r| MealIngredientRow {
        qty: render_qty(r.3, r.4.as_deref()),
        ingredient_id: r.0,
        name: r.1,
        category: r.2.unwrap_or_else(|| "Other".into()),
        amount: r.3,
        unit: r.4,
        note: r.5,
        in_fridge: r.6,
    })
    .collect();

    let (is_cooked, is_saved, your_rating) = match viewer {
        Some(uid) => {
            let c: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM cooked_meals WHERE user_id=$1 AND meal_id=$2)",
            )
            .bind(uid).bind(id).fetch_one(&state.db).await.unwrap_or(false);
            let s: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM saved_meals WHERE user_id=$1 AND meal_id=$2)",
            )
            .bind(uid).bind(id).fetch_one(&state.db).await.unwrap_or(false);
            let r: Option<i16> = sqlx::query_scalar(
                "SELECT value FROM ratings WHERE user_id=$1 AND subject_type='meal' AND subject_id=$2",
            )
            .bind(uid).bind(id).fetch_optional(&state.db).await.ok().flatten();
            (c, s, r)
        }
        None => (false, false, None),
    };

    let nutrition = crate::nutrition::compute(&state.db, id, extra.2.as_deref())
        .await
        .map_err(|e| {
            tracing::error!("nutrition compute failed: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    let rating_distribution = rating_distribution(&state.db, id).await.map_err(|e| {
        tracing::error!("rating distribution failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let author_id = card.author_id;
    let forked_from = extra.7.map(|name| ForkSource {
        meal_id: extra.6,
        name,
        author_id: extra.8,
        author_name: extra.9.unwrap_or_else(|| "a former user".into()),
    });

    Ok(Json(MealDetail {
        card,
        description: extra.0,
        steps: extra.1,
        serves: extra.2,
        visibility: extra.3,
        ingredients,
        is_cooked,
        is_saved,
        your_rating,
        source_url: extra.4,
        source_name: extra.5,
        nutrition,
        rating_distribution,
        forked_from,
        can_fork: viewer.is_some() && viewer != Some(author_id),
    }))
}

#[derive(Serialize)]
pub struct DiscoverSection {
    pub key: String,
    pub title: String,
    pub subtitle: String,
    pub meals: Vec<MealCard>,
}

/// The inspiration gallery: a few curated shelves rather than one flat list,
/// so an empty database degrades to fewer sections instead of a blank page.
pub async fn discover(
    State(state): State<AppState>,
    user: Option<CurrentUser>,
) -> Result<Json<Vec<DiscoverSection>>, StatusCode> {
    let viewer = user.map(|u| u.0.id);

    // Every shelf shares one projection and differs only in filter/order.
    // Built with `concat!` so each variant is still a compile-time literal -
    // sqlx rejects runtime-assembled SQL, and rightly so.
    macro_rules! shelf_sql {
        ($tail:expr) => {
            concat!(
                "SELECT m.id, m.name, m.author_id, u.display_name AS author_name, \
                        m.cuisine, m.meal_type, m.time_minutes, m.rating::float8 AS rating, \
                        m.rating_count, m.photo_url, \
                        COALESCE(m.have_count, 0) AS have_count, \
                        COALESCE(m.total_count, 0) AS total_count, \
                        ", is_top_in_cuisine_sql!(), ", ", meal_diet_tags_sql!(), ", ", meal_difficulty_sql!(), " \
                 FROM ( \
                   SELECT m.*, \
                     (SELECT count(*) FROM meal_ingredients mi \
                        WHERE mi.meal_id = m.id AND mi.ingredient_id IS NOT NULL \
                          AND EXISTS (SELECT 1 FROM fridge_items f \
                                      WHERE f.user_id = $1 AND f.ingredient_id = mi.ingredient_id)) AS have_count, \
                     (SELECT count(*) FROM meal_ingredients mi WHERE mi.meal_id = m.id) AS total_count \
                   FROM meals m WHERE m.visibility = 'public' AND m.status = 'live' \
                 ) m \
                 JOIN users u ON u.id = m.author_id ",
                $tail
            )
        };
    }

    async fn shelf(
        db: &sqlx::PgPool,
        sql: &'static str,
        viewer: Option<i64>,
    ) -> Vec<MealCard> {
        sqlx::query_as::<_, MealCard>(sql)
            .bind(viewer)
            .fetch_all(db)
            .await
            .unwrap_or_default()
    }

    let top = shelf(
        &state.db,
        shelf_sql!("ORDER BY m.ranked_score DESC, m.rating_count DESC LIMIT 12"),
        viewer,
    )
    .await;
    let quick = shelf(
        &state.db,
        shelf_sql!("WHERE m.time_minutes > 0 ORDER BY m.time_minutes ASC LIMIT 12"),
        viewer,
    )
    .await;
    let fresh = shelf(
        &state.db,
        shelf_sql!("ORDER BY m.created_at DESC LIMIT 12"),
        viewer,
    )
    .await;
    let ready = if viewer.is_some() {
        shelf(
            &state.db,
            shelf_sql!(
                "WHERE m.total_count > 0 AND m.have_count > 0 \
                 ORDER BY (m.have_count::float8 / NULLIF(m.total_count,0)) DESC NULLS LAST, \
                          m.ranked_score DESC LIMIT 12"
            ),
            viewer,
        )
        .await
    } else {
        Vec::new()
    };

    // Settings/onboarding have collected diet_prefs since the very first
    // migration; this is the first thing that actually reads it back. Empty
    // for a viewer with no diet_prefs set, or signed out - a shelf claiming
    // "for your diet" with no diet on file would be a lie, not a feature.
    let for_diet = if let Some(uid) = viewer {
        let prefs: Option<Vec<String>> =
            sqlx::query_scalar("SELECT diet_prefs FROM users WHERE id = $1")
                .bind(uid)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None);
        let prefs: Vec<String> = prefs.unwrap_or_default().iter().map(|p| p.to_lowercase()).collect();
        if prefs.is_empty() {
            Vec::new()
        } else {
            // `diet_tags` in the SELECT list is a computed expression, not a
            // real column, so it isn't visible to this same-level WHERE -
            // this re-derives the same "every ingredient supports every
            // requested diet" check directly against m.id instead.
            sqlx::query_as::<_, MealCard>(shelf_sql!(
                "WHERE NOT EXISTS (
                   SELECT 1 FROM unnest($2::text[]) d
                   WHERE NOT EXISTS (SELECT 1 FROM meal_ingredients mi3
                                      WHERE mi3.meal_id = m.id AND mi3.ingredient_id IS NOT NULL)
                      OR EXISTS (SELECT 1 FROM meal_ingredients mi2
                                 JOIN ingredients i2 ON i2.id = mi2.ingredient_id
                                 WHERE mi2.meal_id = m.id AND mi2.ingredient_id IS NOT NULL
                                   AND NOT (d = ANY(i2.diet_flags)))
                 )
                 ORDER BY m.ranked_score DESC LIMIT 12"
            ))
            .bind(viewer)
            .bind(&prefs)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default()
        }
    } else {
        Vec::new()
    };

    let mut sections = Vec::new();
    if !ready.is_empty() {
        sections.push(DiscoverSection {
            key: "ready".into(),
            title: "Nearly in reach".into(),
            subtitle: "You already have most of what these need.".into(),
            meals: ready,
        });
    }
    if !for_diet.is_empty() {
        sections.push(DiscoverSection {
            key: "for_diet".into(),
            title: "For your diet".into(),
            subtitle: "Matches every preference on your profile.".into(),
            meals: for_diet,
        });
    }
    if !top.is_empty() {
        sections.push(DiscoverSection {
            key: "top".into(),
            title: "Best rated".into(),
            subtitle: "What people came back to.".into(),
            meals: top,
        });
    }
    if !quick.is_empty() {
        sections.push(DiscoverSection {
            key: "quick".into(),
            title: "On the table fast".into(),
            subtitle: "Short cooks for a weeknight.".into(),
            meals: quick,
        });
    }
    if !fresh.is_empty() {
        sections.push(DiscoverSection {
            key: "fresh".into(),
            title: "Just added".into(),
            subtitle: "The newest things people have published.".into(),
            meals: fresh,
        });
    }

    Ok(Json(sections))
}

#[derive(Deserialize)]
pub struct NewMeal {
    pub name: String,
    pub cuisine: String,
    pub meal_type: String,
    pub time_minutes: i32,
    pub serves: Option<String>,
    pub description: Option<String>,
    pub steps: Vec<String>,
    pub ingredients: Vec<NewMealIngredient>,
    pub photo_url: Option<String>,
    pub visibility: Option<String>,
    pub rating: Option<i16>,
    /// Set when the meal came from an import, for attribution on the page.
    pub source_url: Option<String>,
    pub source_name: Option<String>,
    /// Marks the originating `recipe_imports` row as saved.
    pub import_id: Option<i64>,
}

/// Shared by create, update and revert so the three can't drift apart on how
/// a line is interpreted - the parsing rules are the same wherever a recipe
/// enters the system.
async fn insert_ingredients(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    meal_id: i64,
    ingredients: &[NewMealIngredient],
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    for (idx, ing) in ingredients.iter().enumerate() {
        // Accept either a pre-split line or raw text, so the import flow and
        // the hand-entry form can share one endpoint.
        let (amount, unit, raw_name, note) = match (&ing.name, &ing.qty) {
            (Some(n), _) if !n.trim().is_empty() => (
                ing.amount,
                ing.unit.clone(),
                n.trim().to_string(),
                ing.note.clone(),
            ),
            (_, Some(q)) => {
                let p = crate::units::parse_ingredient_line(q);
                (p.amount, p.unit, p.name, p.note)
            }
            _ => continue,
        };
        if raw_name.is_empty() {
            continue;
        }

        sqlx::query(
            "INSERT INTO meal_ingredients (meal_id, ingredient_id, raw_name, amount, unit, note, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(meal_id)
        .bind(ing.ingredient_id)
        .bind(&raw_name)
        .bind(amount)
        .bind(unit.as_deref())
        .bind(note.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .bind(idx as i32)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!("insert meal ingredient failed: {e}");
            oops()
        })?;
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct NewMealIngredient {
    /// Optional: unmatched lines are legitimate, especially from imports.
    pub ingredient_id: Option<i64>,
    /// The line as written. Falls back to a free-text `qty` parse when the
    /// client hasn't split it, so hand-written entry still works.
    pub name: Option<String>,
    pub amount: Option<f64>,
    pub unit: Option<String>,
    pub note: Option<String>,
    /// Legacy/simple path: "2 cups flour" parsed server-side.
    pub qty: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<NewMeal>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(bad("Give your meal a name."));
    }
    if body.time_minutes <= 0 {
        return Err(bad("How long does it take to cook?"));
    }

    let visibility = match body.visibility.as_deref() {
        Some("personal") => "personal",
        _ => "public",
    };
    let steps: Vec<String> = body.steps.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();

    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    let meal_id: i64 = sqlx::query_scalar(
        "INSERT INTO meals (name, author_id, cuisine, meal_type, time_minutes, serves,
                            description, steps, photo_url, visibility, rating, rating_count,
                            source_url, source_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id",
    )
    .bind(name)
    .bind(user.id)
    .bind(body.cuisine.trim())
    .bind(body.meal_type.trim())
    .bind(body.time_minutes)
    .bind(body.serves.as_deref())
    .bind(body.description.as_deref().unwrap_or("").trim())
    .bind(&steps)
    .bind(body.photo_url.as_deref())
    .bind(visibility)
    .bind(body.rating.map(f64::from).unwrap_or(0.0))
    .bind(i32::from(body.rating.is_some()))
    .bind(body.source_url.as_deref())
    .bind(body.source_name.as_deref())
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("create meal failed: {e}");
        oops()
    })?;

    insert_ingredients(&mut tx, meal_id, &body.ingredients).await?;

    if let Some(import_id) = body.import_id {
        sqlx::query(
            "UPDATE recipe_imports SET status='saved', meal_id=$1 WHERE id=$2 AND user_id=$3",
        )
        .bind(meal_id)
        .bind(import_id)
        .bind(user.id)
        .execute(&mut *tx)
        .await
        .ok();
    }

    if let Some(v) = body.rating {
        sqlx::query(
            "INSERT INTO ratings (user_id, subject_type, subject_id, value) VALUES ($1,'meal',$2,$3)",
        )
        .bind(user.id).bind(meal_id).bind(v)
        .execute(&mut *tx).await.ok();
    }

    tx.commit().await.map_err(|_| oops())?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({ "id": meal_id }))))
}

/// Copies a public recipe into the caller's own cookbook as a fully
/// independent, fully-owned meal - not a suggestion routed through the
/// propose-and-vote edit system, a real fork the way GitHub's is: the
/// forker can rename it, gut the ingredient list, take it wherever they
/// want, and the original is never touched. Attribution back to the source
/// is denormalised onto the new row at fork time (see migration 0014) so it
/// survives the original later being edited, deleted, or its author's
/// account removed.
pub async fn fork(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    let original = sqlx::query_as::<_, (String, String, String, i32, Option<String>, String, Vec<String>, Option<String>, i64, String)>(
        "SELECT m.name, m.cuisine, m.meal_type, m.time_minutes, m.serves, m.description, m.steps, m.photo_url,
                m.author_id, u.display_name
         FROM meals m JOIN users u ON u.id = m.author_id
         WHERE m.id = $1 AND m.status = 'live' AND m.visibility = 'public'",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| oops())?;

    let Some((name, cuisine, meal_type, time_minutes, serves, description, steps, photo_url, author_id, author_name)) = original
    else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Recipe not found." }))));
    };
    if author_id == user.id {
        return Err(bad("This is already your recipe."));
    }

    let new_id: i64 = sqlx::query_scalar(
        "INSERT INTO meals (name, author_id, cuisine, meal_type, time_minutes, serves,
                            description, steps, photo_url, visibility,
                            forked_from_id, forked_from_name, forked_from_author_id, forked_from_author_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'public',$10,$11,$12,$13) RETURNING id",
    )
    .bind(&name)
    .bind(user.id)
    .bind(&cuisine)
    .bind(&meal_type)
    .bind(time_minutes)
    .bind(&serves)
    .bind(&description)
    .bind(&steps)
    .bind(&photo_url)
    .bind(id)
    .bind(&name)
    .bind(author_id)
    .bind(&author_name)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("fork meal failed: {e}");
        oops()
    })?;

    sqlx::query(
        "INSERT INTO meal_ingredients (meal_id, ingredient_id, raw_name, amount, unit, note, position)
         SELECT $1, ingredient_id, raw_name, amount, unit, note, position
         FROM meal_ingredients WHERE meal_id = $2",
    )
    .bind(new_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|_| oops())?;

    tx.commit().await.map_err(|_| oops())?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({ "id": new_id }))))
}

// ------------------------------------------------------ editing & history
//
// Two rules here are non-negotiable, borrowed from wiki practice: nothing is
// hard-deleted, and no body is overwritten without a revision row recording
// what it replaced. Everything else in the editing system builds on those.

/// Serialises the meal and its ingredient rows exactly as stored, so a
/// revision can be restored wholesale without consulting the current schema.
async fn snapshot_meal(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    meal_id: i64,
) -> Result<serde_json::Value, sqlx::Error> {
    let m = sqlx::query_as::<_, (String, String, String, i32, Option<String>, String, Vec<String>, Option<String>, String, Option<String>, Option<String>)>(
        "SELECT name, cuisine, meal_type, time_minutes, serves, description, steps,
                photo_url, visibility, source_url, source_name
         FROM meals WHERE id = $1",
    )
    .bind(meal_id)
    .fetch_one(&mut **tx)
    .await?;

    let ings = sqlx::query_as::<_, (Option<i64>, String, Option<f64>, Option<String>, Option<String>, i32)>(
        "SELECT ingredient_id, raw_name, amount::float8, unit, note, position
         FROM meal_ingredients WHERE meal_id = $1 ORDER BY position",
    )
    .bind(meal_id)
    .fetch_all(&mut **tx)
    .await?;

    Ok(serde_json::json!({
        "name": m.0, "cuisine": m.1, "meal_type": m.2, "time_minutes": m.3,
        "serves": m.4, "description": m.5, "steps": m.6, "photo_url": m.7,
        "visibility": m.8, "source_url": m.9, "source_name": m.10,
        "ingredients": ings.iter().map(|i| serde_json::json!({
            "ingredient_id": i.0, "raw_name": i.1, "amount": i.2,
            "unit": i.3, "note": i.4, "position": i.5,
        })).collect::<Vec<_>>(),
    }))
}

async fn write_revision(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    meal_id: i64,
    editor_id: i64,
    editor_name: &str,
    snapshot: serde_json::Value,
    summary: &str,
    kind: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO meal_revisions (meal_id, editor_id, editor_name, snapshot, summary, kind)
         VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(meal_id)
    .bind(editor_id)
    .bind(editor_name)
    .bind(snapshot)
    .bind(summary)
    .bind(kind)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Compares the stored snapshot with the incoming body and names what changed,
/// so history reads "renamed, steps 4→6" rather than a bare "edited".
fn describe_change(before: &serde_json::Value, body: &UpdateMeal) -> String {
    let mut parts: Vec<String> = Vec::new();
    let get = |k: &str| before.get(k).and_then(|v| v.as_str()).unwrap_or_default().to_string();

    if get("name") != body.name.trim() {
        parts.push("renamed".into());
    }
    if get("description") != body.description.as_deref().unwrap_or("").trim() {
        parts.push("description".into());
    }

    let before_steps: Vec<&str> = before
        .get("steps")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str()).collect())
        .unwrap_or_default();
    let after_steps: Vec<String> = body
        .steps
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if before_steps.len() != after_steps.len() {
        parts.push(format!("steps {}→{}", before_steps.len(), after_steps.len()));
    } else if before_steps.iter().zip(after_steps.iter()).any(|(o, n)| *o != n) {
        parts.push("steps reworded".into());
    }

    let before_ings = before.get("ingredients").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
    if before_ings != body.ingredients.len() {
        parts.push(format!("ingredients {}→{}", before_ings, body.ingredients.len()));
    }

    if get("visibility") != body.visibility.as_deref().unwrap_or("public") {
        parts.push("visibility".into());
    }
    if parts.is_empty() { "minor details".into() } else { parts.join(", ") }
}

#[derive(Deserialize)]
pub struct UpdateMeal {
    pub name: String,
    pub cuisine: String,
    pub meal_type: String,
    pub time_minutes: i32,
    pub serves: Option<String>,
    pub description: Option<String>,
    pub steps: Vec<String>,
    pub ingredients: Vec<NewMealIngredient>,
    pub photo_url: Option<String>,
    pub visibility: Option<String>,
}

/// Author-only full update. The pre-edit state is snapshotted into
/// meal_revisions in the same transaction, so there is no window where the
/// old version is gone and its history row isn't written yet.
pub async fn update(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<UpdateMeal>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(bad("Give your meal a name."));
    }
    if body.time_minutes <= 0 {
        return Err(bad("How long does it take to cook?"));
    }

    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    let author: Option<i64> = sqlx::query_scalar(
        "SELECT author_id FROM meals WHERE id = $1 AND status = 'live' FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| oops())?;
    match author {
        None => {
            return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Not found." }))))
        }
        Some(a) if a != user.id => {
            return Err((
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({ "error": "Only the author can edit this meal." })),
            ))
        }
        _ => {}
    }

    let before = snapshot_meal(&mut tx, id).await.map_err(|_| oops())?;
    let summary = describe_change(&before, &body);
    write_revision(&mut tx, id, user.id, &user.display_name, before, &summary, "edit")
        .await
        .map_err(|_| oops())?;

    let visibility = match body.visibility.as_deref() {
        Some("personal") => "personal",
        _ => "public",
    };
    let steps: Vec<String> = body
        .steps
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    sqlx::query(
        "UPDATE meals SET name=$1, cuisine=$2, meal_type=$3, time_minutes=$4, serves=$5,
                          description=$6, steps=$7, photo_url=$8, visibility=$9, updated_at=now()
         WHERE id=$10",
    )
    .bind(&name)
    .bind(body.cuisine.trim())
    .bind(body.meal_type.trim())
    .bind(body.time_minutes)
    .bind(body.serves.as_deref())
    .bind(body.description.as_deref().unwrap_or("").trim())
    .bind(&steps)
    .bind(body.photo_url.as_deref())
    .bind(visibility)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|_| oops())?;

    // Ingredients are replaced wholesale; the old set lives on in the snapshot.
    sqlx::query("DELETE FROM meal_ingredients WHERE meal_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|_| oops())?;
    insert_ingredients(&mut tx, id, &body.ingredients).await?;

    tx.commit().await.map_err(|_| oops())?;
    Ok(StatusCode::NO_CONTENT)
}

/// Soft delete: the meal leaves every surface, but its row, its revisions and
/// everyone's cook history survive, and restore is one revert away.
pub async fn delete(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    // Snapshot before flipping status, while the meal still reads as live.
    let author: Option<i64> = sqlx::query_scalar(
        "SELECT author_id FROM meals WHERE id=$1 AND status='live' FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| oops())?;
    if author != Some(user.id) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Only the author can delete this meal." })),
        ));
    }

    let snap = snapshot_meal(&mut tx, id).await.map_err(|_| oops())?;
    write_revision(&mut tx, id, user.id, &user.display_name, snap, "deleted", "deleted")
        .await
        .map_err(|_| oops())?;

    sqlx::query("UPDATE meals SET status='deleted', updated_at=now() WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|_| oops())?;

    tx.commit().await.map_err(|_| oops())?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, sqlx::FromRow)]
pub struct RevisionRow {
    pub id: i64,
    pub editor_name: Option<String>,
    /// NULL for a former user (account deleted, FK `SET NULL`) - the UI links
    /// to a profile when present and falls back to plain text otherwise.
    pub editor_id: Option<i64>,
    pub summary: String,
    pub kind: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Net score: improvements minus regressions, weighted by each voter's
    /// `reputation_weight` and rounded to a whole number for display. The
    /// per-voter weights that produced it are deliberately not exposed - see
    /// `vote_revision`.
    pub score: i64,
    pub vote_count: i64,
    /// How the viewer voted, so the UI can show their own choice back to them.
    pub your_vote: Option<i16>,
    /// NULL alongside a NULL editor_id (former user) - nothing to badge.
    pub editor_tier: Option<String>,
}

#[derive(Serialize)]
pub struct RevisionHistory {
    pub meal_name: String,
    pub author_id: i64,
    /// False once the meal has been soft-deleted - the history stays visible
    /// either way, since it's also how a deletion gets undone.
    pub is_live: bool,
    pub revisions: Vec<RevisionRow>,
}

/// Visible to anyone who can see the meal - a history only its author can see
/// is halfway to no history at all. Deliberately not gated on the meal being
/// live: a deleted meal's history is exactly where "restore" lives, so hiding
/// it the moment status flips would make the delete confirmation's promise
/// that nothing is erased outright false in practice.
pub async fn revisions(
    State(state): State<AppState>,
    viewer: Option<CurrentUser>,
    Path(id): Path<i64>,
) -> Result<Json<RevisionHistory>, StatusCode> {
    let viewer_id = viewer.map(|u| u.0.id);

    let head = sqlx::query_as::<_, (String, i64, String)>(
        "SELECT name, author_id, status FROM meals WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    let rows = sqlx::query_as::<_, RevisionRow>(
        "SELECT r.id, r.editor_name, r.editor_id, r.summary, r.kind, r.created_at,
                COALESCE((SELECT round(sum(v.value * reputation_weight(v.user_id)))
                          FROM revision_votes v WHERE v.revision_id = r.id), 0)::bigint AS score,
                (SELECT count(*) FROM revision_votes v WHERE v.revision_id = r.id) AS vote_count,
                (SELECT v.value FROM revision_votes v
                  WHERE v.revision_id = r.id AND v.user_id = $2) AS your_vote,
                CASE WHEN r.editor_id IS NULL THEN NULL ELSE contributor_tier(r.editor_id) END AS editor_tier
         FROM meal_revisions r
         WHERE r.meal_id = $1
         ORDER BY r.created_at DESC LIMIT 50",
    )
    .bind(id)
    .bind(viewer_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("revisions failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(RevisionHistory {
        meal_name: head.0,
        author_id: head.1,
        is_live: head.2 == "live",
        revisions: rows,
    }))
}

/// Author-only: undo a soft delete. Writes its own "restored" revision rather
/// than pretending the deletion never happened - the gap stays in the record.
pub async fn restore(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    let author: Option<i64> = sqlx::query_scalar(
        "SELECT author_id FROM meals WHERE id=$1 AND status='deleted' FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| oops())?;
    match author {
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Nothing to restore." })),
            ))
        }
        Some(a) if a != user.id => {
            return Err((
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({ "error": "Only the author can restore this meal." })),
            ))
        }
        _ => {}
    }

    sqlx::query("UPDATE meals SET status='live', updated_at=now() WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|_| oops())?;

    let snap = snapshot_meal(&mut tx, id).await.map_err(|_| oops())?;
    write_revision(&mut tx, id, user.id, &user.display_name, snap, "restored", "restored")
        .await
        .map_err(|_| oops())?;

    tx.commit().await.map_err(|_| oops())?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct RevisionVote {
    /// 1 = this change improved the recipe, -1 = it made it worse.
    pub value: i16,
}

/// Vote on whether an edit improved the recipe.
///
/// Casting the same value twice clears the vote, so the control is a toggle.
/// The response reports the vote as recorded and never reveals how heavily it
/// counted: telling someone their vote was discounted only teaches them to
/// make another account.
pub async fn vote_revision(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((id, rev_id)): Path<(i64, i64)>,
    Json(body): Json<RevisionVote>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !matches!(body.value, -1 | 1) {
        return Err(StatusCode::BAD_REQUEST);
    }

    // The revision must belong to the meal in the path; otherwise a caller
    // could vote on any revision by guessing ids.
    let belongs: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM meal_revisions WHERE id=$1 AND meal_id=$2)",
    )
    .bind(rev_id)
    .bind(id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !belongs {
        return Err(StatusCode::NOT_FOUND);
    }

    let cooked: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM cooked_meals WHERE user_id=$1 AND meal_id=$2)",
    )
    .bind(user.id)
    .bind(id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);

    let existing: Option<i16> = sqlx::query_scalar(
        "SELECT value FROM revision_votes WHERE revision_id=$1 AND user_id=$2",
    )
    .bind(rev_id)
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let cleared = existing == Some(body.value);
    if cleared {
        sqlx::query("DELETE FROM revision_votes WHERE revision_id=$1 AND user_id=$2")
            .bind(rev_id)
            .bind(user.id)
            .execute(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        sqlx::query(
            "INSERT INTO revision_votes (revision_id, user_id, value, cooked)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (revision_id, user_id) DO UPDATE SET value = EXCLUDED.value",
        )
        .bind(rev_id)
        .bind(user.id)
        .bind(body.value)
        .bind(cooked)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    let score: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(value), 0) FROM revision_votes WHERE revision_id=$1",
    )
    .bind(rev_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    Ok(Json(serde_json::json!({
        "your_vote": if cleared { None } else { Some(body.value) },
        "score": score,
    })))
}

/// Core of a revert, shared by the author-facing handler below and
/// moderation's "remove this revision" action (`moderation.rs`): restores
/// `id`'s live row (and its ingredient lines) to how `meal_revisions` row
/// `rev_id` snapshotted it, first snapshotting the pre-revert state as a new
/// revision of its own so a revert is itself revertible. Authorization is
/// the caller's job - this only cares whether the revision exists.
///
/// Returns `Ok(false)` if `rev_id` doesn't belong to `id`, so the caller can
/// turn that into a 404 (or, for moderation, just log and move on).
pub(crate) async fn revert_to_revision(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: i64,
    rev_id: i64,
    actor_id: i64,
    actor_name: &str,
    note: &str,
) -> Result<bool, sqlx::Error> {
    let snap: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT snapshot FROM meal_revisions WHERE id=$1 AND meal_id=$2")
            .bind(rev_id)
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?;
    let Some(snap) = snap else {
        return Ok(false);
    };

    let current = snapshot_meal(tx, id).await?;
    write_revision(tx, id, actor_id, actor_name, current, note, "revert").await?;

    // A page that keeps getting reverted is unstable - that's a ranking
    // signal (iteration 3), not just history trivia, so it's tracked on the
    // meal row where ranking queries can read it cheaply.
    sqlx::query("UPDATE meals SET revert_count = revert_count + 1, last_reverted_at = now() WHERE id = $1")
        .bind(id)
        .execute(&mut **tx)
        .await?;

    let s = |k: &str| snap.get(k).and_then(|v| v.as_str()).map(str::to_string);
    let steps: Vec<String> = snap
        .get("steps")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    sqlx::query(
        "UPDATE meals SET name=$1, cuisine=$2, meal_type=$3, time_minutes=$4, serves=$5,
                          description=$6, steps=$7, photo_url=$8, visibility=$9, updated_at=now()
         WHERE id=$10",
    )
    .bind(s("name").unwrap_or_default())
    .bind(s("cuisine").unwrap_or_default())
    .bind(s("meal_type").unwrap_or_default())
    .bind(snap.get("time_minutes").and_then(|v| v.as_i64()).unwrap_or(30) as i32)
    .bind(s("serves"))
    .bind(s("description").unwrap_or_default())
    .bind(&steps)
    .bind(s("photo_url"))
    .bind(s("visibility").unwrap_or_else(|| "public".into()))
    .bind(id)
    .execute(&mut **tx)
    .await?;

    sqlx::query("DELETE FROM meal_ingredients WHERE meal_id=$1")
        .bind(id)
        .execute(&mut **tx)
        .await?;

    if let Some(ings) = snap.get("ingredients").and_then(|v| v.as_array()) {
        for (idx, ing) in ings.iter().enumerate() {
            sqlx::query(
                "INSERT INTO meal_ingredients (meal_id, ingredient_id, raw_name, amount, unit, note, position)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)",
            )
            .bind(id)
            .bind(ing.get("ingredient_id").and_then(|v| v.as_i64()))
            .bind(ing.get("raw_name").and_then(|v| v.as_str()).unwrap_or(""))
            .bind(ing.get("amount").and_then(|v| v.as_f64()))
            .bind(ing.get("unit").and_then(|v| v.as_str()))
            .bind(ing.get("note").and_then(|v| v.as_str()))
            .bind(idx as i32)
            .execute(&mut **tx)
            .await?;
        }
    }

    Ok(true)
}

/// Author-only: restore the meal to how it looked in a given revision. The
/// current state is snapshotted first, so a revert is itself revertible.
pub async fn revert(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((id, rev_id)): Path<(i64, i64)>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    let author: Option<i64> =
        sqlx::query_scalar("SELECT author_id FROM meals WHERE id=$1 AND status='live' FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| oops())?;
    if author != Some(user.id) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Only the author can revert this meal." })),
        ));
    }

    let found = revert_to_revision(&mut tx, id, rev_id, user.id, &user.display_name, "reverted to earlier version")
        .await
        .map_err(|_| oops())?;
    if !found {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Revision not found." }))));
    }

    tx.commit().await.map_err(|_| oops())?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct UpdatePhoto {
    pub photo_url: String,
}

/// Only the meal's author can replace its cover photo.
pub async fn update_photo(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<UpdatePhoto>,
) -> Result<StatusCode, StatusCode> {
    let updated = sqlx::query("UPDATE meals SET photo_url = $1 WHERE id = $2 AND author_id = $3")
        .bind(body.photo_url)
        .bind(id)
        .bind(user.id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected();

    if updated == 0 {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Saving is a plain toggle; cooking is one-way (and moves the meal out of Saved).
pub async fn toggle_save(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let deleted = sqlx::query("DELETE FROM saved_meals WHERE user_id=$1 AND meal_id=$2")
        .bind(user.id).bind(id)
        .execute(&state.db).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected();

    if deleted == 0 {
        sqlx::query("INSERT INTO saved_meals (user_id, meal_id) VALUES ($1,$2) ON CONFLICT DO NOTHING")
            .bind(user.id).bind(id)
            .execute(&state.db).await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // WHERE author_id <> $1 both skips notifying yourself for saving your
        // own recipe and no-ops harmlessly if the meal doesn't exist.
        sqlx::query(
            "INSERT INTO notifications (recipient_id, actor_id, type, subject_type, subject_id)
             SELECT author_id, $1, 'meal_saved', 'meal', $2 FROM meals WHERE id = $2 AND author_id <> $1",
        )
        .bind(user.id).bind(id)
        .execute(&state.db).await.ok();
    }

    Ok(Json(serde_json::json!({ "saved": deleted == 0 })))
}

#[derive(Deserialize)]
pub struct CookBody {
    pub note: Option<String>,
    pub score: Option<i16>,
    pub is_public: Option<bool>,
}

pub async fn cook(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<CookBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut tx = state.db.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let first_cook = sqlx::query("INSERT INTO cooked_meals (user_id, meal_id) VALUES ($1,$2) ON CONFLICT DO NOTHING")
        .bind(user.id).bind(id).execute(&mut *tx).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected() > 0;

    // Only the first time - re-marking an already-cooked meal (e.g. after
    // editing the note) shouldn't re-notify the author every time.
    if first_cook {
        sqlx::query(
            "INSERT INTO notifications (recipient_id, actor_id, type, subject_type, subject_id)
             SELECT author_id, $1, 'meal_cooked', 'meal', $2 FROM meals WHERE id = $2 AND author_id <> $1",
        )
        .bind(user.id).bind(id)
        .execute(&mut *tx).await.ok();
    }

    // Cooking it fulfils the intent to save it, so drop it from the saved list.
    sqlx::query("DELETE FROM saved_meals WHERE user_id=$1 AND meal_id=$2")
        .bind(user.id).bind(id).execute(&mut *tx).await.ok();

    if body.note.is_some() || body.score.is_some() {
        // Stamped with how many edits the recipe has had so far: a review
        // written against revision 0 of a dish that's since been rewritten
        // eight times isn't a review of what's on the page today, and the
        // meal page can say so instead of presenting it as current.
        let revision_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM meal_revisions WHERE meal_id = $1")
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .unwrap_or(0);

        sqlx::query(
            "INSERT INTO reviews (user_id, meal_id, score, note, is_public, meal_revision_count)
             VALUES ($1,$2,$3,$4,$5,$6)",
        )
        .bind(user.id).bind(id)
        .bind(body.score)
        .bind(body.note.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .bind(body.is_public.unwrap_or(true))
        .bind(revision_count)
        .execute(&mut *tx).await.ok();
    }

    if let Some(score) = body.score {
        upsert_rating(&mut tx, user.id, "meal", id, score).await;
    }

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "cooked": true })))
}

#[derive(Deserialize)]
pub struct RateBody {
    pub value: i16,
}

pub async fn rate(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<RateBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !(1..=10).contains(&body.value) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut tx = state.db.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    upsert_rating(&mut tx, user.id, "meal", id, body.value).await;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "rated": body.value })))
}

/// Writes the user's rating then recomputes the subject's cached average.
async fn upsert_rating(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: i64,
    subject_type: &str,
    subject_id: i64,
    value: i16,
) {
    sqlx::query(
        "INSERT INTO ratings (user_id, subject_type, subject_id, value) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, subject_type, subject_id)
         DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(user_id).bind(subject_type).bind(subject_id).bind(value)
    .execute(&mut **tx).await.ok();

    if subject_type == "meal" {
        sqlx::query(
            "UPDATE meals SET
               rating = COALESCE((SELECT round(avg(value)::numeric,1) FROM ratings
                                  WHERE subject_type='meal' AND subject_id=$1), 0),
               rating_count = (SELECT count(*) FROM ratings WHERE subject_type='meal' AND subject_id=$1)
             WHERE id = $1",
        )
        .bind(subject_id).execute(&mut **tx).await.ok();
        // Every meal, not just this one: a new rating moves the site-wide
        // prior, and a prior that has moved leaves every other ranked_score
        // describing a world that no longer exists.
        sqlx::query("SELECT recompute_meal_rankings()").execute(&mut **tx).await.ok();
    } else {
        sqlx::query(
            "UPDATE ingredients SET
               rating = COALESCE((SELECT round(avg(value)::numeric,1) FROM ratings
                                  WHERE subject_type='ingredient' AND subject_id=$1), 0),
               rating_count = (SELECT count(*) FROM ratings WHERE subject_type='ingredient' AND subject_id=$1)
             WHERE id = $1",
        )
        .bind(subject_id).execute(&mut **tx).await.ok();
        sqlx::query("SELECT recompute_ingredient_rankings()").execute(&mut **tx).await.ok();
    }
}

#[derive(Serialize, sqlx::FromRow)]
pub struct JournalEntry {
    pub id: i64,
    pub note: Option<String>,
    pub score: Option<i16>,
    pub cooked_at: chrono::DateTime<chrono::Utc>,
}

/// The viewer's own cooking notes for this meal - private, newest first.
pub async fn my_journal(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<Vec<JournalEntry>>, StatusCode> {
    let rows = sqlx::query_as::<_, JournalEntry>(
        "SELECT id, note, score, cooked_at FROM reviews
         WHERE user_id = $1 AND meal_id = $2 AND note IS NOT NULL
         ORDER BY cooked_at DESC",
    )
    .bind(user.id)
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct MealReview {
    pub id: i64,
    pub user_id: i64,
    pub author_name: String,
    pub avatar_theme: String,
    pub avatar_photo_url: Option<String>,
    pub score: Option<i16>,
    pub note: Option<String>,
    pub cooked_at: chrono::DateTime<chrono::Utc>,
    /// How many edits this recipe had gone through when the review was
    /// written - lets the page flag "written about an earlier version" when
    /// it's since moved on, instead of implying every review still applies.
    pub meal_revision_count: i32,
    pub is_current_version: bool,
    pub helpful_count: i32,
    pub your_helpful_vote: bool,
    pub author_tier: String,
}

/// Public, multi-author reviews for a recipe - the actual "Reviews" section a
/// recipe page needs. `my_reviews`/`chef_reviews` are both single-author
/// (this viewer's, or one chef's); neither can answer "what has everyone who
/// cooked this said," which is the question this endpoint exists for.
///
/// Ranked by helpfulness first: on a recipe with a lot of reviews, the ones
/// other cooks have actually found useful belong above yesterday's review
/// that nobody's seen yet.
pub async fn meal_reviews(
    State(state): State<AppState>,
    viewer: Option<CurrentUser>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<MealReview>>, StatusCode> {
    let viewer_id = viewer.map(|u| u.0.id);
    let current_revision_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM meal_revisions WHERE meal_id = $1")
            .bind(id)
            .fetch_one(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let rows = sqlx::query_as::<_, MealReview>(
        "SELECT r.id, r.user_id, u.display_name AS author_name,
                u.cb_avatar_theme AS avatar_theme, u.cb_avatar_photo_url AS avatar_photo_url,
                r.score, r.note, r.cooked_at, r.meal_revision_count,
                r.meal_revision_count = $2 AS is_current_version,
                r.helpful_count,
                EXISTS (SELECT 1 FROM review_votes v
                        WHERE v.review_id = r.id AND v.user_id = $3) AS your_helpful_vote,
                contributor_tier(u.id) AS author_tier
         FROM reviews r JOIN users u ON u.id = r.user_id
         WHERE r.meal_id = $1 AND r.is_public = true AND r.note IS NOT NULL
         ORDER BY r.helpful_count DESC, r.cooked_at DESC LIMIT 100",
    )
    .bind(id)
    .bind(current_revision_count)
    .bind(viewer_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("meal_reviews failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(rows))
}

/// Toggle-only, like `edit_votes`: tapping again withdraws it. There's no
/// "unhelpful" - see the migration comment for why that's deliberate.
pub async fn vote_review_helpful(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((meal_id, review_id)): Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let belongs: Option<i64> =
        sqlx::query_scalar("SELECT id FROM reviews WHERE id = $1 AND meal_id = $2")
            .bind(review_id)
            .bind(meal_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if belongs.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut tx = state.db.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let removed = sqlx::query("DELETE FROM review_votes WHERE review_id = $1 AND user_id = $2")
        .bind(review_id)
        .bind(user.id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected();

    if removed == 0 {
        sqlx::query("INSERT INTO review_votes (review_id, user_id) VALUES ($1,$2)")
            .bind(review_id)
            .bind(user.id)
            .execute(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    let count: i32 = sqlx::query_scalar(
        "UPDATE reviews SET helpful_count = (SELECT count(*) FROM review_votes WHERE review_id = $1)
         WHERE id = $1 RETURNING helpful_count",
    )
    .bind(review_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "helpful_count": count, "your_helpful_vote": removed == 0 })))
}

pub async fn filters(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cuisines: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT cuisine FROM meals WHERE visibility='public' AND status='live' ORDER BY cuisine",
    )
    .fetch_all(&state.db).await.unwrap_or_default();
    let types: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT meal_type FROM meals WHERE visibility='public' AND status='live' ORDER BY meal_type",
    )
    .fetch_all(&state.db).await.unwrap_or_default();
    Json(serde_json::json!({ "cuisines": cuisines, "meal_types": types }))
}

fn bad(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg })))
}
fn oops() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Could not save that meal." })))
}
