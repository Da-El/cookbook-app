-- Helpfulness voting on reviews - the last of the five systems (rating,
-- voting, ranking, reviews, editing) that hadn't gotten its own vote type
-- yet. A recipe with twenty reviews needs a way to surface the useful ones
-- first instead of just newest-first.
--
-- Undirected, like `edit_votes`, not directional like `revision_votes`: a
-- review isn't right-or-wrong the way an edit is, so there's no "unhelpful"
-- vote to cast, only "this helped me" or nothing.

CREATE TABLE review_votes (
    review_id  BIGINT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (review_id, user_id)
);

ALTER TABLE reviews ADD COLUMN helpful_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX reviews_helpful_idx ON reviews(meal_id, helpful_count DESC);
