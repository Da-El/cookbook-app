//! Per-serving nutrition for a recipe, computed from its own ingredient lines
//! rather than looked up - there's no shortcut around actually summing them.
//!
//! USDA values are per 100g, so a line only contributes when it can be
//! converted to grams without guessing: that means a mass unit (g/kg/oz/lb)
//! on a catalog-matched line. Volume ("2 cups flour") and counts ("2 eggs")
//! need an ingredient-specific density or portion weight this app doesn't
//! have loaded, and USDA Foundation Foods' `foodPortions` data - which does
//! carry it - was never ingested (see backend/seed/README.md). Estimating
//! anyway would produce a nutrition panel that's silently wrong for anyone
//! relying on it for an allergy or a macro target, which is worse than an
//! honest gap. `counted`/`total` on the response says exactly how partial
//! the number is instead of dressing it up as complete.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use sqlx::PgPool;

use crate::auth::CurrentUser;
use crate::state::AppState;
use crate::units::{to_base, unit_dimension, Dimension};

#[derive(sqlx::FromRow)]
struct NutritionLine {
    amount: Option<f64>,
    unit: Option<String>,
    calories: Option<i32>,
    protein: Option<f64>,
    carbs: Option<f64>,
    fat: Option<f64>,
    fiber: Option<f64>,
    sugar: Option<f64>,
    vit_c_mg: Option<f64>,
    calcium_mg: Option<f64>,
    iron_mg: Option<f64>,
    potassium_mg: Option<f64>,
    magnesium_mg: Option<f64>,
    sodium_mg: Option<f64>,
}

#[derive(Default, Serialize)]
pub struct NutritionTotals {
    pub calories: f64,
    pub protein: f64,
    pub carbs: f64,
    pub fat: f64,
    pub fiber: f64,
    pub sugar: f64,
    pub vit_c_mg: f64,
    pub calcium_mg: f64,
    pub iron_mg: f64,
    pub potassium_mg: f64,
    pub magnesium_mg: f64,
    pub sodium_mg: f64,
}

impl NutritionTotals {
    fn add_from_100g(&mut self, grams: f64, line: &NutritionLine) {
        let factor = grams / 100.0;
        self.calories += line.calories.unwrap_or(0) as f64 * factor;
        self.protein += line.protein.unwrap_or(0.0) * factor;
        self.carbs += line.carbs.unwrap_or(0.0) * factor;
        self.fat += line.fat.unwrap_or(0.0) * factor;
        self.fiber += line.fiber.unwrap_or(0.0) * factor;
        self.sugar += line.sugar.unwrap_or(0.0) * factor;
        self.vit_c_mg += line.vit_c_mg.unwrap_or(0.0) * factor;
        self.calcium_mg += line.calcium_mg.unwrap_or(0.0) * factor;
        self.iron_mg += line.iron_mg.unwrap_or(0.0) * factor;
        self.potassium_mg += line.potassium_mg.unwrap_or(0.0) * factor;
        self.magnesium_mg += line.magnesium_mg.unwrap_or(0.0) * factor;
        self.sodium_mg += line.sodium_mg.unwrap_or(0.0) * factor;
    }

    /// Accumulates another meal's totals into this one - used to build a
    /// day's running total across everything logged, not just one recipe.
    fn add(&mut self, other: &NutritionTotals) {
        self.calories += other.calories;
        self.protein += other.protein;
        self.carbs += other.carbs;
        self.fat += other.fat;
        self.fiber += other.fiber;
        self.sugar += other.sugar;
        self.vit_c_mg += other.vit_c_mg;
        self.calcium_mg += other.calcium_mg;
        self.iron_mg += other.iron_mg;
        self.potassium_mg += other.potassium_mg;
        self.magnesium_mg += other.magnesium_mg;
        self.sodium_mg += other.sodium_mg;
    }

    fn scaled(&self, factor: f64) -> NutritionTotals {
        NutritionTotals {
            calories: self.calories * factor,
            protein: self.protein * factor,
            carbs: self.carbs * factor,
            fat: self.fat * factor,
            fiber: self.fiber * factor,
            sugar: self.sugar * factor,
            vit_c_mg: self.vit_c_mg * factor,
            calcium_mg: self.calcium_mg * factor,
            iron_mg: self.iron_mg * factor,
            potassium_mg: self.potassium_mg * factor,
            magnesium_mg: self.magnesium_mg * factor,
            sodium_mg: self.sodium_mg * factor,
        }
    }
}

#[derive(Serialize)]
pub struct MealNutrition {
    pub per_serving: NutritionTotals,
    pub total: NutritionTotals,
    pub servings: i32,
    /// How many ingredient lines actually fed the total.
    pub counted: usize,
    /// How many the recipe has - always >= counted, so the UI can say
    /// "6 of 9 ingredients counted" instead of implying completeness.
    pub total_ingredients: usize,
}

/// First integer found in a free-text serving string ("4", "Serves 4-6",
/// "4 people"). Falls back to 1 rather than guessing a household-style
/// default - a wrong per-serving split is worse than an unscaled total.
fn parse_servings(serves: Option<&str>) -> i32 {
    let Some(s) = serves else { return 1 };
    let digits: String = s.chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok().filter(|&n: &i32| n > 0).unwrap_or(1)
}

