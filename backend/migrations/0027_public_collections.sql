-- Iteration 31: collections have been private-only since they shipped in
-- Iteration 17 ("collections aren't the source of truth" reasoning applied
-- to visibility too, at the time). This adds an explicit opt-in to share
-- one - default false, so every existing collection stays exactly as
-- private as its owner already expected it to be.
ALTER TABLE meal_collections ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false;
