-- Iteration 66: collections have had cover photos, following, and reordering
-- since Batches 12-13, but no way for a viewer to say something about one -
-- the same gap guide_comments (0024) filled for guides. Same flat, one-level
-- shape for the same reason: a curated list invites reactions, not a
-- threaded debate.
CREATE TABLE collection_comments (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    collection_id BIGINT NOT NULL REFERENCES meal_collections(id) ON DELETE CASCADE,
    user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    author_name   TEXT NOT NULL,
    body          TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX collection_comments_collection_idx ON collection_comments(collection_id, created_at);
