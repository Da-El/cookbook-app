-- Iteration 16: reviews have had helpful-voting since Batch 1 but no way to
-- actually respond to one - "this happened to me too" or "try it with less
-- salt" has nowhere to go but a brand new review of your own. One level
-- deep on purpose (replies don't get their own replies): a lightweight
-- conversation under a review, not a second comment section to moderate.
CREATE TABLE review_replies (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    review_id   BIGINT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    -- Denormalised so attribution survives the author deleting their
    -- account, same as every other authored row in this app.
    author_name TEXT,
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX review_replies_review_idx ON review_replies(review_id, created_at);

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('edit_suggested','edit_won','meal_cooked','meal_saved','new_follower',
                     'content_removed','flag_resolved','review_reply'));
