-- Diet compatibility, computed once and then community-editable.
--
-- Settings/onboarding have collected `users.diet_prefs` since the app's
-- first migration, but nothing has ever read it back - a vegetarian signs up,
-- says so, and the app forgets immediately. This is the ingredient-level data
-- that closes the loop: every ingredient gets a heuristic tag set (computed
-- in Rust, see diet.rs, from category/food_group/name - simple keyword and
-- category rules, not a nutrition database), and a meal's diet tags are the
-- intersection across its matched ingredients.
--
-- The heuristic will be wrong sometimes, and for gluten-free/dairy-free/
-- nut-free that's a safety question, not a taste one - which is exactly why
-- this reuses `ingredient_edits` rather than being a fixed system value: the
-- same propose-and-vote mechanism already trusted for description/category/
-- nutrition lets the community correct a wrong tag instead of it sitting
-- wrong forever.
ALTER TABLE ingredients ADD COLUMN diet_flags TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE ingredient_edits DROP CONSTRAINT ingredient_edits_field_check;
ALTER TABLE ingredient_edits ADD CONSTRAINT ingredient_edits_field_check
    CHECK (field IN ('description','category','photo','nutrition','diet_flags'));
