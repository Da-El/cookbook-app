use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    /// Off for local http:// dev, on in production so cookies are TLS-only.
    pub secure_cookies: bool,
}

impl AppState {
    pub async fn connect() -> anyhow::Result<Self> {
        let url = std::env::var("DATABASE_URL")?;
        let db = PgPoolOptions::new().max_connections(10).connect(&url).await?;
        let secure_cookies = std::env::var("SECURE_COOKIES")
            .map(|v| v != "false" && v != "0")
            .unwrap_or(false);
        Ok(Self { db, secure_cookies })
    }
}