pub async fn compute(db: &PgPool, meal_id: i64, serves: Option<&str>) -> Result<MealNutrition, sqlx::Error> {
    let lines = sqlx::query_as::<_, NutritionLine>(
        "SELECT mi.amount::float8 AS amount, mi.unit,
                n.calories, n.protein::float8 AS protein, n.carbs::float8 AS carbs,
                n.fat::float8 AS fat, n.fiber::float8 AS fiber, n.sugar::float8 AS sugar,
                n.vit_c_mg::float8 AS vit_c_mg, n.calcium_mg::float8 AS calcium_mg,
                n.iron_mg::float8 AS iron_mg, n.potassium_mg::float8 AS potassium_mg,
                n.magnesium_mg::float8 AS magnesium_mg, n.sodium_mg::float8 AS sodium_mg
         FROM meal_ingredients mi
         JOIN ingredient_nutrition n ON n.ingredient_id = mi.ingredient_id
         WHERE mi.meal_id = $1",
    )
    .bind(meal_id)
    .fetch_all(db)
    .await?;

    let total_ingredients: i64 = sqlx::query_scalar("SELECT count(*) FROM meal_ingredients WHERE meal_id = $1")
        .bind(meal_id)
        .fetch_one(db)
        .await?;

    let mut totals = NutritionTotals::default();
    let mut counted = 0usize;

    for line in &lines {
        let (Some(amount), Some(unit)) = (line.amount, line.unit.as_deref()) else { continue };
        if unit_dimension(unit) != Some(Dimension::Mass) {
            continue;
        }
        let Some(grams) = to_base(amount, unit) else { continue };
        totals.add_from_100g(grams, line);
        counted += 1;
    }

    let servings = parse_servings(serves).max(1);
    let per_serving = totals.scaled(1.0 / servings as f64);

    Ok(MealNutrition {
        per_serving,
        total: totals,
        servings,
        counted,
        total_ingredients: total_ingredients as usize,
    })
}

#[derive(Serialize)]
pub struct DailyGoals {
    pub calories: Option<i32>,
    pub protein_g: Option<i32>,
    pub carbs_g: Option<i32>,
    pub fat_g: Option<i32>,
}

#[derive(Serialize)]
pub struct TodayNutrition {
    pub totals: NutritionTotals,
    pub goals: DailyGoals,
    pub meals_logged: usize,
}

/// One serving assumed per `meal_log` entry - there's no quantity-eaten
/// tracking, so "cooked it" reads as "ate a serving of it," the same
/// simplifying assumption the rest of the app makes rather than pretending
/// to a precision it doesn't have (see this module's own doc comment).
pub async fn today(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<TodayNutrition>, StatusCode> {
    let today = chrono::Utc::now().date_naive();
    let logged: Vec<(i64, Option<String>)> = sqlx::query_as(
        "SELECT ml.meal_id, m.serves FROM meal_log ml
         JOIN meals m ON m.id = ml.meal_id
         WHERE ml.user_id = $1 AND ml.logged_at::date = $2",
    )
    .bind(user.id)
    .bind(today)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut totals = NutritionTotals::default();
    for (meal_id, serves) in &logged {
        if let Ok(n) = compute(&state.db, *meal_id, serves.as_deref()).await {
            totals.add(&n.per_serving);
        }
    }

    let goals: (Option<i32>, Option<i32>, Option<i32>, Option<i32>) = sqlx::query_as(
        "SELECT goal_calories, goal_protein_g, goal_carbs_g, goal_fat_g FROM users WHERE id = $1",
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(TodayNutrition {
        totals,
        goals: DailyGoals { calories: goals.0, protein_g: goals.1, carbs_g: goals.2, fat_g: goals.3 },
        meals_logged: logged.len(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(cal: i32, protein: f64) -> NutritionLine {
        NutritionLine {
            amount: None, unit: None,
            calories: Some(cal), protein: Some(protein),
            carbs: None, fat: None, fiber: None, sugar: None,
            vit_c_mg: None, calcium_mg: None, iron_mg: None,
            potassium_mg: None, magnesium_mg: None, sodium_mg: None,
        }
    }

    #[test]
    fn scales_from_per_100g_correctly() {
        let mut t = NutritionTotals::default();
        // 200g of something with 50 cal / 10g protein per 100g.
        t.add_from_100g(200.0, &line(50, 10.0));
        assert_eq!(t.calories, 100.0);
        assert_eq!(t.protein, 20.0);
    }

    #[test]
    fn per_serving_divides_the_total() {
        let mut t = NutritionTotals::default();
        t.add_from_100g(400.0, &line(100, 20.0));
        let per_serving = t.scaled(1.0 / 4.0);
        assert_eq!(per_serving.calories, 100.0);
        assert_eq!(t.calories, 400.0, "total must stay unscaled");
    }

    #[test]
    fn parses_leading_integer_from_free_text_servings() {
        assert_eq!(parse_servings(Some("4")), 4);
        assert_eq!(parse_servings(Some("Serves 4-6")), 4);
        assert_eq!(parse_servings(Some("about 8 people")), 8);
    }

    #[test]
    fn unparseable_or_missing_servings_falls_back_to_one_not_a_guessed_default() {
        assert_eq!(parse_servings(Some("a crowd")), 1);
        assert_eq!(parse_servings(None), 1);
        assert_eq!(parse_servings(Some("0")), 1, "zero servings is nonsensical, not a valid divisor");
    }
}
