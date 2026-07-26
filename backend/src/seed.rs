use serde::Deserialize;
use sqlx::PgPool;

#[derive(Deserialize)]
pub struct FoodbRow {
    name: String,
    category: String,
    group: String,
    subgroup: String,
    desc: String,
    calories: f64,
    protein: f64,
    carbs: f64,
    fat: f64,
    fiber: f64,
    sugar: f64,
    #[serde(rename = "vitC")]
    vit_c: f64,
    calcium: f64,
    iron: f64,
    potassium: f64,
    magnesium: f64,
    sodium: f64,
}

const FOODB_JSON: &str = include_str!("../seed/foodb.json");

/// Idempotent: skips entirely once the catalog is populated.
pub async fn seed_ingredients(db: &PgPool) -> anyhow::Result<()> {
    let existing: i64 = sqlx::query_scalar("SELECT count(*) FROM ingredients")
        .fetch_one(db)
        .await?;
    if existing > 0 {
        tracing::info!("ingredients already seeded ({existing} rows), skipping");
        return Ok(());
    }

    let rows: Vec<FoodbRow> = serde_json::from_str(FOODB_JSON)?;
    let count = rows.len();

    let mut tx = db.begin().await?;
    for r in rows {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO ingredients (name, category, foodb_group, foodb_subgroup, description)
             VALUES ($1, $2, $3, $4, $5) RETURNING id",
        )
        .bind(&r.name)
        .bind(&r.category)
        .bind(&r.group)
        .bind(&r.subgroup)
        .bind(&r.desc)
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO ingredient_nutrition
             (ingredient_id, serving_size, calories, protein, carbs, fat, fiber, sugar, source,
              vit_c_mg, calcium_mg, iron_mg, potassium_mg, magnesium_mg, sodium_mg)
             VALUES ($1, '100 g', $2, $3, $4, $5, $6, $7, 'FooDB', $8, $9, $10, $11, $12, $13)",
        )
        .bind(id)
        .bind(r.calories as i32)
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

    tracing::info!("seeded {count} ingredients");
    Ok(())
}
