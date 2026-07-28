use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::state::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct IngredientSummary {
    pub id: i64,
    pub name: String,
    pub category: String,
    pub food_group: Option<String>,
    pub food_subgroup: Option<String>,
    pub rating: f64,
    pub rating_count: i32,
    /// Heuristic, community-editable - see diet.rs. Empty means "not yet
    /// tagged," not "compatible with nothing."
    pub diet_flags: Vec<String>,
}

#[derive(Serialize)]
pub struct Nutrition {
    pub serving_size: String,
    pub calories: Option<i32>,
    pub protein: Option<f64>,
    pub carbs: Option<f64>,
    pub fat: Option<f64>,
    pub fiber: Option<f64>,
    pub sugar: Option<f64>,
    pub source: String,
    pub micros: Micros,
}

#[derive(Serialize)]
pub struct Micros {
    pub vit_c_mg: Option<f64>,
    pub calcium_mg: Option<f64>,
    pub iron_mg: Option<f64>,
    pub potassium_mg: Option<f64>,
    pub magnesium_mg: Option<f64>,
    pub sodium_mg: Option<f64>,
}

#[derive(Serialize)]
pub struct IngredientDetail {
    #[serde(flatten)]
    pub summary: IngredientSummary,
    pub description: String,
    pub photo_url: Option<String>,
    pub nutrition: Option<Nutrition>,
}

#[derive(Deserialize)]
pub struct ListParams {
    pub search: Option<String>,
    pub category: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<IngredientSummary>>, StatusCode> {
    let limit = params.limit.unwrap_or(500).clamp(1, 500);
    let offset = params.offset.unwrap_or(0).max(0);

    let rows = sqlx::query_as::<_, IngredientSummary>(
        "SELECT id, name, category, food_group, food_subgroup,
                rating::float8 AS rating, rating_count, diet_flags
         FROM ingredients i
         WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%'
                -- An endorsed alias counts as a name match too, so searching
                -- \"cilantro\" finds \"Coriander, leaves, raw\" here, not just
                -- through the dedicated /search endpoint.
                OR ($1::text IS NOT NULL AND EXISTS (
                     SELECT 1 FROM ingredient_aliases a
                     WHERE a.ingredient_id = i.id AND a.status = 'live' AND a.score >= $5
                       AND a.name ILIKE '%' || $1 || '%')))
           AND ($2::text IS NULL OR category = $2)
         ORDER BY name
         LIMIT $3 OFFSET $4",
    )
    .bind(params.search.as_deref().filter(|s| !s.is_empty()))
    .bind(params.category.as_deref().filter(|s| !s.is_empty()))
    .bind(limit)
    .bind(offset)
    .bind(crate::aliases::SEARCH_THRESHOLD)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("list ingredients failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(rows))
}

pub async fn categories(
    State(state): State<AppState>,
) -> Result<Json<Vec<String>>, StatusCode> {
    let rows: Vec<String> =
        sqlx::query_scalar("SELECT DISTINCT category FROM ingredients ORDER BY category")
            .fetch_all(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("list categories failed: {e}");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct NewIngredient {
    pub name: String,
    pub category: String,
    pub description: Option<String>,
    pub photo_url: Option<String>,
    pub serving_size: Option<String>,
    pub calories: Option<i32>,
    pub protein: Option<f64>,
    pub carbs: Option<f64>,
    pub fat: Option<f64>,
    pub rating: Option<i16>,
    /// Set once the user has seen and dismissed the "looks similar to…" warning.
    pub confirmed_new: Option<bool>,
}

#[derive(Serialize)]
pub struct CreateIngredientResponse {
    pub id: Option<i64>,
    /// Present when a near-duplicate blocked the create.
    pub close_match: Option<CloseMatch>,
}

#[derive(Serialize)]
pub struct CloseMatch {
    pub id: i64,
    pub name: String,
    pub used_in_meals: i64,
}

pub async fn create(
    State(state): State<AppState>,
    crate::auth::CurrentUser(user): crate::auth::CurrentUser,
    Json(body): Json<NewIngredient>,
) -> Result<(StatusCode, Json<CreateIngredientResponse>), (StatusCode, Json<serde_json::Value>)> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(bad("Please enter an ingredient name."));
    }

    // One page per ingredient: an exact name clash is always rejected.
    let exact: Option<i64> = sqlx::query_scalar("SELECT id FROM ingredients WHERE lower(name) = lower($1)")
        .bind(name)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| oops())?;
    if exact.is_some() {
        return Err(bad(&format!(
            "\u{201c}{name}\u{201d} already has a page — only one page per ingredient."
        )));
    }

