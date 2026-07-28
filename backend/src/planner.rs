//! Meal planning, the grocery list it produces, and reuse-aware suggestions.
//!
//! The grocery list is the reason the ingredient schema was restructured:
//! summing a week of recipes needs `amount + unit`, not the free text the old
//! `qty` column held.

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::auth::CurrentUser;
use crate::state::AppState;
use crate::units::{format_amount, from_base, tidy_amount, to_base, unit_dimension, Dimension};

const SLOTS: [&str; 4] = ["breakfast", "lunch", "dinner", "snack"];

fn db_err(e: sqlx::Error) -> StatusCode {
    tracing::error!("planner query failed: {e}");
    StatusCode::INTERNAL_SERVER_ERROR
}

// ------------------------------------------------------------ plan entries

#[derive(Serialize, sqlx::FromRow)]
pub struct PlanEntry {
    pub id: i64,
    pub plan_date: NaiveDate,
    pub slot: String,
    pub meal_id: i64,
    pub meal_name: String,
    pub cuisine: String,
    pub time_minutes: i32,
    pub photo_url: Option<String>,
    pub servings: i32,
}

#[derive(Deserialize)]
pub struct RangeParams {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

/// Guards against a client asking for an unbounded span of history.
fn checked_range(p: &RangeParams) -> Result<(), StatusCode> {
    if p.to < p.from {
        return Err(StatusCode::BAD_REQUEST);
    }
    if (p.to - p.from).num_days() > 60 {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(())
}

pub async fn list_plan(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(p): Query<RangeParams>,
) -> Result<Json<Vec<PlanEntry>>, StatusCode> {
    checked_range(&p)?;
    let rows = sqlx::query_as::<_, PlanEntry>(
        "SELECT e.id, e.plan_date, e.slot, e.meal_id, m.name AS meal_name, m.cuisine,
                m.time_minutes, m.photo_url, e.servings
         FROM meal_plan_entries e JOIN meals m ON m.id = e.meal_id AND m.status = 'live'
         WHERE e.user_id = $1 AND e.plan_date BETWEEN $2 AND $3
         ORDER BY e.plan_date, e.id",
    )
    .bind(user.id)
    .bind(p.from)
    .bind(p.to)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct AddPlanEntry {
    pub plan_date: NaiveDate,
    pub slot: String,
    pub meal_id: i64,
    pub servings: Option<i32>,
}

pub async fn add_plan_entry(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(b): Json<AddPlanEntry>,
) -> Result<(StatusCode, Json<serde_json::Value>), StatusCode> {
    if !SLOTS.contains(&b.slot.as_str()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let servings = b.servings.unwrap_or(1).clamp(1, 50);
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO meal_plan_entries (user_id, plan_date, slot, meal_id, servings)
         VALUES ($1,$2,$3,$4,$5) RETURNING id",
    )
    .bind(user.id)
    .bind(b.plan_date)
    .bind(&b.slot)
    .bind(b.meal_id)
    .bind(servings)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(serde_json::json!({ "id": id }))))
}

pub async fn remove_plan_entry(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    sqlx::query("DELETE FROM meal_plan_entries WHERE id=$1 AND user_id=$2")
        .bind(id)
        .bind(user.id)
        .execute(&state.db)
        .await
        .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

// --------------------------------------------------------- grocery list

#[derive(sqlx::FromRow)]
struct PlannedIngredient {
    ingredient_id: Option<i64>,
    raw_name: String,
    amount: Option<f64>,
    unit: Option<String>,
    note: Option<String>,
    servings: i32,
    meal_name: String,
    category: Option<String>,
    in_fridge: bool,
}

#[derive(Serialize)]
pub struct GroceryItem {
    /// Stable grouping key, used by the client when pushing to the shopping list.
    pub key: String,
    pub name: String,
    pub ingredient_id: Option<i64>,
    pub category: String,
    /// "3 cups", or "3 cups + 100 g" when a name arrives in two dimensions.
    pub total_label: Option<String>,
    pub in_fridge: bool,
    /// Which planned meals wanted it, so a surprising total can be traced.
    pub from_meals: Vec<String>,
    /// Lines that carried no parseable quantity ("Salt to taste").
    pub unquantified: Vec<String>,
    /// How many planned meals use this - the reuse signal, surfaced in the UI.
    pub meal_count: usize,
}

#[derive(Serialize)]
pub struct GroceryList {
    pub items: Vec<GroceryItem>,
    pub meals_planned: usize,
    /// Ingredients needed by more than one planned meal.
    pub shared_count: usize,
}

async fn planned_ingredients(
    state: &AppState,
    user_id: i64,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<PlannedIngredient>, StatusCode> {
    sqlx::query_as::<_, PlannedIngredient>(
        "SELECT mi.ingredient_id, mi.raw_name, mi.amount::float8 AS amount, mi.unit, mi.note,
                e.servings, m.name AS meal_name, i.category,
                EXISTS (SELECT 1 FROM fridge_items f
                        WHERE f.user_id = $1 AND f.ingredient_id = mi.ingredient_id) AS in_fridge
         FROM meal_plan_entries e
         JOIN meals m ON m.id = e.meal_id AND m.status = 'live'
         JOIN meal_ingredients mi ON mi.meal_id = m.id
         LEFT JOIN ingredients i ON i.id = mi.ingredient_id
         WHERE e.user_id = $1 AND e.plan_date BETWEEN $2 AND $3
         ORDER BY mi.position",
    )
    .bind(user_id)
    .bind(from)
    .bind(to)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)
}

/// Accumulator for one shopping-list line.
#[derive(Default)]
struct Bucket {
    name: String,
    ingredient_id: Option<i64>,
    category: String,
    in_fridge: bool,
    from_meals: Vec<String>,
    unquantified: Vec<String>,
    /// Base-unit totals per dimension, with the unit each was written in so the
    /// total can be rendered back in familiar terms rather than raw grams.
    totals: Vec<(Dimension, f64, HashMap<String, usize>)>,
}

impl Bucket {
    /// An empty `unit` means a bare count ("2 eggs"). Those still need to add
    /// up - a list that says "eggs: 2 (Fried Rice), 3 (Omelette)" is worse than
    /// one that says "5 eggs" - so they get their own dimension and render
    /// without a unit name.
    fn add_quantity(&mut self, amount: f64, unit: &str) {
        let (dim, base) = if unit.is_empty() {
            (Dimension::Count("item"), amount)
        } else {
            match (unit_dimension(unit), to_base(amount, unit)) {
                (Some(d), Some(b)) => (d, b),
                _ => return,
            }
        };
        match self.totals.iter_mut().find(|(d, _, _)| *d == dim) {
            Some((_, sum, units)) => {
                *sum += base;
                *units.entry(unit.to_string()).or_insert(0) += 1;
            }
            None => {
                let mut units = HashMap::new();
                units.insert(unit.to_string(), 1usize);
                self.totals.push((dim, base, units));
            }
        }
    }

    /// Renders each dimension's total back into whichever unit the recipes used
    /// most often - "3 cups" reads better than "710 ml" when every source said
    /// cups. Ties fall to the alphabetically first unit so output is stable.
    fn label(&self) -> Option<String> {
        if self.totals.is_empty() {
            return None;
        }
        let parts: Vec<String> = self
            .totals
            .iter()
            .filter_map(|(_, base, units)| {
                let mut best: Vec<(&String, &usize)> = units.iter().collect();
                best.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
                let unit = best.first()?.0;
                if unit.is_empty() {
                    return Some(format_amount(tidy_amount(*base)));
                }
                let shown = from_base(*base, unit)?;
                Some(format!("{} {}", format_amount(tidy_amount(shown)), unit))
            })
            .collect();
        if parts.is_empty() { None } else { Some(parts.join(" + ")) }
    }
}

pub async fn grocery_list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(p): Query<RangeParams>,
) -> Result<Json<GroceryList>, StatusCode> {
    checked_range(&p)?;
    let rows = planned_ingredients(&state, user.id, p.from, p.to).await?;

    let meals_planned: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM meal_plan_entries WHERE user_id=$1 AND plan_date BETWEEN $2 AND $3",
    )
    .bind(user.id)
    .bind(p.from)
    .bind(p.to)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;

