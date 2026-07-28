use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    /// Off for local http:// dev, on in production so cookies are TLS-only.
    pub secure_cookies: bool,
    /// The built frontend's `index.html`, loaded once at startup when a
    /// static build is present (production only - local dev serves the
    /// frontend from Vite, not this backend). `og::` handlers splice
    /// page-specific meta tags into a copy of it per request; `None` means
    /// there's nothing to splice into, so those routes just aren't wired up.
    pub index_template: Option<std::sync::Arc<String>>,
}

impl AppState {
    pub async fn connect() -> anyhow::Result<Self> {
        let url = std::env::var("DATABASE_URL")?;
        let db = PgPoolOptions::new().max_connections(10).connect(&url).await?;
        let secure_cookies = std::env::var("SECURE_COOKIES")
            .map(|v| v != "false" && v != "0")
            .unwrap_or(false);
        Ok(Self { db, secure_cookies, index_template: None })
    }
}