    // A fuzzy hit only warns: the user can confirm and create anyway.
    if !body.confirmed_new.unwrap_or(false) {
        let close = sqlx::query_as::<_, (i64, String, i64)>(
            "SELECT i.id, i.name,
                    (SELECT count(*) FROM meal_ingredients mi WHERE mi.ingredient_id = i.id)
             FROM ingredients i
             WHERE i.name ILIKE '%' || $1 || '%' OR $1 ILIKE '%' || i.name || '%'
             ORDER BY length(i.name) LIMIT 1",
        )
        .bind(name)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| oops())?;

        if let Some((id, matched, used)) = close {
            return Ok((
                StatusCode::OK,
                Json(CreateIngredientResponse {
                    id: None,
                    close_match: Some(CloseMatch { id, name: matched, used_in_meals: used }),
                }),
            ));
        }
    }

    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    // Computed at creation, not left for the next server restart's backfill
    // to pick up - a user-submitted ingredient has no `food_group` (that's a
    // USDA-only field), so this is name+category only, an even rougher
    // guess than the catalog's own heuristic.
    let diet_flags = crate::diet::compute_diet_flags(name, body.category.trim(), None);

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO ingredients (name, category, description, photo_url, author_id, rating, rating_count, diet_flags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    )
    .bind(name)
    .bind(body.category.trim())
    .bind(body.description.as_deref().unwrap_or("").trim())
    .bind(body.photo_url.as_deref())
    .bind(user.id)
    .bind(body.rating.map(f64::from).unwrap_or(0.0))
    .bind(i32::from(body.rating.is_some()))
    .bind(&diet_flags)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("create ingredient failed: {e}");
        oops()
    })?;

    let has_nutrition = body.calories.is_some()
        || body.protein.is_some()
        || body.carbs.is_some()
        || body.fat.is_some()
        || body.serving_size.is_some();

    if has_nutrition {
        sqlx::query(
            "INSERT INTO ingredient_nutrition
               (ingredient_id, serving_size, calories, protein, carbs, fat, source)
             VALUES ($1,$2,$3,$4,$5,$6,'Community')",
        )
        .bind(id)
        .bind(body.serving_size.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or("1 serving"))
        .bind(body.calories)
        .bind(body.protein)
        .bind(body.carbs)
        .bind(body.fat)
        .execute(&mut *tx)
        .await
        .map_err(|_| oops())?;
    }

    if let Some(v) = body.rating {
        sqlx::query("INSERT INTO ratings (user_id, subject_type, subject_id, value) VALUES ($1,'ingredient',$2,$3)")
            .bind(user.id).bind(id).bind(v)
            .execute(&mut *tx).await.ok();
    }

    tx.commit().await.map_err(|_| oops())?;

    Ok((StatusCode::CREATED, Json(CreateIngredientResponse { id: Some(id), close_match: None })))
}

const EDIT_FIELDS: [&str; 5] = ["description", "category", "photo", "nutrition", "diet_flags"];

#[derive(Deserialize)]
pub struct SubmitEdit {
    pub field: String,
    pub value: serde_json::Value,
}

