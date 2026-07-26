use serde::Deserialize;
use sqlx::PgPool;

/// One row per USDA FoodData Central "Foundation Foods" entry (see
/// backend/seed/README.md for how this file is generated). Nutrients are
/// nullable since not every food reports every value (e.g. table salt has
/// no Energy row; some bean-variety samples report only minerals).
#[derive(Deserialize)]
pub struct UsdaRow {
    name: String,
    category: String,
    #[serde(rename = "foodGroup")]
    food_group: Option<String>,
    #[serde(rename = "foodSubgroup")]
    food_subgroup: Option<String>,
    calories: Option<i32>,
    protein: Option<f64>,
    carbs: Option<f64>,
    fat: Option<f64>,
    fiber: Option<f64>,
    sugar: Option<f64>,
    #[serde(rename = "vitC")]
    vit_c: Option<f64>,
    calcium: Option<f64>,
    iron: Option<f64>,
    potassium: Option<f64>,
    magnesium: Option<f64>,
    sodium: Option<f64>,
}

const USDA_JSON: &str = include_str!("../seed/usda_foundation_foods.json");

/// Idempotent: skips entirely once the catalog is populated. Ingredients start
/// with an empty `description` (the schema default) - USDA's dataset carries no
/// prose descriptions, so the community-edit feature is the intended way a
/// description gets added, same as any other field.
pub async fn seed_ingredients(db: &PgPool) -> anyhow::Result<()> {
    let existing: i64 = sqlx::query_scalar("SELECT count(*) FROM ingredients")
        .fetch_one(db)
        .await?;
    if existing > 0 {
        tracing::info!("ingredients already seeded ({existing} rows), skipping");
        return Ok(());
    }

    let rows: Vec<UsdaRow> = serde_json::from_str(USDA_JSON)?;
    let count = rows.len();

    let mut tx = db.begin().await?;
    for r in rows {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO ingredients (name, category, food_group, food_subgroup)
             VALUES ($1, $2, $3, $4) RETURNING id",
        )
        .bind(&r.name)
        .bind(&r.category)
        .bind(&r.food_group)
        .bind(&r.food_subgroup)
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO ingredient_nutrition
             (ingredient_id, serving_size, calories, protein, carbs, fat, fiber, sugar, source,
              vit_c_mg, calcium_mg, iron_mg, potassium_mg, magnesium_mg, sodium_mg)
             VALUES ($1, '100 g', $2, $3, $4, $5, $6, $7, 'USDA', $8, $9, $10, $11, $12, $13)",
        )
        .bind(id)
        .bind(r.calories)
        .bind(r.protein)
        .bind(r.carbs)
        .bind(r.fat)
        .bind(r.fiber)
        .bind(r.sugar)
        .bind(r.vit_c)
        .bind(r.calcium)
        .bind(r.iron)
        .bind(r.potassium)
        .bind(r.magnesium)
        .bind(r.sodium)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    tracing::info!("seeded {count} ingredients from USDA FoodData Central (Foundation Foods)");
    Ok(())
}
