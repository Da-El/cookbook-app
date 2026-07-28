/// Transactional email, one function every caller goes through so adding a
/// real provider later - or swapping it - is a change in one place, not at
/// every call site that wants to send something.
///
/// With no `RESEND_API_KEY` set, this logs the message instead of sending
/// it - not a stub, but the actual delivery mechanism today, the same way
/// password reset already worked before this module existed (see the
/// `forgot_password` handler's own history). Once a real key is set, the
/// exact same calls start actually delivering with no code change on the
/// caller's side.
pub async fn send(to: &str, subject: &str, body: &str) {
    let Ok(key) = std::env::var("RESEND_API_KEY") else {
        log_only(to, subject, body);
        return;
    };
    if key.is_empty() {
        log_only(to, subject, body);
        return;
    }

    let from = std::env::var("EMAIL_FROM").unwrap_or_else(|_| "Cookbook <onboarding@resend.dev>".into());
    let client = reqwest::Client::new();
    let result = client
        .post("https://api.resend.com/emails")
        .bearer_auth(&key)
        .json(&serde_json::json!({ "from": from, "to": [to], "subject": subject, "text": body }))
        .send()
        .await;

    match result {
        Ok(r) if r.status().is_success() => tracing::info!("email sent to {to}: {subject}"),
        Ok(r) => tracing::error!("email provider returned {}: could not send to {to}", r.status()),
        Err(e) => tracing::error!("email send failed: {e}"),
    }
}

fn log_only(to: &str, subject: &str, body: &str) {
    // Deliberately not behind `tracing::debug!` - see the module doc: this
    // is the entire delivery mechanism until a provider key exists, not a
    // debug aid, so it needs to survive at whatever level production
    // logging runs at.
    tracing::info!("[email, no provider configured] to {to}: {subject}\n{body}");
}

/// Best-effort absolute link to a frontend route, e.g. `/reset-password?token=...`.
/// Falls back to the bare path when `APP_URL` isn't set (local dev, or a
/// deploy that hasn't configured it yet) - still informative in the
/// log-only path above, just not a clickable link in a real email body.
pub fn app_url(path: &str) -> String {
    match std::env::var("APP_URL") {
        Ok(base) if !base.is_empty() => format!("{}{}", base.trim_end_matches('/'), path),
        _ => path.to_string(),
    }
}