/// A community edit proposal starts with the submitter's own vote already
/// counted, exactly like the prototype (new edits start at votes:1).
pub async fn submit_edit(
    State(state): State<AppState>,
    crate::auth::CurrentUser(user): crate::auth::CurrentUser,
    Path(id): Path<i64>,
    Json(body): Json<SubmitEdit>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    if !EDIT_FIELDS.contains(&body.field.as_str()) {
        return Err(bad("Not something you can edit."));
    }
    if body.field == "diet_flags" {
        let valid = body
            .value
            .as_array()
            .is_some_and(|a| a.iter().all(|v| v.as_str().is_some_and(|s| crate::diet::ALL_DIET_FLAGS.contains(&s))));
        if !valid {
            return Err(bad("Not a recognized diet tag."));
        }
    }

    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    let edit_id: i64 = sqlx::query_scalar(
        "INSERT INTO ingredient_edits (ingredient_id, field, value, author_id, votes)
         VALUES ($1,$2,$3,$4,1) RETURNING id",
    )
    .bind(id)
    .bind(&body.field)
    .bind(&body.value)
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("submit edit failed: {e}");
        oops()
    })?;

    sqlx::query("INSERT INTO edit_votes (user_id, edit_id) VALUES ($1,$2)")
        .bind(user.id)
        .bind(edit_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| oops())?;

    let newly_won = apply_winner(&mut tx, id, &body.field).await.map_err(|_| oops())?;
    tx.commit().await.map_err(|_| oops())?;
    notify_edit_won(&state, newly_won, id).await;
    Ok(StatusCode::CREATED)
}

#[derive(Serialize, sqlx::FromRow)]
pub struct EditRow {
    pub id: i64,
    pub value: serde_json::Value,
    pub author_name: Option<String>,
    /// NULL for a former user (account deleted, FK `SET NULL`) - present so
    /// the byline can link to a profile when there's one to link to.
    pub author_id: Option<i64>,
    pub votes: i32,
    pub voted_by_me: bool,
    pub is_mine: bool,
    pub author_tier: Option<String>,
}

