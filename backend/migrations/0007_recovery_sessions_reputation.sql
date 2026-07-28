-- Account recovery, visible sessions, and reputation-weighted voting.
--
-- Three gaps this closes:
--
--   1. A user who forgets their password today has no way back in - there is
--      no reset flow at all. password_resets mirrors `sessions` exactly
--      (opaque token, only its hash stored) because it wants the identical
--      property: a database leak alone can't be replayed as a working reset.
--
--   2. Sessions were invisible and un-revocable individually - the only lever
--      was "log out" (this device) or "change password" (everywhere, as a
--      side effect). A stolen cookie could sit unnoticed for the full 30-day
--      lifetime with no way to end just that one session.
--
--   3. Every vote has counted the same regardless of who cast it. That's fair
--       by default but has no way to reward people who've actually
--       demonstrated good judgment here before - reputation, computed from
--       existing contribution counts rather than a new field to keep in sync.

-- A friendly integer alongside the opaque hash: the hash is the security
-- boundary (what's checked on every request), the id is just something a
-- "your sessions" UI can list and let a person click "revoke" on without
-- ever handling the token value itself.
ALTER TABLE sessions ADD COLUMN id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE;

-- Captured once at login/register, not updated later - a session's identity
-- shouldn't shift after the fact just because a proxy changed the header.
ALTER TABLE sessions ADD COLUMN user_agent TEXT;

CREATE TABLE password_resets (
    token_hash  BYTEA PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    -- NULL until consumed; a used token must not work twice even if it
    -- hasn't expired yet. Set instead of deleting so a second attempt on an
    -- already-used link gets "already used" rather than "not found" -
    -- the two failure modes call for different guidance to the user.
    used_at     TIMESTAMPTZ
);
CREATE INDEX password_resets_user_idx ON password_resets(user_id);

-- Mirrors login_attempts exactly, kept as its own table rather than a shared
-- generic one: the two throttle different actions with different intent
-- (guessing a password vs. spamming reset emails at someone else's address),
-- and conflating them would let one blow the other's budget.
CREATE TABLE password_reset_attempts (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email        TEXT NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_attempts_lookup_idx ON password_reset_attempts(lower(email), attempted_at DESC);

-- Reputation, computed rather than stored: a person's weight comes from
-- reviews written, edits proposed, and revisions authored - work already on
-- the record, not a new counter that could drift from it. Capped at 3x so a
-- single very active account still can't outvote three ordinary ones; floor
-- of 1x so a brand-new account's vote counts exactly as before this migration.
--
-- Deliberately not IMMUTABLE (its answer changes as new rows land) - PL/pgSQL
-- default volatility is VOLATILE, which is correct here and left unstated.
CREATE FUNCTION reputation_weight(uid BIGINT) RETURNS NUMERIC AS $$
    SELECT 1 + LEAST(FLOOR((
        (SELECT count(*) FROM reviews WHERE user_id = uid) +
        (SELECT count(*) FROM meal_revisions WHERE editor_id = uid AND kind IN ('created','edit')) +
        (SELECT count(*) FROM ingredient_edits WHERE author_id = uid)
    ) / 5), 2)
$$ LANGUAGE SQL STABLE;
