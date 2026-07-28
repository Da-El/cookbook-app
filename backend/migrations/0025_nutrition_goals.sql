-- Iteration 28: personal daily nutrition targets, plus the log entry needed
-- to ever check progress against them. `cooked_meals` only ever answers
-- "have I cooked this, ever" (upserted once, no timestamp on repeats) and
-- `reviews` only gets a row when a note or score comes along - neither can
-- answer "what did I eat today." `meal_log` is a plain append-only entry
-- written on every cook(), independent of both.
CREATE TABLE meal_log (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meal_id   BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX meal_log_user_date_idx ON meal_log(user_id, logged_at);

ALTER TABLE users ADD COLUMN goal_calories  INT;
ALTER TABLE users ADD COLUMN goal_protein_g INT;
ALTER TABLE users ADD COLUMN goal_carbs_g   INT;
ALTER TABLE users ADD COLUMN goal_fat_g     INT;
