# Ingredient seed data

`usda_foundation_foods.json` is derived from USDA FoodData Central's **Foundation
Foods** dataset (`FoodData_Central_foundation_food_json_2026-04-30.zip`, from
https://fdc.nal.usda.gov/download-datasets), which is a U.S. government work and
public domain - no attribution or non-commercial restriction, unlike the FooDB
data this replaced.

Each row is one Foundation Foods entry, transformed as:

- `name` - USDA's `description` field verbatim (kept specific, e.g. "Onions,
  yellow, raw" rather than collapsed to "Onion", so distinct varieties with
  distinct nutrient profiles don't collide under one name).
- `category` - USDA's `foodCategory.description` bucketed into this app's
  existing 8 categories (Vegetable/Herb/Dairy/Aromatic/Pantry/Grain/Protein/
  Fruit), with onions/garlic/leeks/shallots/scallions/ginger pulled out of
  "vegetables" into Aromatic to match how the original ingredient set used
  that category. Nothing in this release lands in Herb - USDA's Foundation
  Foods has no fresh leafy-herb entries (basil, cilantro, etc.), only
  alliums, so that category is currently unused.
- `foodGroup` / `foodSubgroup` - USDA's own `foodCategory.description` and
  `scientificName` (when present), replacing the old FooDB-specific
  group/subgroup tags.
- Nutrients - pulled from `foodNutrients` by USDA nutrient ID (1008 Energy,
  1003 Protein, 1004 Fat, 1005 Carbohydrate, 1079 Fiber, 2000/1063 Sugars,
  1162 Vitamin C, 1087 Calcium, 1089 Iron, 1092 Potassium, 1090 Magnesium,
  1093 Sodium), all already per-100g. Left null when USDA doesn't report a
  value for that food rather than guessing.

USDA provides no prose description for any food, so every seeded ingredient
starts with a blank `description` - same as the FooDB set's philosophy, this
is meant to be filled in via the community-edit feature rather than faked.

To regenerate against a newer USDA release: download the new Foundation Foods
JSON zip from the URL above, unzip it next to `transform.js`, update the
filename constant at the top of that script, and run `node transform.js`
to overwrite `usda_foundation_foods.json`. `seed_ingredients` in
`src/seed.rs` only runs once against an empty `ingredients` table, so a new
migration that truncates `ingredients` is needed to pick up the refreshed
file.
