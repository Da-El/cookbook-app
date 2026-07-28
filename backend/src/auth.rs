use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{FromRequestParts, Path, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use rand::{Rng, RngExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::state::AppState;

const SESSION_COOKIE: &str = "cb_session";
const SESSION_DAYS: i64 = 30;
const MAX_ATTEMPTS: i64 = 10;
const ATTEMPT_WINDOW_MINS: i64 = 15;
const RESET_TOKEN_HOURS: i64 = 1;
const MAX_RESET_ATTEMPTS: i64 = 5;
const RESET_ATTEMPT_WINDOW_MINS: i64 = 60;
const TWO_FACTOR_CODE_MINUTES: i64 = 10;
const TWO_FACTOR_MAX_ATTEMPTS: i16 = 5;

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
    pub is_admin: bool,
}

pub struct CurrentUser(pub UserProfile);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_headers(&parts.headers);
        let token = jar.get(SESSION_COOKIE).ok_or(StatusCode::UNAUTHORIZED)?.value();
        let hash = hash_token(token);

        let row = sqlx::query_as::<_, (i64, Option<String>, String, bool, bool)>(
            "SELECT u.id, u.email, u.display_name, u.has_onboarded, u.is_admin
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
            is_admin: row.4,
        }))
    }
}

/// Like `CurrentUser`, but rejects with 403 unless the account is an admin.
/// A separate extractor rather than an `if !user.is_admin` check inlined in
/// every moderation handler, so "this route is admin-only" is visible in its
/// signature and can't be forgotten.
pub struct AdminUser(pub UserProfile);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let CurrentUser(user) = CurrentUser::from_request_parts(parts, state).await?;
        if !user.is_admin {
            return Err(StatusCode::FORBIDDEN);
        }
        Ok(AdminUser(user))
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

/// Truncated hard: this is a "which device is this" hint for a person
/// reviewing their own session list, not a stored analytics field, so it
/// doesn't need (and shouldn't keep) more than that.
fn user_agent_of(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.chars().take(200).collect())
}