    // Matched lines group by catalog id so "cherry tomatoes" and "grape
    // tomatoes" merge; unmatched ones fall back to their own lowercased text.
    let mut buckets: HashMap<String, Bucket> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for r in rows {
        let key = match r.ingredient_id {
            Some(id) => format!("i:{id}"),
            None => format!("n:{}", r.raw_name.trim().to_lowercase()),
        };
        if !buckets.contains_key(&key) {
            order.push(key.clone());
        }
        let b = buckets.entry(key).or_default();

        if b.name.is_empty() {
            b.name = r.raw_name.clone();
            b.ingredient_id = r.ingredient_id;
            b.category = r.category.clone().unwrap_or_else(|| "Other".into());
            b.in_fridge = r.in_fridge;
        }
        if !b.from_meals.contains(&r.meal_name) {
            b.from_meals.push(r.meal_name.clone());
        }

        match (r.amount, r.unit.as_deref()) {
            // Servings scale the recipe: two portions of a dish need twice the flour.
            (Some(a), Some(u)) => b.add_quantity(a * r.servings.max(1) as f64, u),
            // A bare count ("2 eggs") still sums; "" is the unitless dimension.
            (Some(a), None) => b.add_quantity(a * r.servings.max(1) as f64, ""),
            _ => {
                let text = r.note.clone().unwrap_or_else(|| r.raw_name.clone());
                let line = format!("{text} ({})", r.meal_name);
                if !b.unquantified.contains(&line) {
                    b.unquantified.push(line);
                }
            }
        }
    }

