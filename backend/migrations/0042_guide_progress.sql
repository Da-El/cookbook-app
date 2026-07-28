CREATE TABLE guide_progress (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guide_id BIGINT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, guide_id)
);
