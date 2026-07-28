-- Iteration 17: user-curated named lists of meals ("Weeknight dinners",
-- "Meal prep favorites") - organisation that Saved/Cooked/Published can't
-- offer since those three are fixed, single-purpose buckets rather than
-- something a person can shape to how they actually think about their own
-- cookbook. Private to the owner for now (no visibility column) - a public/
-- shareable collection is a natural follow-up, not folded in here to keep
-- this iteration's surface area matched to what it's actually solving.
CREATE TABLE meal_collections (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX meal_collections_user_idx ON meal_collections(user_id, created_at);

CREATE TABLE meal_collection_items (
    collection_id BIGINT NOT NULL REFERENCES meal_collections(id) ON DELETE CASCADE,
    meal_id       BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (collection_id, meal_id)
);
