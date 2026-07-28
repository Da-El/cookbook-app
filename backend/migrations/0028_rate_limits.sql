-- Iteration 33: a generic per-user rate limiter, the same "count recent
-- rows" shape the login-attempts limiter already used, just not specific
-- to login. Applied to text-content-creating endpoints (review replies,
-- guide comments, flags) where spam is the actual risk - a vote toggle
-- has nowhere near the same abuse surface as free text does.
CREATE TABLE rate_limit_events (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rate_limit_events_lookup_idx ON rate_limit_events(user_id, action, created_at);
