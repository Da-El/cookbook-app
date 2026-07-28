use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::CurrentUser;
use crate::state::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct ChefCard {
    pub id: i64,
    pub display_name: String,
    pub avatar_theme: String,
    pub avatar_photo_url: Option<String>,
    pub meal_count: i64,
    pub top_cuisine: Option<String>,
    pub best_rating: Option<f64>,
    pub is_following: bool,
}

/// Chefs the viewer doesn't already follow, ranked the way the design specifies:
/// best rating first, then how much they've published.
pub async fn suggested_chefs(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<ChefCard>>, StatusCode> {
    let rows = sqlx::query_as::<_, ChefCard>(
        "SELECT u.id, u.display_name, u.cb_avatar_theme AS avatar_theme,
                u.cb_avatar_photo_url AS avatar_photo_url,
                (SELECT count(*) FROM meals m WHERE m.author_id=u.id AND m.visibility='public' AND m.status='live') AS meal_count,
                (SELECT m.cuisine FROM meals m WHERE m.author_id=u.id AND m.visibility='public' AND m.status='live'
                 GROUP BY m.cuisine ORDER BY count(*) DESC LIMIT 1) AS top_cuisine,
                (SELECT max(m.rating)::float8 FROM meals m WHERE m.author_id=u.id AND m.visibility='public' AND m.status='live') AS best_rating,
                FALSE AS is_following
         FROM users u
         WHERE u.id <> $1
           AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.followee_id=u.id)
           AND EXISTS (SELECT 1 FROM meals m WHERE m.author_id=u.id AND m.visibility='public' AND m.status='live')
         -- Ordered by the shrunk score, not the displayed raw best: one lucky
         -- 10/10 shouldn't outrank a chef with a shelf of well-attested 9s.
         ORDER BY (SELECT max(m.ranked_score) FROM meals m
                   WHERE m.author_id=u.id AND m.visibility='public' AND m.status='live')
                  DESC NULLS LAST,
                  meal_count DESC
         LIMIT 12",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("suggested chefs failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct ChefSearch {
    pub search: Option<String>,
}

/// Browse > Chefs. Unlike suggestions this includes people you already follow
/// and chefs who haven't published yet, so search can find anyone by name.
pub async fn search_chefs(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(p): Query<ChefSearch>,
) -> Result<Json<Vec<ChefCard>>, StatusCode> {
    let rows = sqlx::query_as::<_, ChefCard>(
        "SELECT u.id, u.display_name, u.cb_avatar_theme AS avatar_theme,
                u.cb_avatar_photo_url AS avatar_photo_url,
                (SELECT count(*) FROM meals m WHERE m.author_id=u.id AND m.visibility='public' AND m.status='live') AS meal_count,
                (SELECT m.cuisine FROM meals m WHERE m.author_id=u.id AND m.visibility='public' AND m.status='live'
                 GROUP BY m.cuisine ORDER BY count(*) DESC LIMIT 1) AS top_cuisine,
                (SELECT max(m.rating)::float8 FROM meals m WHERE m.author_id=u.id AND m.visibility='public' AND m.status='live') AS best_rating,
                EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.followee_id=u.id) AS is_following
         FROM users u
         WHERE u.id <> $1
           AND ($2::text IS NULL OR u.display_name ILIKE '%' || $2 || '%')
         ORDER BY meal_count DESC,
                  (SELECT max(m.ranked_score) FROM meals m
                   WHERE m.author_id=u.id AND m.visibility='public' AND m.status='live')
                  DESC NULLS LAST,
                  u.display_name
         LIMIT 100",
    )
    .bind(user.id)
    .bind(p.search.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("chef search failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(rows))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct LeaderboardRow {
    pub id: i64,
    pub display_name: String,
    pub avatar_theme: String,
    pub avatar_photo_url: Option<String>,
    pub tier: String,
    /// The raw count behind the tier - fine to show here (unlike the vote
    /// weight itself) since a leaderboard's whole point is a comparable
    /// number; the tier is what actually matters for how much a vote counts
    /// elsewhere, and that mapping is never exposed as a multiplier.
    pub activity: i64,
}

/// Top contributors by reviews + recipe edits + ingredient edits combined -
/// the exact three things `reputation_weight()` counts, so "why is this
/// person ranked here" always has the same answer as "why does their vote
/// count more."
pub async fn leaderboard(State(state): State<AppState>) -> Result<Json<Vec<LeaderboardRow>>, StatusCode> {
    let rows = sqlx::query_as::<_, LeaderboardRow>(
        "SELECT * FROM (
            SELECT u.id, u.display_name,
                   u.cb_avatar_theme AS avatar_theme, u.cb_avatar_photo_url AS avatar_photo_url,
                   contributor_tier(u.id) AS tier,
                   ((SELECT count(*) FROM reviews WHERE user_id=u.id) +
                    (SELECT count(*) FROM meal_revisions WHERE editor_id=u.id AND kind IN ('created','edit')) +
                    (SELECT count(*) FROM ingredient_edits WHERE author_id=u.id)) AS activity
            FROM users u
         ) ranked
         WHERE activity > 0
         ORDER BY activity DESC, display_name
         LIMIT 20",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("leaderboard query failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(rows))
}

pub async fn following(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<ChefCard>>, StatusCode> {
    let rows = sqlx::query_as::<_, ChefCard>(
        "SELECT u.id, u.display_name, u.cb_avatar_theme AS avatar_theme,
                u.cb_avatar_photo_url AS avatar_photo_url,
                (SELECT count(*) FROM meals m WHERE m.author_id=u.id AND m.visibility='public' AND m.status='live') AS meal_count,
                NULL::text AS top_cuisine, NULL::float8 AS best_rating,
                TRUE AS is_following
         FROM follows f JOIN users u ON u.id = f.followee_id
         WHERE f.follower_id = $1
         ORDER BY u.display_name",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

pub async fn toggle_follow(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if id == user.id {
        return Err(StatusCode::BAD_REQUEST);
    }
    let deleted = sqlx::query("DELETE FROM follows WHERE follower_id=$1 AND followee_id=$2")
        .bind(user.id).bind(id)
        .execute(&state.db).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected();

    if deleted == 0 {
        sqlx::query("INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING")
            .bind(user.id).bind(id)
            .execute(&state.db).await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        sqlx::query(
            "INSERT INTO notifications (recipient_id, actor_id, type) VALUES ($1,$2,'new_follower')",
        )
        .bind(id).bind(user.id).execute(&state.db).await.ok();

        crate::notify::send_notification_email(
            &state.db,
            id,
            "new_follower",
            "You have a new follower on Cookbook",
            &format!("{} started following you on Cookbook.", user.display_name),
        )
        .await;
    }

    Ok(Json(serde_json::json!({ "following": deleted == 0 })))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct FeedPost {
    pub meal_id: i64,
    pub name: String,
    pub author_id: i64,
    pub author_name: String,
    pub avatar_theme: String,
    pub avatar_photo_url: Option<String>,
    pub cuisine: String,
    pub time_minutes: i32,
    pub rating: f64,
    pub photo_url: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub liked: bool,
    pub saved: bool,
}

/// Meals published by the chefs the viewer follows, newest first.
pub async fn feed(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<FeedPost>>, StatusCode> {
    let rows = sqlx::query_as::<_, FeedPost>(
        "SELECT m.id AS meal_id, m.name, m.author_id, u.display_name AS author_name,
                u.cb_avatar_theme AS avatar_theme, u.cb_avatar_photo_url AS avatar_photo_url,
                m.cuisine, m.time_minutes, m.rating::float8 AS rating, m.photo_url, m.created_at,
                EXISTS (SELECT 1 FROM post_likes pl WHERE pl.user_id=$1 AND pl.post_type='meal' AND pl.subject_id=m.id) AS liked,
                EXISTS (SELECT 1 FROM saved_meals sm WHERE sm.user_id=$1 AND sm.meal_id=m.id) AS saved
         FROM meals m
         JOIN users u ON u.id = m.author_id
         JOIN follows f ON f.followee_id = m.author_id AND f.follower_id = $1
         WHERE m.visibility = 'public' AND m.status = 'live'
         ORDER BY m.created_at DESC
         LIMIT 100",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("feed failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(rows))
}

pub async fn toggle_like(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let deleted = sqlx::query(
        "DELETE FROM post_likes WHERE user_id=$1 AND post_type='meal' AND subject_id=$2",
    )
    .bind(user.id).bind(id)
    .execute(&state.db).await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .rows_affected();

    if deleted == 0 {
        sqlx::query(
            "INSERT INTO post_likes (user_id, post_type, subject_id) VALUES ($1,'meal',$2) ON CONFLICT DO NOTHING",
        )
        .bind(user.id).bind(id)
        .execute(&state.db).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(Json(serde_json::json!({ "liked": deleted == 0 })))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Notification {
    pub id: i64,
    pub kind: String,
    pub actor_name: Option<String>,
    pub subject_type: Option<String>,
    pub subject_id: Option<i64>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub seen: bool,
}

pub async fn activity(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<Notification>>, StatusCode> {
    let rows = sqlx::query_as::<_, Notification>(
        "SELECT n.id, n.type AS kind, u.display_name AS actor_name, n.subject_type, n.subject_id,
                n.created_at, (n.seen_at IS NOT NULL) AS seen
         FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
         WHERE n.recipient_id = $1
         ORDER BY n.created_at DESC LIMIT 100",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

pub async fn mark_activity_seen(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> StatusCode {
    match sqlx::query("UPDATE notifications SET seen_at = now() WHERE recipient_id=$1 AND seen_at IS NULL")
        .bind(user.id).execute(&state.db).await
    {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

// ---------- profile ----------

#[derive(Serialize)]
pub struct ChefProfile {
    pub id: i64,
    pub display_name: String,
    pub bio: Option<String>,
    pub cb_title: Option<String>,
    pub cb_bio: Option<String>,
    pub avatar_theme: String,
    pub avatar_photo_url: Option<String>,
    pub page_theme: String,
    pub page_photo_url: Option<String>,
    pub hero_theme: String,
    pub hero_photo_url: Option<String>,
    pub follower_count: i64,
    pub following_count: i64,
    pub is_following: bool,
    pub is_me: bool,
    /// 'novice' | 'trusted' | 'veteran' - a label for the same tier that
    /// already silently weights this person's votes (migration 0007). Never
    /// the raw weight or activity count, just the tier.
    pub contributor_tier: String,
}

pub async fn profile(
    State(state): State<AppState>,
    user: Option<CurrentUser>,
    Path(id): Path<i64>,
) -> Result<Json<ChefProfile>, StatusCode> {
    let viewer = user.map(|u| u.0.id);
    let r = sqlx::query_as::<_, (i64, String, Option<String>, Option<String>, Option<String>, String, Option<String>, String, Option<String>, String, Option<String>, i64, i64, bool, String)>(
        "SELECT u.id, u.display_name, u.bio, u.cb_title, u.cb_bio,
                u.cb_avatar_theme, u.cb_avatar_photo_url,
                u.cb_page_theme, u.cb_page_photo_url,
                u.cb_hero_theme, u.cb_hero_photo_url,
                (SELECT count(*) FROM follows WHERE followee_id=u.id),
                (SELECT count(*) FROM follows WHERE follower_id=u.id),
                EXISTS (SELECT 1 FROM follows WHERE follower_id=$2 AND followee_id=u.id),
                contributor_tier(u.id)
         FROM users u WHERE u.id = $1",
    )
    .bind(id)
    .bind(viewer)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(ChefProfile {
        id: r.0,
        display_name: r.1,
        bio: r.2,
        cb_title: r.3,
        cb_bio: r.4,
        avatar_theme: r.5,
        avatar_photo_url: r.6,
        page_theme: r.7,
        page_photo_url: r.8,
        hero_theme: r.9,
        hero_photo_url: r.10,
        follower_count: r.11,
        following_count: r.12,
        is_following: r.13,
        is_me: viewer == Some(r.0),
        contributor_tier: r.14,
    }))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ChefMeal {
    pub id: i64,
    pub name: String,
    pub cuisine: String,
    pub time_minutes: i32,
    pub rating: f64,
    pub photo_url: Option<String>,
}

/// A chef's own published recipes. Gated by their `vis_mine` setting for
/// anyone but themselves.
pub async fn chef_published(
    State(state): State<AppState>,
    viewer: Option<CurrentUser>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<ChefMeal>>, StatusCode> {
    if !can_view(&state, id, viewer, "vis_mine").await? {
        return Ok(Json(vec![]));
    }
    let rows = sqlx::query_as::<_, ChefMeal>(
        "SELECT id, name, cuisine, time_minutes, rating::float8 AS rating, photo_url
         FROM meals WHERE author_id = $1 AND visibility = 'public' AND status = 'live'
         ORDER BY created_at DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

/// Their public cooking log - meals they've cooked, whoever wrote them.
pub async fn chef_cooked(
    State(state): State<AppState>,
    viewer: Option<CurrentUser>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<ChefMeal>>, StatusCode> {
    if !can_view(&state, id, viewer, "vis_made").await? {
        return Ok(Json(vec![]));
    }
    let rows = sqlx::query_as::<_, ChefMeal>(
        "SELECT m.id, m.name, m.cuisine, m.time_minutes, m.rating::float8 AS rating, m.photo_url
         FROM meals m JOIN cooked_meals c ON c.meal_id = m.id
         WHERE c.user_id = $1 AND m.status = 'live'
         ORDER BY c.cooked_at DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ChefReview {
    pub meal_id: i64,
    pub meal_name: String,
    pub photo_url: Option<String>,
    pub score: Option<i16>,
    pub note: Option<String>,
    pub cooked_at: chrono::DateTime<chrono::Utc>,
}

/// Public reviews only - `is_public` is the reviewer's own choice per entry,
/// independent of their profile-wide visibility settings.
pub async fn chef_reviews(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<ChefReview>>, StatusCode> {
    let rows = sqlx::query_as::<_, ChefReview>(
        "SELECT r.meal_id, m.name AS meal_name, m.photo_url, r.score, r.note, r.cooked_at
         FROM reviews r JOIN meals m ON m.id = r.meal_id
         WHERE r.user_id = $1 AND r.is_public = true AND m.status = 'live'
         ORDER BY r.cooked_at DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

async fn can_view(
    state: &AppState,
    profile_id: i64,
    viewer: Option<CurrentUser>,
    column: &str,
) -> Result<bool, StatusCode> {
    if viewer.as_ref().map(|v| v.0.id) == Some(profile_id) {
        return Ok(true);
    }
    let sql = match column {
        "vis_mine" => "SELECT vis_mine FROM users WHERE id = $1",
        "vis_made" => "SELECT vis_made FROM users WHERE id = $1",
        _ => "SELECT vis_want FROM users WHERE id = $1",
    };
    let visibility: Option<String> = sqlx::query_scalar(sql)
        .bind(profile_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(visibility.as_deref() != Some("private"))
}

#[derive(Deserialize)]
pub struct UpdateProfile {
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub diet_prefs: Option<Vec<String>>,
    pub has_onboarded: Option<bool>,
    pub vis_mine: Option<String>,
    pub vis_made: Option<String>,
    pub vis_want: Option<String>,
    pub vis_fridge: Option<String>,
    pub unit_system: Option<String>,
    /// `Some(None)` isn't representable with a plain `Option<i32>` field
    /// (COALESCE below can't distinguish "not sent" from "clear it"), so a
    /// goal is set with a positive number and cleared by sending 0 - the
    /// handler below maps that to NULL rather than storing a nonsensical
    /// zero-calorie target.
    pub goal_calories: Option<i32>,
    pub goal_protein_g: Option<i32>,
    pub goal_carbs_g: Option<i32>,
    pub goal_fat_g: Option<i32>,
}

/// Every field is optional; COALESCE leaves omitted ones untouched. Used by
/// Settings and onboarding - never touches the Customize (cb_*) fields, whose
/// "clear this photo" case COALESCE can't represent (see update_customize).
pub async fn update_profile(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(b): Json<UpdateProfile>,
) -> Result<StatusCode, StatusCode> {
    sqlx::query(
        "UPDATE users SET
           display_name = COALESCE(NULLIF($2,''), display_name),
           bio = COALESCE($3, bio),
           diet_prefs = COALESCE($4, diet_prefs),
           has_onboarded = COALESCE($5, has_onboarded),
           vis_mine = COALESCE(NULLIF($6,''), vis_mine),
           vis_made = COALESCE(NULLIF($7,''), vis_made),
           vis_want = COALESCE(NULLIF($8,''), vis_want),
           vis_fridge = COALESCE(NULLIF($9,''), vis_fridge),
           unit_system = COALESCE(NULLIF($10,''), unit_system),
           goal_calories = CASE WHEN $11::int IS NULL THEN goal_calories WHEN $11 = 0 THEN NULL ELSE $11 END,
           goal_protein_g = CASE WHEN $12::int IS NULL THEN goal_protein_g WHEN $12 = 0 THEN NULL ELSE $12 END,
           goal_carbs_g = CASE WHEN $13::int IS NULL THEN goal_carbs_g WHEN $13 = 0 THEN NULL ELSE $13 END,
           goal_fat_g = CASE WHEN $14::int IS NULL THEN goal_fat_g WHEN $14 = 0 THEN NULL ELSE $14 END,
           updated_at = now()
         WHERE id = $1",
    )
    .bind(user.id)
    .bind(b.display_name.as_deref().map(str::trim))
    .bind(b.bio.as_deref())
    .bind(b.diet_prefs.as_deref())
    .bind(b.has_onboarded)
    .bind(b.vis_mine.as_deref())
    .bind(b.vis_made.as_deref())
    .bind(b.vis_want.as_deref())
    .bind(b.vis_fridge.as_deref())
    .bind(b.unit_system.as_deref())
    .bind(b.goal_calories)
    .bind(b.goal_protein_g)
    .bind(b.goal_carbs_g)
    .bind(b.goal_fat_g)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("update profile failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct UpdateCustomize {
    pub cb_title: String,
    pub cb_bio: String,
    pub cb_page_theme: String,
    pub cb_page_photo_url: Option<String>,
    pub cb_hero_theme: String,
    pub cb_hero_photo_url: Option<String>,
    pub cb_avatar_theme: String,
    pub cb_avatar_photo_url: Option<String>,
}

#[derive(Serialize)]
pub struct ProfileTheme {
    pub cb_title: Option<String>,
    pub cb_bio: Option<String>,
    pub cb_page_theme: String,
    pub cb_page_photo_url: Option<String>,
    pub cb_hero_theme: String,
    pub cb_hero_photo_url: Option<String>,
    pub cb_avatar_theme: String,
    pub cb_avatar_photo_url: Option<String>,
}

/// Small and cheap on purpose: fetched once near app root to paint the page
/// background/avatar everywhere, and reused by the Customize screen to seed
/// its form (it always resends the full state back on save - see below).
pub async fn my_theme(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<ProfileTheme>, StatusCode> {
    let row = sqlx::query_as::<_, (Option<String>, Option<String>, String, Option<String>, String, Option<String>, String, Option<String>)>(
        "SELECT cb_title, cb_bio, cb_page_theme, cb_page_photo_url,
                cb_hero_theme, cb_hero_photo_url, cb_avatar_theme, cb_avatar_photo_url
         FROM users WHERE id = $1",
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ProfileTheme {
        cb_title: row.0,
        cb_bio: row.1,
        cb_page_theme: row.2,
        cb_page_photo_url: row.3,
        cb_hero_theme: row.4,
        cb_hero_photo_url: row.5,
        cb_avatar_theme: row.6,
        cb_avatar_photo_url: row.7,
    }))
}

/// Always overwrites the full customize state (the screen loads current
/// values first, so every save carries the true state) - unlike
/// update_profile, an explicit null here really does clear a photo.
pub async fn update_customize(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(b): Json<UpdateCustomize>,
) -> Result<StatusCode, StatusCode> {
    sqlx::query(
        "UPDATE users SET
           cb_title = $2, cb_bio = $3,
           cb_page_theme = $4, cb_page_photo_url = $5,
           cb_hero_theme = $6, cb_hero_photo_url = $7,
           cb_avatar_theme = $8, cb_avatar_photo_url = $9,
           updated_at = now()
         WHERE id = $1",
    )
    .bind(user.id)
    .bind(b.cb_title.trim())
    .bind(b.cb_bio.trim())
    .bind(b.cb_page_theme)
    .bind(b.cb_page_photo_url)
    .bind(b.cb_hero_theme)
    .bind(b.cb_hero_photo_url)
    .bind(b.cb_avatar_theme)
    .bind(b.cb_avatar_photo_url)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("update customize failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(StatusCode::NO_CONTENT)
}
