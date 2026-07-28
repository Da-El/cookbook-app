-- Iteration 26: ingredients have had a `rating`/`rating_count` column since
-- the original schema, and `upsert_rating()` already branches on
-- subject_type = 'ingredient' - but nothing has ever actually called it for
-- one. This is the missing other half: a rating action, plus an optional
-- note that turns it into a real review, mirroring how meals combine a
-- score and a note in one action (`cook()`) rather than two separate systems.
--
-- One row per (user, ingredient) rather than accumulating over time like
-- meal reviews do - there's no repeatable "cooked it again" moment for an
-- ingredient to timestamp, so a second submission is an edit to the first
-- opinion, not a new one.
CREATE TABLE ingredient_reviews (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    score         SMALLINT CHECK (score BETWEEN 1 AND 10),
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at     TIMESTAMPTZ,
    helpful_count INT NOT NULL DEFAULT 0,
    UNIQUE (user_id, ingredient_id)
);
CREATE INDEX ingredient_reviews_ingredient_idx ON ingredient_reviews(ingredient_id, helpful_count DESC);

CREATE TABLE ingredient_review_votes (
    user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    review_id BIGINT NOT NULL REFERENCES ingredient_reviews(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, review_id)
);
