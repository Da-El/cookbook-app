-- A flagging + moderation layer, closing a gap every community system built
-- since iteration 1 has shared: votes let bad content get out-voted, but
-- nothing lets a person say "this needs a human to look at it" before that
-- happens, and nothing lets a human act once they do.
--
-- Polymorphic by design (`content_type` + `content_id`) rather than one
-- table per flaggable thing: there are already six kinds of community
-- content (meal revisions, reviews, ingredient edits, diet-flag edits,
-- aliases, substitutes, guide edits) and a seventh will show up eventually -
-- a shared flags table means the next one doesn't need its own migration.

ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- The account this project has been built and deployed under (see the
-- session's own userEmail) - a small app's moderation needs one trusted
-- person before it needs a role system, and this is who that is here.
UPDATE users SET is_admin = TRUE WHERE lower(email) = 'daelevator26@gmail.com';

CREATE TABLE content_flags (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_type TEXT NOT NULL CHECK (content_type IN
        ('meal_revision', 'review', 'ingredient_edit', 'alias', 'substitute', 'guide_edit')),
    content_id   BIGINT NOT NULL,
    reason       TEXT NOT NULL,
    flagged_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    flagged_by_name TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Resolved rather than deleted once handled - a flag is itself a record
    -- of a moderation decision, and deleting it would erase why something
    -- was removed (or why it wasn't).
    resolved     BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    resolution   TEXT CHECK (resolution IN ('removed', 'dismissed')),
    resolved_at  TIMESTAMPTZ
);
CREATE INDEX content_flags_pending_idx ON content_flags(created_at) WHERE resolved = FALSE;
-- One open flag per person per item - repeated flagging of the same thing
-- doesn't increase priority, it just clutters the queue.
CREATE UNIQUE INDEX content_flags_one_open_idx
    ON content_flags(content_type, content_id, flagged_by) WHERE resolved = FALSE;
