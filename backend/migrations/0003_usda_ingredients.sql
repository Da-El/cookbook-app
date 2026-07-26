-- Switch the ingredient catalog's nutrition source from FooDB (CC BY-NC 4.0,
-- non-commercial only) to USDA FoodData Central's Foundation Foods dataset
-- (U.S. government work, public domain). Confirmed via direct query before
-- writing this migration: production has 0 meals and 0 real users, so nothing
-- references the ingredients being replaced here.

ALTER TABLE ingredients RENAME COLUMN foodb_group TO food_group;
ALTER TABLE ingredients RENAME COLUMN foodb_subgroup TO food_subgroup;

-- Must run before the constraint change below: ADD CONSTRAINT validates every
-- existing row, and the old FooDB-sourced rows would violate the new check.
-- CASCADE also clears ingredient_edits/edit_votes (FK'd to ingredients) and, via
-- TRUNCATE's cascade-to-referencing-tables behavior, meal_ingredients - already
-- confirmed empty. RESTART IDENTITY so the reseeded catalog gets fresh, low ids.
TRUNCATE TABLE ingredients RESTART IDENTITY CASCADE;

ALTER TABLE ingredient_nutrition DROP CONSTRAINT ingredient_nutrition_source_check;
ALTER TABLE ingredient_nutrition ADD CONSTRAINT ingredient_nutrition_source_check
    CHECK (source IN ('USDA','Community'));
ALTER TABLE ingredient_nutrition ALTER COLUMN source SET DEFAULT 'USDA';
