-- Guides have been static since they were first seeded: no search, no
-- voting, no way for a reader to fix a stale line without filing an issue
-- somewhere nobody reads. For an app whose stated goal is being "the
-- greatest... food educational place on the web," the educational half had
-- gotten none of the community machinery the recipes and ingredients have
-- had for five iterations. This closes that gap using the same two
-- mechanisms already trusted elsewhere rather than inventing new ones:
-- tsvector search (meals, ingredients) and propose-vote-materialize editing
-- (ingredient_edits' `description` field is the closest shape - one canonical
-- body, alternatives proposed and voted, highest vote wins).

ALTER TABLE guides ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english'::regconfig, title), 'A') ||
        setweight(to_tsvector('english'::regconfig, topic), 'B') ||
        setweight(to_tsvector('english'::regconfig, summary), 'B') ||
        setweight(to_tsvector('english'::regconfig, body), 'C')
    ) STORED;
CREATE INDEX guides_search_idx ON guides USING GIN(search_vector);

-- Helpfulness voting - identical shape to review_votes/reviews.helpful_count
-- (migration 0008): undirected, toggle-only, "this helped me" or nothing.
ALTER TABLE guides ADD COLUMN helpful_count INTEGER NOT NULL DEFAULT 0;
CREATE TABLE guide_votes (
    guide_id   BIGINT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guide_id, user_id)
);

-- Community edits to a guide's body - same propose/vote/materialize shape as
-- ingredient_edits, deliberately not reusing that table: it's keyed to
-- ingredient_id with a fixed field CHECK, and a guide isn't an ingredient.
-- Title/summary/topic stay curator-only (structural, not content); body is
-- the actual teaching, which is exactly what benefits from more eyes on it.
CREATE TABLE guide_edits (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guide_id    BIGINT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    author_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT,
    votes       INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guide_edits_lookup_idx ON guide_edits(guide_id);

CREATE TABLE guide_edit_votes (
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    edit_id    BIGINT NOT NULL REFERENCES guide_edits(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, edit_id)
);