/// Render sits behind a proxy, so the real client address (what a user
/// would recognize as "was this me") is in the forwarded-for header, not
/// the TCP peer address axum would otherwise see - `X-Forwarded-For` can
/// carry a chain of proxies, so only the first (closest-to-client) entry
/// is the one that matters here.
fn client_ip(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

async fn create_session(state: &AppState, user_id: i64, user_agent: Option<&str>) -> Result<String, StatusCode> {
    let token = new_token();
    let expires = Utc::now() + Duration::days(SESSION_DAYS);
    sqlx::query(
        "INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)",
    )
    .bind(hash_token(&token))
    .bind(user_id)
    .bind(expires)
    .bind(user_agent)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("session insert failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(token)
}

/// Collapses a raw User-Agent string to something a person recognizes at a
/// glance ("Chrome on Windows") instead of the full unreadable header. Best
/// effort, not a real UA parser - covers the common cases and falls back to
/// "a device" rather than guessing wrong.
fn friendly_device(ua: Option<&str>) -> String {
    let Some(ua) = ua else { return "Unknown device".into() };
    let browser = if ua.contains("Edg/") {
        "Edge"
    } else if ua.contains("OPR/") || ua.contains("Opera") {
        "Opera"
    } else if ua.contains("Chrome/") {
        "Chrome"
    } else if ua.contains("CriOS") {
        "Chrome"
    } else if ua.contains("Firefox/") {
        "Firefox"
    } else if ua.contains("Safari/") {
        "Safari"
    } else {
        "a browser"
    };
    let os = if ua.contains("iPhone") || ua.contains("iPad") {
        "iOS"
    } else if ua.contains("Android") {
        "Android"
    } else if ua.contains("Mac OS X") || ua.contains("Macintosh") {
        "Mac"
    } else if ua.contains("Windows") {
        "Windows"
    } else if ua.contains("Linux") {
        "Linux"
    } else {
        "an unknown OS"
    };
    format!("{browser} on {os}")
}

pub async fn register(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
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

    let token = create_session(&state, user_id, user_agent_of(&headers).as_deref())
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Could not create session."))?;

    Ok((
        jar.add(session_cookie(token, state.secure_cookies)),
        // A brand-new registration is never an admin - that flag is only
        // ever set by hand (migration 0012) for the one trusted account.
        Json(UserProfile { id: user_id, email, display_name, has_onboarded: false, is_admin: false }),
    ))
}

pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(body): Json<Credentials>,
) -> Result<(CookieJar, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
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

    let row = sqlx::query_as::<_, (i64, Option<String>, String, bool, bool, bool, Option<String>)>(
        "SELECT id, email, display_name, has_onboarded, is_admin, two_factor_enabled, password_hash
         FROM users WHERE lower(email) = $1",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Could not sign in."))?;

    // Same generic message whether the email is unknown or the password is wrong,
    // so this endpoint can't be used to enumerate registered accounts.
    let invalid = || err(StatusCode::UNAUTHORIZED, "Incorrect email or password.");

    let Some((id, stored_email, display_name, has_onboarded, is_admin, two_factor_enabled, Some(password_hash))) = row
    else {
        record_attempt(&state, &email).await;
        return Err(invalid());
    };

    let parsed = PasswordHash::new(&password_hash).map_err(|_| invalid())?;
    if Argon2::default().verify_password(body.password.as_bytes(), &parsed).is_err() {
        record_attempt(&state, &email).await;
        record_history(&state, id, false, &headers).await;
        return Err(invalid());
    }

    sqlx::query("DELETE FROM login_attempts WHERE lower(email) = $1")
        .bind(&email)
        .execute(&state.db)
        .await
        .ok();
    // The password was correct either way - that's the meaningful "was this
    // you" signal for the account's own history, independent of whether a
    // second factor is also required below.
    record_history(&state, id, true, &headers).await;

    let resolved_email = stored_email.unwrap_or(email);

    if two_factor_enabled {
        let challenge = new_token();
        let code = new_two_factor_code();
        let expires = Utc::now() + Duration::minutes(TWO_FACTOR_CODE_MINUTES);

        sqlx::query(
            "INSERT INTO two_factor_codes (user_id, challenge_hash, code_hash, expires_at) VALUES ($1,$2,$3,$4)",
        )
        .bind(id)
        .bind(hash_token(&challenge))
        .bind(hash_token(&code))
        .bind(expires)
        .execute(&state.db)
        .await
        .map_err(|_| oops())?;

        crate::email::send(
            &resolved_email,
            "Your Cookbook sign-in code",
            &format!(
                "Your code is {code}\n\n\
                 It expires in {TWO_FACTOR_CODE_MINUTES} minutes. If you didn't just try to sign in, \
                 you can ignore this - your account is still safe."
            ),
        )
        .await;

        return Ok((
            jar,
            Json(serde_json::json!({ "two_factor_required": true, "challenge": challenge })),
        ));
    }

    let token = create_session(&state, id, user_agent_of(&headers).as_deref())
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Could not create session."))?;

    Ok((
        jar.add(session_cookie(token, state.secure_cookies)),
        Json(
            serde_json::to_value(UserProfile { id, email: resolved_email, display_name, has_onboarded, is_admin })
                .unwrap(),
        ),
    ))
}

#[derive(Deserialize)]
pub struct TwoFactorVerify {
    pub challenge: String,
    pub code: String,
}

