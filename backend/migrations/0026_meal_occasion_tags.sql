-- Iteration 30: crowd-voted occasion tags ("quick weeknight," "meal prep," ...)
-- for meals. Unlike diet_flags (derived from ingredient composition, so a
-- heuristic can guess at it) an occasion is a judgment about the DISH, not
-- something derivable from its ingredients - there's no algorithm for
-- "date night." So this is voting, not propose-and-pick-a-winner like
-- ingredient_edits/guide_edits: any signed-in user (not just the author)
-- can vote a tag onto a meal, and it counts as genuinely applied once more
-- than one person agrees, the same "don't let one enthusiastic vote decide
-- it" instinct behind reputation-weighted voting elsewhere in this app.
CREATE TABLE meal_occasion_votes (
    meal_id    BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    tag        TEXT NOT NULL,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (meal_id, tag, user_id)
);
CREATE INDEX meal_occasion_votes_meal_idx ON meal_occasion_votes(meal_id, tag);
