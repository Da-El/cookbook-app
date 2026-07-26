use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{FromRequestParts, State};
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use base64::Engine;
use chrono::{Duration, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::state::AppState;

const SESSION_COOKIE: &str = "cb_session";
const SESSION_DAYS: i64 = 30;
const MAX_ATTEMPTS: i64 = 10;
const ATTEMPT_WINDOW_MINS: i64 = 15;

#[derive(Deserialize)]
pub struct Credentials {
    pub email: String,
    pub password: String,
    pub display_name: Option<String>,
}

#[derive(Serialize)]
pub struct UserProfile {
    pub id: i64,
    pub email: String,
    pub display_name: String,
    pub has_onboarded: bool,
}

pub struct CurrentUser(pub UserProfile);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_headers(&parts.headers);
        let token = jar.get(SESSION_COOKIE).ok_or(StatusCode::UNAUTHORIZED)?.value();
        let hash = hash_token(token);

        let row = sqlx::query_as::<_, (i64, Option<String>, String, bool)>(
            "SELECT u.id, u.email, u.display_name, u.has_onboarded
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = $1 AND s.expires_at > now()",
        )
        .bind(&hash)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;

        sqlx::query("UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1")
            .bind(&hash)
            .execute(&state.db)
            .await
            .ok();

        Ok(CurrentUser(UserProfile {
            id: row.0,
            email: row.1.unwrap_or_default(),
            display_name: row.2,
            has_onboarded: row.3,
        }))
    }
}

/// Lets handlers take `Option<CurrentUser>` for endpoints that work signed out
/// (e.g. browsing meals) but personalise their response when a session exists.
impl axum::extract::OptionalFromRequestParts<AppState> for CurrentUser {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Option<Self>, Self::Rejection> {
        Ok(
            <CurrentUser as FromRequestParts<AppState>>::from_request_parts(parts, state)
                .await
                .ok(),
        )
    }
}

fn hash_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn session_cookie(token: String, secure: bool) -> Cookie<'static> {
    let mut c = Cookie::new(SESSION_COOKIE, token);
    c.set_http_only(true);
    c.set_secure(secure);
    c.set_same_site(SameSite::Lax);
    c.set_path("/");
    c.set_max_age(time::Duration::days(SESSION_DAYS));
    c
}

async fn create_session(state: &AppState, user_id: i64) -> Result<String, StatusCode> {
    let token = new_token();
    let expires = Utc::now() + Duration::days(SESSION_DAYS);
    sqlx::query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)")
        .bind(hash_token(&token))
        .bind(user_id)
        .bind(expires)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("session insert failed: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(token)
}

pub async fn register(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<Credentials>,
) -> Result<(CookieJar, Json<UserProfile>), (StatusCode, Json<serde_json::Value>)> {
    let email = body.email.trim().to_lowercase();
    let display_name = body
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| email.split('@').next().unwrap_or("Chef"))
        .to_string();

    if !email.contains('@') || email.len() > 254 {
        return Err(err(StatusCode::BAD_REQUEST, "Enter a valid email address."));
    }
    if body.password.chars().count() < 8 {
        return Err(err(StatusCode::BAD_REQUEST, "Password must be at least 8 characters."));
    }

    let mut salt_bytes = [0u8; 16];
    rand::rng().fill_bytes(&mut salt_bytes);
    let salt = SaltString::encode_b64(&salt_bytes)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Could not create account."))?;
    let hash = Argon2::default()
        .hash_password(body.password.as_bytes(), &salt)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Could not create account."))?
        .to_string();

    let user_id: i64 = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(&email)
    .bind(&hash)
    .bind(&display_name)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(db) = &e {
            if db.is_unique_violation() {
                return err(StatusCode::CONFLICT, "That email is already registered.");
            }
        }
        tracing::error!("register failed: {e}");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Could not create account.")
    })?;

    let token = create_session(&state, user_id)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Could not create session."))?;

    Ok((
        jar.add(session_cookie(token, state.secure_cookies)),
        Json(UserProfile { id: user_id, email, display_name, has_onboarded: false }),
    ))
}

pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<Credentials>,
) -> Result<(CookieJar, Json<UserProfile>), (StatusCode, Json<serde_json::Value>)> {
    let email = body.email.trim().to_lowercase();

    let recent: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM login_attempts
         WHERE lower(email) = $1 AND attempted_at > now() - ($2 || ' minutes')::interval",
    )
    .bind(&email)
    .bind(ATTEMPT_WINDOW_MINS.to_string())
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if recent >= MAX_ATTEMPTS {
        return Err(err(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many sign-in attempts. Try again in a few minutes.",
        ));
    }

    let row = sqlx::query_as::<_, (i64, Option<String>, String, bool, Option<String>)>(
        "SELECT id, email, display_name, has_onboarded, password_hash FROM users WHERE lower(email) = $1",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Could not sign in."))?;

    // Same generic message whether the email is unknown or the password is wrong,
    // so this endpoint can't be used to enumerate registered accounts.
    let invalid = || err(StatusCode::UNAUTHORIZED, "Incorrect email or password.");

    let Some((id, stored_email, display_name, has_onboarded, Some(password_hash))) = row else {
        record_attempt(&state, &email).await;
        return Err(invalid());
    };

    let parsed = PasswordHash::new(&password_hash).map_err(|_| invalid())?;
    if Argon2::default().verify_password(body.password.as_bytes(), &parsed).is_err() {
        record_attempt(&state, &email).await;
        return Err(invalid());
    }

    sqlx::query("DELETE FROM login_attempts WHERE lower(email) = $1")
        .bind(&email)
        .execute(&state.db)
        .await
        .ok();

    let token = create_session(&state, id)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Could not create session."))?;

    Ok((
        jar.add(session_cookie(token, state.secure_cookies)),
        Json(UserProfile {
            id,
            email: stored_email.unwrap_or(email),
            display_name,
            has_onboarded,
        }),
    ))
}

async fn record_attempt(state: &AppState, email: &str) {
    sqlx::query("INSERT INTO login_attempts (email) VALUES ($1)")
        .bind(email)
        .execute(&state.db)
        .await
        .ok();
}

pub async fn logout(State(state): State<AppState>, jar: CookieJar) -> (CookieJar, StatusCode) {
    if let Some(c) = jar.get(SESSION_COOKIE) {
        sqlx::query("DELETE FROM sessions WHERE token_hash = $1")
            .bind(hash_token(c.value()))
            .execute(&state.db)
            .await
            .ok();
    }
    let mut removal = Cookie::from(SESSION_COOKIE);
    removal.set_path("/");
    (jar.remove(removal), StatusCode::NO_CONTENT)
}

pub async fn me(CurrentUser(user): CurrentUser) -> Json<UserProfile> {
    Json(user)
}

fn err(status: StatusCode, msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": msg })))
}