/// The second step of a 2FA login: exchanges a challenge + the emailed code
/// for the same cookie+profile response a normal `login` would have given
/// directly. Wrong code just increments `attempts` on the same challenge
/// row rather than failing it outright - a mistyped digit shouldn't force
/// starting over from the password - but once `attempts` hits the cap the
/// challenge is spent regardless, so brute-forcing the 6-digit space isn't
/// viable within one challenge's lifetime.
pub async fn verify_two_factor(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(body): Json<TwoFactorVerify>,
) -> Result<(CookieJar, Json<UserProfile>), (StatusCode, Json<serde_json::Value>)> {
    let invalid = || err(StatusCode::UNAUTHORIZED, "That code isn't right. Check your email and try again.");

    let row: Option<(i64, i64, Vec<u8>, i16, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, user_id, code_hash, attempts, expires_at
         FROM two_factor_codes WHERE challenge_hash = $1",
    )
    .bind(hash_token(&body.challenge))
    .fetch_optional(&state.db)
    .await
    .map_err(|_| oops())?;

    let Some((row_id, user_id, code_hash, attempts, expires_at)) = row else {
        return Err(invalid());
    };

    if expires_at < Utc::now() || attempts >= TWO_FACTOR_MAX_ATTEMPTS {
        sqlx::query("DELETE FROM two_factor_codes WHERE id = $1").bind(row_id).execute(&state.db).await.ok();
        return Err(err(StatusCode::BAD_REQUEST, "That code has expired. Sign in again to get a new one."));
    }

    if hash_token(body.code.trim()) != code_hash {
        sqlx::query("UPDATE two_factor_codes SET attempts = attempts + 1 WHERE id = $1")
            .bind(row_id)
            .execute(&state.db)
            .await
            .ok();
        return Err(invalid());
    }

    sqlx::query("DELETE FROM two_factor_codes WHERE id = $1").bind(row_id).execute(&state.db).await.ok();

    let profile = sqlx::query_as::<_, (i64, Option<String>, String, bool, bool)>(
        "SELECT id, email, display_name, has_onboarded, is_admin FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| oops())?;

    let token = create_session(&state, user_id, user_agent_of(&headers).as_deref())
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Could not create session."))?;

    Ok((
        jar.add(session_cookie(token, state.secure_cookies)),
        Json(UserProfile {
            id: profile.0,
            email: profile.1.unwrap_or_default(),
            display_name: profile.2,
            has_onboarded: profile.3,
            is_admin: profile.4,
        }),
    ))
}

pub async fn enable_two_factor(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> StatusCode {
    match sqlx::query("UPDATE users SET two_factor_enabled = true WHERE id = $1")
        .bind(user.id)
        .execute(&state.db)
        .await
    {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

pub async fn disable_two_factor(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> StatusCode {
    match sqlx::query("UPDATE users SET two_factor_enabled = false WHERE id = $1")
        .bind(user.id)
        .execute(&state.db)
        .await
    {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

fn new_two_factor_code() -> String {
    format!("{:06}", rand::rng().random_range(0..1_000_000u32))
}

async fn record_attempt(state: &AppState, email: &str) {
    sqlx::query("INSERT INTO login_attempts (email) VALUES ($1)")
        .bind(email)
        .execute(&state.db)
        .await
        .ok();
}

/// Durable record for the account's own "recent sign-in activity" list -
/// separate from `record_attempt`'s rate-limit counter, which gets cleared
/// on every success and would erase this history if reused for it.
async fn record_history(state: &AppState, user_id: i64, success: bool, headers: &HeaderMap) {
    sqlx::query(
        "INSERT INTO login_history (user_id, success, ip, user_agent) VALUES ($1,$2,$3,$4)",
    )
    .bind(user_id)
    .bind(success)
    .bind(client_ip(headers))
    .bind(user_agent_of(headers))
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

#[derive(Serialize)]
pub struct SettingsProfile {
    pub display_name: String,
    pub email: String,
    pub bio: Option<String>,
    pub diet_prefs: Vec<String>,
    pub vis_mine: String,
    pub vis_made: String,
    pub vis_want: String,
    pub vis_fridge: String,
    pub vis_plan: String,
    pub two_factor_enabled: bool,
    pub unit_system: String,
    pub goal_calories: Option<i32>,
    pub goal_protein_g: Option<i32>,
    pub goal_carbs_g: Option<i32>,
    pub goal_fat_g: Option<i32>,
}

pub async fn settings(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<SettingsProfile>, StatusCode> {
    #[allow(clippy::type_complexity)]
    let row = sqlx::query_as::<_, (String, Option<String>, Option<String>, Vec<String>, String, String, String, String, bool, String, Option<i32>, Option<i32>, Option<i32>, Option<i32>, String)>(
        "SELECT display_name, email, bio, diet_prefs, vis_mine, vis_made, vis_want, vis_fridge, two_factor_enabled, unit_system,
                goal_calories, goal_protein_g, goal_carbs_g, goal_fat_g, vis_plan
         FROM users WHERE id = $1",
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(SettingsProfile {
        display_name: row.0,
        email: row.1.unwrap_or_default(),
        bio: row.2,
        diet_prefs: row.3,
        vis_mine: row.4,
        vis_made: row.5,
        vis_want: row.6,
        vis_fridge: row.7,
        two_factor_enabled: row.8,
        unit_system: row.9,
        goal_calories: row.10,
        goal_protein_g: row.11,
        goal_carbs_g: row.12,
        goal_fat_g: row.13,
        vis_plan: row.14,
    }))
}

#[derive(Deserialize)]
pub struct AccountUpdate {
    pub email: Option<String>,
    pub current_password: Option<String>,
    pub new_password: Option<String>,
}

/// Email and password changes both require the current password, since either
/// one is enough to take over the account if a session cookie ever leaks.
pub async fn update_account(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<AccountUpdate>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let wants_email = body.email.as_deref().map(str::trim).filter(|e| !e.is_empty());
    let wants_password = body.new_password.as_deref().filter(|p| !p.is_empty());

    if wants_email.is_none() && wants_password.is_none() {
        return Ok(StatusCode::NO_CONTENT);
    }

    let stored_hash: Option<String> =
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
            .bind(user.id)
            .fetch_one(&state.db)
            .await
            .map_err(|_| oops())?;

    if let Some(hash) = &stored_hash {
        let current = body.current_password.as_deref().unwrap_or("");
        let parsed = PasswordHash::new(hash).map_err(|_| oops())?;
        if Argon2::default().verify_password(current.as_bytes(), &parsed).is_err() {
            return Err(err(StatusCode::UNAUTHORIZED, "That password isn't right."));
        }
    }

    if let Some(email) = wants_email {
        if !email.contains('@') {
            return Err(err(StatusCode::BAD_REQUEST, "Enter a valid email address."));
        }
        sqlx::query("UPDATE users SET email = $1, updated_at = now() WHERE id = $2")
            .bind(email.to_lowercase())
            .bind(user.id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                if let sqlx::Error::Database(db) = &e {
                    if db.is_unique_violation() {
                        return err(StatusCode::CONFLICT, "That email is already in use.");
                    }
                }
                oops()
            })?;
    }

    if let Some(new_password) = wants_password {
        if new_password.chars().count() < 8 {
            return Err(err(StatusCode::BAD_REQUEST, "New password must be at least 8 characters."));
        }
        let mut salt_bytes = [0u8; 16];
        rand::rng().fill_bytes(&mut salt_bytes);
        let salt = SaltString::encode_b64(&salt_bytes).map_err(|_| oops())?;
        let hash = Argon2::default()
            .hash_password(new_password.as_bytes(), &salt)
            .map_err(|_| oops())?
            .to_string();
        sqlx::query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2")
            .bind(hash)
            .bind(user.id)
            .execute(&state.db)
            .await
            .map_err(|_| oops())?;
        // Changing the password invalidates every other session.
        sqlx::query("DELETE FROM sessions WHERE user_id = $1").bind(user.id).execute(&state.db).await.ok();
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_account(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), StatusCode> {
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user.id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("delete account failed: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    let mut removal = Cookie::from(SESSION_COOKIE);
    removal.set_path("/");
    Ok((jar.remove(removal), StatusCode::NO_CONTENT))
}

// ============ ACCOUNT RECOVERY ============

#[derive(Deserialize)]
pub struct ForgotPasswordBody {
    pub email: String,
}

/// Always answers the same way regardless of whether the email is registered
/// - the alternative (404 for unknown, 200 for known) turns this endpoint
/// into an account-existence oracle, the same reasoning `login`'s generic
/// "incorrect email or password" already applies.
///
/// There is no outbound email sending wired up yet (see backend README /
/// deployment notes), so the generated link is written to the server log
/// rather than delivered. That makes this endpoint's real behavior today
/// "a site operator can look up the link and pass it along by hand," not
/// self-service recovery - true self-service needs a mail provider added,
/// which is a deliberate follow-up rather than something to guess at here.
pub async fn forgot_password(
    State(state): State<AppState>,
    Json(body): Json<ForgotPasswordBody>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let email = body.email.trim().to_lowercase();
    if email.is_empty() {
        return Ok(StatusCode::NO_CONTENT);
    }

    let recent: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM password_reset_attempts
         WHERE lower(email) = $1 AND attempted_at > now() - ($2 || ' minutes')::interval",
    )
    .bind(&email)
    .bind(RESET_ATTEMPT_WINDOW_MINS.to_string())
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    sqlx::query("INSERT INTO password_reset_attempts (email) VALUES ($1)")
        .bind(&email)
        .execute(&state.db)
        .await
        .ok();

    if recent >= MAX_RESET_ATTEMPTS {
        // Still 204: a 429 here would confirm "yes, someone keeps requesting
        // resets for this address," which leaks the same thing enumeration
        // does. The throttle just stops issuing new tokens silently.
        return Ok(StatusCode::NO_CONTENT);
    }

    // password_hash IS NULL for unclaimed seed "chef" accounts that authored
    // content but were never actually registered - there's no password to
    // reset, so no token is issued, same as the unknown-email case.
    let user_id: Option<i64> =
        sqlx::query_scalar("SELECT id FROM users WHERE lower(email) = $1 AND password_hash IS NOT NULL")
            .bind(&email)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);

    if let Some(user_id) = user_id {
        let token = new_token();
        let expires = Utc::now() + Duration::hours(RESET_TOKEN_HOURS);
        let inserted = sqlx::query(
            "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
        )
        .bind(hash_token(&token))
        .bind(user_id)
        .bind(expires)
        .execute(&state.db)
        .await;

        if inserted.is_ok() {
            let link = crate::email::app_url(&format!("/reset-password?token={token}"));
            crate::email::send(
                &email,
                "Reset your Cookbook password",
                &format!(
                    "Reset your password: {link}\n\n\
                     This link expires in {RESET_TOKEN_HOURS} hour(s). If you didn't request this, \
                     you can safely ignore this message - your password hasn't been changed."
                ),
            )
            .await;
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct ResetPasswordBody {
    pub token: String,
    pub new_password: String,
}

pub async fn reset_password(
    State(state): State<AppState>,
    Json(body): Json<ResetPasswordBody>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    if body.new_password.chars().count() < 8 {
        return Err(err(StatusCode::BAD_REQUEST, "Password must be at least 8 characters."));
    }

    let hash = hash_token(&body.token);
    let row: Option<(i64, DateTime<Utc>, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = $1",
    )
    .bind(&hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| oops())?;

    let Some((user_id, expires_at, used_at)) = row else {
        return Err(err(StatusCode::BAD_REQUEST, "That reset link isn't valid. Request a new one."));
    };
    if used_at.is_some() {
        return Err(err(StatusCode::BAD_REQUEST, "That reset link has already been used. Request a new one."));
    }
    if expires_at < Utc::now() {
        return Err(err(StatusCode::BAD_REQUEST, "That reset link has expired. Request a new one."));
    }

    let mut salt_bytes = [0u8; 16];
    rand::rng().fill_bytes(&mut salt_bytes);
    let salt = SaltString::encode_b64(&salt_bytes).map_err(|_| oops())?;
    let new_hash = Argon2::default()
        .hash_password(body.new_password.as_bytes(), &salt)
        .map_err(|_| oops())?
        .to_string();

    let mut tx = state.db.begin().await.map_err(|_| oops())?;
    sqlx::query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2")
        .bind(&new_hash)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| oops())?;
    sqlx::query("UPDATE password_resets SET used_at = now() WHERE token_hash = $1")
        .bind(&hash)
        .execute(&mut *tx)
        .await
        .map_err(|_| oops())?;
    // A reset means "I might not be the only one with access to this
    // account" - every existing session, not just the ones on this device,
    // needs to stop working. Same rule `update_account`'s password branch
    // already follows for a self-service change.
    sqlx::query("DELETE FROM sessions WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .ok();
    tx.commit().await.map_err(|_| oops())?;

    Ok(StatusCode::NO_CONTENT)
}

// ============ SESSIONS ============

#[derive(Serialize, sqlx::FromRow)]
pub struct SessionRow {
    pub id: i64,
    pub device: String,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub is_current: bool,
}

#[derive(Serialize)]
pub struct LoginHistoryRow {
    pub id: i64,
    pub device: String,
    pub ip: Option<String>,
    pub success: bool,
    pub attempted_at: DateTime<Utc>,
}

/// The account-security half of "recent activity": every login attempt
/// against this specific account, successes and failures both - separate
/// from `list_sessions`, which only shows sessions currently live, not
/// attempts that never got that far or that have long since expired.
pub async fn login_history(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<LoginHistoryRow>>, StatusCode> {
    let rows: Vec<(i64, Option<String>, Option<String>, bool, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, user_agent, ip, success, attempted_at
         FROM login_history WHERE user_id = $1
         ORDER BY attempted_at DESC LIMIT 20",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(
        rows.into_iter()
            .map(|(id, ua, ip, success, attempted_at)| LoginHistoryRow {
                id,
                device: friendly_device(ua.as_deref()),
                ip,
                success,
                attempted_at,
            })
            .collect(),
    ))
}

pub async fn list_sessions(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    jar: CookieJar,
) -> Result<Json<Vec<SessionRow>>, StatusCode> {
    let current_hash = jar.get(SESSION_COOKIE).map(|c| hash_token(c.value()));

    let rows: Vec<(i64, Option<String>, DateTime<Utc>, DateTime<Utc>, Vec<u8>)> = sqlx::query_as(
        "SELECT id, user_agent, created_at, last_seen_at, token_hash
         FROM sessions WHERE user_id = $1 AND expires_at > now()
         ORDER BY last_seen_at DESC",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(
        rows.into_iter()
            .map(|(id, ua, created_at, last_seen_at, hash)| SessionRow {
                id,
                device: friendly_device(ua.as_deref()),
                created_at,
                last_seen_at,
                is_current: current_hash.as_deref() == Some(hash.as_slice()),
            })
            .collect(),
    ))
}

/// Revoking the session you're revoking *from* is just logout - handled the
/// same way here so the client doesn't need special-case branching, but the
/// cookie only gets cleared when that's actually what happened.
pub async fn revoke_session(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    jar: CookieJar,
    Path(session_id): Path<i64>,
) -> Result<(CookieJar, StatusCode), StatusCode> {
    let target_hash: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT token_hash FROM sessions WHERE id = $1 AND user_id = $2")
            .bind(session_id)
            .bind(user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let Some(target_hash) = target_hash else { return Err(StatusCode::NOT_FOUND) };

    sqlx::query("DELETE FROM sessions WHERE id = $1")
        .bind(session_id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let current_hash = jar.get(SESSION_COOKIE).map(|c| hash_token(c.value()));
    if current_hash.as_deref() == Some(target_hash.as_slice()) {
        let mut removal = Cookie::from(SESSION_COOKIE);
        removal.set_path("/");
        return Ok((jar.remove(removal), StatusCode::NO_CONTENT));
    }
    Ok((jar, StatusCode::NO_CONTENT))
}

/// "Log out everywhere else" - keeps the caller's own session alive so
/// they're not immediately locked out of the device they're using to manage
/// sessions from.
pub async fn revoke_other_sessions(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    jar: CookieJar,
) -> Result<StatusCode, StatusCode> {
    let current_hash = jar.get(SESSION_COOKIE).map(|c| hash_token(c.value()));

    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND token_hash IS DISTINCT FROM $2")
        .bind(user.id)
        .bind(current_hash)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::NO_CONTENT)
}

fn oops() -> (StatusCode, Json<serde_json::Value>) {
    err(StatusCode::INTERNAL_SERVER_ERROR, "Something went wrong.")
}

fn err(status: StatusCode, msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": msg })))
}
