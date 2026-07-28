-- "No X? try Y" - community-proposed substitutions between two different
-- ingredients. Deliberately not the same table as aliases (migration 0006):
-- an alias is a second name for the SAME thing ("cilantro" = "Coriander,
-- leaves, raw"); a substitute is a DIFFERENT ingredient that stands in for
-- it, which is a directed edge between two catalog rows, not a name.
--
-- Directional votes (like alias_votes and revision_votes), not undirected
-- (like edit_votes/review_votes/guide_votes): "that doesn't actually work as
-- a substitute" is a distinct, useful signal from "no opinion," and without
-- it a bad substitution can only ever be ignored, never corrected.

CREATE TABLE ingredient_substitutes (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ingredient_id  BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    substitute_id  BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    -- "use half as much", "works in baking, not frying" - the part a bare
    -- name-to-name link can't carry, and often the part that matters most.
    note           TEXT,
    author_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    author_name    TEXT,
    score          INTEGER NOT NULL DEFAULT 0,
    vote_count     INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','withdrawn')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ingredient_id <> substitute_id)
);
-- One proposal per (ingredient, substitute) pair - resubmitting an existing
-- one is a vote for it, same reasoning as ingredient_aliases_unique_idx.
CREATE UNIQUE INDEX ingredient_substitutes_unique_idx
    ON ingredient_substitutes(ingredient_id, substitute_id);
CREATE INDEX ingredient_substitutes_lookup_idx
    ON ingredient_substitutes(ingredient_id) WHERE status = 'live';

CREATE TABLE substitute_votes (
    substitute_id BIGINT NOT NULL REFERENCES ingredient_substitutes(id) ON DELETE CASCADE,
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value         SMALLINT NOT NULL CHECK (value IN (-1, 1)),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (substitute_id, user_id)
);