    let mut items: Vec<GroceryItem> = order
        .into_iter()
        .filter_map(|k| {
            let b = buckets.remove(&k)?;
            Some(GroceryItem {
                total_label: b.label(),
                key: k,
                name: b.name,
                ingredient_id: b.ingredient_id,
                category: b.category,
                in_fridge: b.in_fridge,
                meal_count: b.from_meals.len(),
                from_meals: b.from_meals,
                unquantified: b.unquantified,
            })
        })
        .collect();

    // Shared ingredients first: they're the reason to plan a week at once.
    items.sort_by(|a, b| {
        b.meal_count
            .cmp(&a.meal_count)
            .then(a.category.cmp(&b.category))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let shared_count = items.iter().filter(|i| i.meal_count > 1).count();

    Ok(Json(GroceryList {
        items,
        meals_planned: meals_planned as usize,
        shared_count,
    }))
}

#[derive(Deserialize)]
pub struct PushBody {
    /// Grocery keys the user ticked; anything already in the fridge is
    /// normally left out by the client.
    pub keys: Vec<String>,
    pub from: NaiveDate,
    pub to: NaiveDate,
}

/// Moves chosen grocery lines onto the real shopping list.
pub async fn push_to_shopping(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(b): Json<PushBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if b.to < b.from {
        return Err(StatusCode::BAD_REQUEST);
    }
    let rows = planned_ingredients(&state, user.id, b.from, b.to).await?;

    let mut seen: Vec<String> = Vec::new();
    let mut added = 0usize;
    let mut tx = state.db.begin().await.map_err(db_err)?;

    for r in rows {
        let key = match r.ingredient_id {
            Some(id) => format!("i:{id}"),
            None => format!("n:{}", r.raw_name.trim().to_lowercase()),
        };
        if !b.keys.contains(&key) || seen.contains(&key) {
            continue;
        }
        seen.push(key);

        let res = match r.ingredient_id {
            Some(id) => {
                sqlx::query(
                    "INSERT INTO shopping_items (user_id, ingredient_id) VALUES ($1,$2)
                     ON CONFLICT DO NOTHING",
                )
                .bind(user.id)
                .bind(id)
                .execute(&mut *tx)
                .await
            }
            None => {
                sqlx::query(
                    "INSERT INTO shopping_items (user_id, custom_name) VALUES ($1,$2)
                     ON CONFLICT DO NOTHING",
                )
                .bind(user.id)
                .bind(r.raw_name.trim())
                .execute(&mut *tx)
                .await
            }
        }
        .map_err(db_err)?;
        added += res.rows_affected() as usize;
    }

    tx.commit().await.map_err(db_err)?;
    Ok(Json(serde_json::json!({ "added": added })))
}

// ------------------------------------------------------- reuse suggestions

#[derive(Serialize, sqlx::FromRow)]
pub struct Suggestion {
    pub id: i64,
    pub name: String,
    pub cuisine: String,
    pub time_minutes: i32,
    pub rating: f64,
    pub photo_url: Option<String>,
    /// Ingredients this shares with what's already planned.
    pub shared: i64,
    pub total: i64,
    /// The shared ingredient names, so the card can say *why* it's suggested.
    pub shared_names: Vec<String>,
}

/// Suggests meals that reuse what the week already calls for.
///
/// This is the point of planning a week rather than a day: buy one bunch of
/// coriander and have three meals use it, instead of watching two thirds of it
/// wilt. Ranked by shared-ingredient count, then by the share of the meal
/// already covered, so a simple dish that reuses three things beats an
/// elaborate one that happens to touch four.
pub async fn suggestions(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(p): Query<RangeParams>,
) -> Result<Json<Vec<Suggestion>>, StatusCode> {
    checked_range(&p)?;

    let rows = sqlx::query_as::<_, Suggestion>(
        "WITH planned AS (
             SELECT DISTINCT mi.ingredient_id
             FROM meal_plan_entries e
             JOIN meal_ingredients mi ON mi.meal_id = e.meal_id
             WHERE e.user_id = $1 AND e.plan_date BETWEEN $2 AND $3
               AND mi.ingredient_id IS NOT NULL
         ),
         already AS (
             SELECT DISTINCT meal_id FROM meal_plan_entries
             WHERE user_id = $1 AND plan_date BETWEEN $2 AND $3
         )
         SELECT m.id, m.name, m.cuisine, m.time_minutes, m.rating::float8 AS rating, m.photo_url,
                count(*) FILTER (WHERE mi.ingredient_id IN (SELECT ingredient_id FROM planned)) AS shared,
                count(*) AS total,
                COALESCE(array_agg(DISTINCT i.name)
                         FILTER (WHERE mi.ingredient_id IN (SELECT ingredient_id FROM planned)),
                         '{}') AS shared_names
         FROM meals m
         JOIN meal_ingredients mi ON mi.meal_id = m.id
         LEFT JOIN ingredients i ON i.id = mi.ingredient_id
         WHERE m.visibility = 'public' AND m.status = 'live'
           AND m.id NOT IN (SELECT meal_id FROM already)
         GROUP BY m.id
         HAVING count(*) FILTER (WHERE mi.ingredient_id IN (SELECT ingredient_id FROM planned)) > 0
         ORDER BY shared DESC,
                  (count(*) FILTER (WHERE mi.ingredient_id IN (SELECT ingredient_id FROM planned))::float8
                   / NULLIF(count(*), 0)) DESC,
                  m.ranked_score DESC
         LIMIT 12",
    )
    .bind(user.id)
    .bind(p.from)
    .bind(p.to)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;

    Ok(Json(rows))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_compatible_units_and_renders_the_common_one() {
        let mut b = Bucket::default();
        b.add_quantity(2.0, "cup");
        b.add_quantity(1.0, "cup");
        assert_eq!(b.label().as_deref(), Some("3 cup"));
    }

    #[test]
    fn converts_within_a_dimension_before_summing() {
        let mut b = Bucket::default();
        b.add_quantity(500.0, "g");
        b.add_quantity(1.0, "kg");
        // Grams appear as often as kilos; the tie resolves to "g" by name.
        assert_eq!(b.label().as_deref(), Some("1500 g"));
    }

    #[test]
    fn keeps_incompatible_dimensions_separate() {
        let mut b = Bucket::default();
        b.add_quantity(2.0, "cup");
        b.add_quantity(100.0, "g");
        let label = b.label().unwrap();
        assert!(label.contains('+'), "expected two totals, got {label}");
    }

    #[test]
    fn countable_units_do_not_merge_with_each_other() {
        let mut b = Bucket::default();
        b.add_quantity(2.0, "clove");
        b.add_quantity(1.0, "can");
        assert!(b.label().unwrap().contains('+'));
    }

    #[test]
    fn no_quantities_means_no_label() {
        assert_eq!(Bucket::default().label(), None);
    }

    #[test]
    fn bare_counts_sum_without_inventing_a_unit() {
        let mut b = Bucket::default();
        b.add_quantity(2.0, ""); // "2 eggs"
        b.add_quantity(3.0, ""); // "3 eggs"
        assert_eq!(b.label().as_deref(), Some("5"));
    }

    #[test]
    fn bare_counts_stay_apart_from_measured_units() {
        let mut b = Bucket::default();
        b.add_quantity(2.0, "");
        b.add_quantity(100.0, "g");
        assert!(b.label().unwrap().contains('+'));
    }
}
