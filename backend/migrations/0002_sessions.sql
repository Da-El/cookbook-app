-- Server-side sessions. The cookie carries an opaque random id; only its SHA-256
-- hash is stored, so a database leak alone can't be replayed as a valid session.
CREATE TABLE sessions (
    token_hash   BYTEA PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

-- Throttles credential stuffing: one row per (email, ip) attempt window.
CREATE TABLE login_attempts (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email       TEXT NOT NULL,
    ip          TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_lookup_idx ON login_attempts(lower(email), attempted_at DESC);