pub async fn list_edits(
    State(state): State<AppState>,
    viewer: Option<crate::auth::CurrentUser>,
    Path((id, field)): Path<(i64, String)>,
) -> Result<Json<Vec<EditRow>>, StatusCode> {
    if !EDIT_FIELDS.contains(&field.as_str()) {
        return Err(StatusCode::NOT_FOUND);
    }
    let viewer_id = viewer.map(|u| u.0.id);
    let rows = sqlx::query_as::<_, EditRow>(
        "SELECT e.id, e.value, u.display_name AS author_name, e.author_id, e.votes,
                EXISTS (SELECT 1 FROM edit_votes v WHERE v.user_id = $3 AND v.edit_id = e.id) AS voted_by_me,
                COALESCE(e.author_id = $3, false) AS is_mine,
                CASE WHEN e.author_id IS NULL THEN NULL ELSE contributor_tier(e.author_id) END AS author_tier
         FROM ingredient_edits e LEFT JOIN users u ON u.id = e.author_id
         WHERE e.ingredient_id = $1 AND e.field = $2
         ORDER BY e.votes DESC, e.id ASC
         LIMIT 20",
    )
    .bind(id)
    .bind(&field)
    .bind(viewer_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

/// Author-only: withdraw your own edit submission, then recompute the winner
/// for that field (which may revert to no-photo / blank description if that
/// was the only edit).
pub async fn delete_edit(
    State(state): State<AppState>,
    crate::auth::CurrentUser(user): crate::auth::CurrentUser,
    Path((id, edit_id)): Path<(i64, i64)>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let mut tx = state.db.begin().await.map_err(|_| oops())?;

    let row: Option<(Option<i64>, String)> = sqlx::query_as(
        "SELECT author_id, field FROM ingredient_edits WHERE id = $1 AND ingredient_id = $2",
    )
    .bind(edit_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| oops())?;

    let Some((author_id, field)) = row else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Not found." }))));
    };
    if author_id != Some(user.id) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "You can only delete your own submission." })),
        ));
    }

    sqlx::query("DELETE FROM ingredient_edits WHERE id = $1")
        .bind(edit_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| oops())?;

    let newly_won = apply_winner(&mut tx, id, &field).await.map_err(|_| oops())?;
    tx.commit().await.map_err(|_| oops())?;
    notify_edit_won(&state, newly_won, id).await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn vote_edit(
    State(state): State<AppState>,
    crate::auth::CurrentUser(user): crate::auth::CurrentUser,
    Path((id, edit_id)): Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let field: Option<String> =
        sqlx::query_scalar("SELECT field FROM ingredient_edits WHERE id = $1 AND ingredient_id = $2")
            .bind(edit_id)
            .bind(id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some(field) = field else { return Err(StatusCode::NOT_FOUND) };

    let mut tx = state.db.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let removed = sqlx::query("DELETE FROM edit_votes WHERE user_id = $1 AND edit_id = $2")
        .bind(user.id)
        .bind(edit_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected();

    if removed == 0 {
        sqlx::query("INSERT INTO edit_votes (user_id, edit_id) VALUES ($1,$2)")
            .bind(user.id)
            .bind(edit_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    // Weighted by each voter's reputation - an edit endorsed by five
    // brand-new accounts and one endorsed by five people with a track record
    // of good edits shouldn't necessarily tie. The per-voter weight itself
    // never leaves the server; `votes` is the already-combined result.
    sqlx::query(
        "UPDATE ingredient_edits SET votes = (
           SELECT COALESCE(round(sum(reputation_weight(v.user_id))), 0)
           FROM edit_votes v WHERE v.edit_id = $1
         ) WHERE id = $1",
    )
    .bind(edit_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let newly_won = apply_winner(&mut tx, id, &field).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    notify_edit_won(&state, newly_won, id).await;

    Ok(Json(serde_json::json!({ "voted": removed == 0 })))
}

/// Best-effort email for whoever's edit `apply_winner` just crowned -
/// looked up post-commit since `apply_winner` only has a transaction, not
/// the pool `send_notification_email` needs.
async fn notify_edit_won(state: &AppState, newly_won_author: Option<i64>, ingredient_id: i64) {
    let Some(author_id) = newly_won_author else { return };
    let name: Option<String> = sqlx::query_scalar("SELECT name FROM ingredients WHERE id = $1")
        .bind(ingredient_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    let name = name.unwrap_or_else(|| "an ingredient".to_string());
    crate::notify::send_notification_email(
        &state.db, author_id, "edit_won",
        "Your edit was approved on Cookbook",
        &format!("Your proposed edit to \"{}\" is now the community-approved version.", name),
    ).await;
}

/// Highest votes wins; ties go to the oldest edit (lowest id) since rows are
/// already ordered that way - mirrors the prototype's pickWinner exactly.
/// Applies the result onto the materialized ingredients/ingredient_nutrition
/// columns that every other endpoint reads.
/// Returns the winning edit's author when this call is the one that just
/// made them the winner - `None` on every other call, including when an
/// edit stays the winner across a later vote. See the doc on the return
/// site below for why the caller (not this function) sends the email.
pub(crate) async fn apply_winner(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ingredient_id: i64,
    field: &str,
) -> Result<Option<i64>, sqlx::Error> {
    let winner: Option<(i64, Option<i64>, serde_json::Value)> = sqlx::query_as(
        "SELECT id, author_id, value FROM ingredient_edits WHERE ingredient_id = $1 AND field = $2
         ORDER BY votes DESC, id ASC LIMIT 1",
    )
    .bind(ingredient_id)
    .bind(field)
    .fetch_optional(&mut **tx)
    .await?;

    // No edits left for this field (e.g. the last one was just deleted): the
    // materialized column has no "original" to fall back to for category/
    // nutrition (a winning edit overwrites it with nothing kept in reserve),
    // so those are left as-is. description/photo do have a clean default.
    let Some((edit_id, author_id, value)) = winner else {
        match field {
            "description" => {
                sqlx::query("UPDATE ingredients SET description = '' WHERE id = $1")
                    .bind(ingredient_id)
                    .execute(&mut **tx)
                    .await?;
            }
            "photo" => {
                sqlx::query("UPDATE ingredients SET photo_url = NULL WHERE id = $1")
                    .bind(ingredient_id)
                    .execute(&mut **tx)
                    .await?;
            }
            "diet_flags" => {
                // No proposal left to fall back to - clearing to empty is
                // honest (no claim at all) rather than resurrecting the
                // original heuristic guess, which the community may have
                // specifically voted away from.
                sqlx::query("UPDATE ingredients SET diet_flags = '{}' WHERE id = $1")
                    .bind(ingredient_id)
                    .execute(&mut **tx)
                    .await?;
            }
            _ => {}
        }
        return Ok(None);
    };

    match field {
        "description" => {
            if let Some(s) = value.as_str() {
                sqlx::query("UPDATE ingredients SET description = $1 WHERE id = $2")
                    .bind(s)
                    .bind(ingredient_id)
                    .execute(&mut **tx)
                    .await?;
            }
        }
        "category" => {
            if let Some(s) = value.as_str() {
                sqlx::query("UPDATE ingredients SET category = $1 WHERE id = $2")
                    .bind(s)
                    .bind(ingredient_id)
                    .execute(&mut **tx)
                    .await?;
            }
        }
        "photo" => {
            let photo = value.as_str().filter(|s| !s.is_empty());
            sqlx::query("UPDATE ingredients SET photo_url = $1 WHERE id = $2")
                .bind(photo)
                .bind(ingredient_id)
                .execute(&mut **tx)
                .await?;
        }
        "nutrition" => {
            let get_f64 = |k: &str| value.get(k).and_then(|v| v.as_f64());
            let get_i32 = |k: &str| value.get(k).and_then(|v| v.as_i64()).map(|v| v as i32);
            let serving_size = value.get("serving_size").and_then(|v| v.as_str()).unwrap_or("1 serving");

            sqlx::query(
                "INSERT INTO ingredient_nutrition
                   (ingredient_id, serving_size, calories, protein, carbs, fat, fiber, sugar, source)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Community')
                 ON CONFLICT (ingredient_id) DO UPDATE SET
                   serving_size = EXCLUDED.serving_size,
                   calories = EXCLUDED.calories, protein = EXCLUDED.protein,
                   carbs = EXCLUDED.carbs, fat = EXCLUDED.fat,
                   fiber = COALESCE(EXCLUDED.fiber, ingredient_nutrition.fiber),
                   sugar = COALESCE(EXCLUDED.sugar, ingredient_nutrition.sugar),
                   source = 'Community'",
            )
            .bind(ingredient_id)
            .bind(serving_size)
            .bind(get_i32("calories"))
            .bind(get_f64("protein"))
            .bind(get_f64("carbs"))
            .bind(get_f64("fat"))
            .bind(get_f64("fiber"))
            .bind(get_f64("sugar"))
            .execute(&mut **tx)
            .await?;
        }
        "diet_flags" => {
            let flags: Vec<String> = value
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            sqlx::query("UPDATE ingredients SET diet_flags = $1 WHERE id = $2")
                .bind(&flags)
                .bind(ingredient_id)
                .execute(&mut **tx)
                .await?;
        }
        _ => {}
    }

    // Only the edit that JUST became the winner gets notified - apply_winner
    // runs after every vote on this field, so without the flag an edit that
    // won once and stayed on top would re-notify its author on every
    // subsequent vote, which is spam, not news.
    let newly_won: Option<bool> = sqlx::query_scalar(
        "UPDATE ingredient_edits SET notified_win = true WHERE id = $1 AND notified_win = false RETURNING true",
    )
    .bind(edit_id)
    .fetch_optional(&mut **tx)
    .await?;
    let mut newly_won_author = None;
    if newly_won.is_some() {
        if let Some(author_id) = author_id {
            sqlx::query(
                "INSERT INTO notifications (recipient_id, actor_id, type, subject_type, subject_id)
                 VALUES ($1, NULL, 'edit_won', 'ingredient', $2)",
            )
            .bind(author_id)
            .bind(ingredient_id)
            .execute(&mut **tx)
            .await
            .ok();
            newly_won_author = Some(author_id);
        }
    }

    // Returned rather than emailed from here - `apply_winner` only has a
    // transaction, not the pool `send_notification_email` needs, so the
    // caller sends it once the transaction (and thus this win) is committed.
    Ok(newly_won_author)
}

#[derive(Serialize, sqlx::FromRow)]
pub struct UsedInMeal {
    pub id: i64,
    pub name: String,
    pub cuisine: String,
    /// Whether the viewer's fridge already covers every ingredient this meal needs.
    pub can_make: bool,
}

pub async fn used_in_meals(
    State(state): State<AppState>,
    user: Option<crate::auth::CurrentUser>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<UsedInMeal>>, StatusCode> {
    let viewer = user.map(|u| u.0.id);
    let rows = sqlx::query_as::<_, UsedInMeal>(
        "SELECT m.id, m.name, m.cuisine,
                NOT EXISTS (
                  SELECT 1 FROM meal_ingredients mi2
                  WHERE mi2.meal_id = m.id
                    AND NOT EXISTS (SELECT 1 FROM fridge_items f
                                    WHERE f.user_id = $2 AND f.ingredient_id = mi2.ingredient_id)
                ) AS can_make
         FROM meals m
         JOIN meal_ingredients mi ON mi.meal_id = m.id
         WHERE mi.ingredient_id = $1 AND m.visibility = 'public' AND m.status = 'live'
         ORDER BY m.ranked_score DESC
         LIMIT 30",
    )
    .bind(id)
    .bind(viewer)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("used_in_meals failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(rows))
}

fn bad(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg })))
}
fn oops() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": "Could not save that ingredient." })),
    )
}

pub async fn detail(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<IngredientDetail>, StatusCode> {
    let row = sqlx::query_as::<_, (i64, String, String, Option<String>, Option<String>, f64, i32, String, Option<String>, Vec<String>)>(
        "SELECT id, name, category, food_group, food_subgroup,
                rating::float8, rating_count, description, photo_url, diet_flags
         FROM ingredients WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("ingredient detail failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or(StatusCode::NOT_FOUND)?;

    let nutrition = sqlx::query_as::<_, (String, Option<i32>, Option<f64>, Option<f64>, Option<f64>, Option<f64>, Option<f64>, String, Option<f64>, Option<f64>, Option<f64>, Option<f64>, Option<f64>, Option<f64>)>(
        "SELECT serving_size, calories, protein::float8, carbs::float8, fat::float8,
                fiber::float8, sugar::float8, source,
                vit_c_mg::float8, calcium_mg::float8, iron_mg::float8,
                potassium_mg::float8, magnesium_mg::float8, sodium_mg::float8
         FROM ingredient_nutrition WHERE ingredient_id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("nutrition fetch failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .map(|n| Nutrition {
        serving_size: n.0,
        calories: n.1,
        protein: n.2,
        carbs: n.3,
        fat: n.4,
        fiber: n.5,
        sugar: n.6,
        source: n.7,
        micros: Micros {
            vit_c_mg: n.8,
            calcium_mg: n.9,
            iron_mg: n.10,
            potassium_mg: n.11,
            magnesium_mg: n.12,
            sodium_mg: n.13,
        },
    });

    Ok(Json(IngredientDetail {
        summary: IngredientSummary {
            id: row.0,
            name: row.1,
            category: row.2,
            food_group: row.3,
            food_subgroup: row.4,
            rating: row.5,
            rating_count: row.6,
            diet_flags: row.9,
        },
        description: row.7,
        photo_url: row.8,
        nutrition,
    }))
}
