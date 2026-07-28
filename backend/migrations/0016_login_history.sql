-- Iteration 15: a durable sign-in history, so a person can look at
-- Settings and answer "was that actually me" about a login on their
-- account. Deliberately a separate table from `login_attempts`, which is
-- purely a rate-limit counter that gets wiped on every successful login
-- (migration 0002) - reusing it here would erase the very history this
-- table exists to keep. Only attempts against a real, known account are
-- recorded; a failed attempt against an email nobody's registered isn't
-- attributable to anyone's history to show it in.
CREATE TABLE login_history (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    success      BOOLEAN NOT NULL,
    ip           TEXT,
    user_agent   TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_history_user_idx ON login_history(user_id, attempted_at DESC);
