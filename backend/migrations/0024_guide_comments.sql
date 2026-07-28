-- Iteration 27: guides have had propose-and-vote editing for the guide's
-- own body since Batch 2, but no way for a reader to just say something
-- about it - the same gap review_replies filled for meal reviews. A flat
-- comment list, not nested (same "one level deep, or none" reasoning
-- review_replies used) - a teaching article invites reactions and
-- questions, not a threaded debate.
CREATE TABLE guide_comments (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guide_id    BIGINT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
    user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guide_comments_guide_idx ON guide_comments(guide_id, created_at);
