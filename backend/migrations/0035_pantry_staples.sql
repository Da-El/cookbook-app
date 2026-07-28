-- A staple (salt, oil, pepper...) is always on hand and never worth putting
-- on a grocery list, unlike a regular fridge item which just marks "you
-- currently have this" (still shown on the list as already-covered, not
-- excluded - see planner.rs's in_fridge annotation vs this outright skip).
ALTER TABLE fridge_items ADD COLUMN is_staple BOOLEAN NOT NULL DEFAULT false;
