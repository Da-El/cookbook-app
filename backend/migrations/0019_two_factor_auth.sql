-- Iteration 18: opt-in two-factor auth via an emailed code - the first
-- real second use of the email abstraction from Iteration 15, proving it
-- out beyond password reset. A password alone only proves someone knew a
-- secret; a second, time-boxed code proves they also currently control the
-- account's inbox.
ALTER TABLE users ADD COLUMN two_factor_enabled BOOLEAN NOT NULL DEFAULT false;

-- One row per in-flight login challenge. `challenge_hash` is what the
-- client holds onto between "password verified, code sent" and "code
-- submitted" - like a password reset token, the raw value is only ever
-- returned to the client, never stored. `attempts` caps brute-forcing a
-- 6-digit code (only a million possibilities) before the challenge dies
-- and a fresh login is required.
CREATE TABLE two_factor_codes (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge_hash BYTEA NOT NULL UNIQUE,
    code_hash      BYTEA NOT NULL,
    attempts       SMALLINT NOT NULL DEFAULT 0,
    expires_at     TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX two_factor_codes_challenge_idx ON two_factor_codes(challenge_hash);
