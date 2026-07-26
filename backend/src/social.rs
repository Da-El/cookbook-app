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
                (SELECT count(*) FROM meals m WHERE m.author_id=u.id AND m.visibility='public') AS meal_count,
                (SELECT m.cuisine FROM meals m WHERE m.author_id=u.id AND m.visibility='public'
                 GROUP BY m.cuisine ORDER BY count(*) DESC LIMIT 1) AS top_cuisine,
                (SELECT max(m.rating)::float8 FROM meals m WHERE m.author_id=u.id AND m.visibility='public') AS best_rating,
                FALSE AS is_following
         FROM users u
         WHERE u.id <> $1
           AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.followee_id=u.id)
           AND EXISTS (SELECT 1 FROM meals m WHERE m.author_id=u.id AND m.visibility='public')
         ORDER BY best_rating DESC NULLS LAST, meal_count DESC
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
                (SELECT count(*) FROM meals m WHERE m.author_id=u.id AND m.visibility='public') AS meal_count,
                (SELECT m.cuisine FROM meals m WHERE m.author_id=u.id AND m.visibility='public'
                 GROUP BY m.cuisine ORDER BY count(*) DESC LIMIT 1) AS top_cuisine,
                (SELECT max(m.rating)::float8 FROM meals m WHERE m.author_id=u.id AND m.visibility='public') AS best_rating,
                EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.followee_id=u.id) AS is_following
         FROM users u
         WHERE u.id <> $1
           AND ($2::text IS NULL OR u.display_name ILIKE '%' || $2 || '%')
         ORDER BY meal_count DESC, best_rating DESC NULLS LAST, u.display_name
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

pub async fn following(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<ChefCard>>, StatusCode> {
    let rows = sqlx::query_as::<_, ChefCard>(
        "SELECT u.id, u.display_name, u.cb_avatar_theme AS avatar_theme,
                u.cb_avatar_photo_url AS avatar_photo_url,
                (SELECT count(*) FROM meals m WHERE m.author_id=u.id AND m.visibility='public') AS meal_count,
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
         WHERE m.visibility = 'public'
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
}

pub async fn profile(
    State(state): State<AppState>,
    user: Option<CurrentUser>,
    Path(id): Path<i64>,
) -> Result<Json<ChefProfile>, StatusCode> {
    let viewer = user.map(|u| u.0.id);
    let r = sqlx::query_as::<_, (i64, String, Option<String>, Option<String>, Option<String>, String, Option<String>, String, Option<String>, String, Option<String>, i64, i64, bool)>(
        "SELECT u.id, u.display_name, u.bio, u.cb_title, u.cb_bio,
                u.cb_avatar_theme, u.cb_avatar_photo_url,
                u.cb_page_theme, u.cb_page_photo_url,
                u.cb_hero_theme, u.cb_hero_photo_url,
                (SELECT count(*) FROM follows WHERE followee_id=u.id),
                (SELECT count(*) FROM follows WHERE follower_id=u.id),
                EXISTS (SELECT 1 FROM follows WHERE follower_id=$2 AND followee_id=u.id)
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
    }))
}

#[derive(Deserialize)]
pub struct UpdateProfile {
    pub display_name: Option<String>,
    pub cb_title: Option<String>,
    pub cb_bio: Option<String>,
    pub cb_page_theme: Option<String>,
    pub cb_page_photo_url: Option<String>,
    pub cb_hero_theme: Option<String>,
    pub cb_hero_photo_url: Option<String>,
    pub cb_avatar_theme: Option<String>,
    pub cb_avatar_photo_url: Option<String>,
    pub diet_prefs: Option<Vec<String>>,
    pub has_onboarded: Option<bool>,
}

/// Every field is optional; COALESCE leaves omitted ones untouched.
pub async fn update_profile(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(b): Json<UpdateProfile>,
) -> Result<StatusCode, StatusCode> {
    sqlx::query(
        "UPDATE users SET
           display_name = COALESCE(NULLIF($2,''), display_name),
           cb_title = COALESCE($3, cb_title),
           cb_bio = COALESCE($4, cb_bio),
           cb_page_theme = COALESCE(NULLIF($5,''), cb_page_theme),
           cb_page_photo_url = COALESCE($6, cb_page_photo_url),
           cb_hero_theme = COALESCE(NULLIF($7,''), cb_hero_theme),
           cb_hero_photo_url = COALESCE($8, cb_hero_photo_url),
           cb_avatar_theme = COALESCE(NULLIF($9,''), cb_avatar_theme),
           cb_avatar_photo_url = COALESCE($10, cb_avatar_photo_url),
           diet_prefs = COALESCE($11, diet_prefs),
           has_onboarded = COALESCE($12, has_onboarded),
           updated_at = now()
         WHERE id = $1",
    )
    .bind(user.id)
    .bind(b.display_name.as_deref().map(str::trim))
    .bind(b.cb_title.as_deref())
    .bind(b.cb_bio.as_deref())
    .bind(b.cb_page_theme.as_deref())
    .bind(b.cb_page_photo_url.as_deref())
    .bind(b.cb_hero_theme.as_deref())
    .bind(b.cb_hero_photo_url.as_deref())
    .bind(b.cb_avatar_theme.as_deref())
    .bind(b.cb_avatar_photo_url.as_deref())
    .bind(b.diet_prefs.as_deref())
    .bind(b.has_onboarded)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("update profile failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(StatusCode::NO_CONTENT)
}
