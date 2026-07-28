CREATE TABLE collection_follows (
    collection_id  BIGINT NOT NULL REFERENCES meal_collections(id) ON DELETE CASCADE,
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (collection_id, user_id)
);
CREATE INDEX collection_follows_user_idx ON collection_follows(user_id);

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('edit_suggested', 'edit_won', 'meal_cooked', 'meal_saved', 'new_follower',
                     'content_removed', 'flag_resolved', 'review_reply', 'collection_meal_added'));

ALTER TABLE notifications DROP CONSTRAINT notifications_subject_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_subject_type_check
    CHECK (subject_type IN ('meal', 'ingredient', 'edit', 'collection'));
