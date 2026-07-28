ALTER TABLE review_replies
    ADD COLUMN parent_reply_id BIGINT REFERENCES review_replies(id) ON DELETE CASCADE;

CREATE INDEX review_replies_parent_idx ON review_replies (parent_reply_id);
