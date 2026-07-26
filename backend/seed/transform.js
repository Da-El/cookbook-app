const fs = require('fs');

// Update this to a newly-downloaded release's filename to regenerate the seed
// data (see README.md in this directory for the full instructions).
const SOURCE_FILE = 'FoodData_Central_foundation_food_json_2026-04-30.json';

const RAW = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
const foods = RAW.FoundationFoods.filter(Boolean);

// ---- category bucketing: USDA's own foodCategory, refined by keyword where the
// app's 8-category taxonomy (inherited from the old FooDB set) draws a finer line
// than USDA does (aromatics split out of "vegetables"; restaurant dishes have no
// category of their own so they're bucketed by dominant ingredient). ----
const AROMATIC_RE = /\b(onions?|garlic|leeks?|shallots?|scallions?|ginger)\b/i;

const USDA_CATEGORY_MAP = {
  'Vegetables and Vegetable Products': 'Vegetable',
  'Fruits and Fruit Juices': 'Fruit',
  'Dairy and Egg Products': 'Dairy',
  'Cereal Grains and Pasta': 'Grain',
  'Legumes and Legume Products': 'Protein',
  'Finfish and Shellfish Products': 'Protein',
  'Nut and Seed Products': 'Protein',
  'Beef Products': 'Protein',
  'Poultry Products': 'Protein',
  'Pork Products': 'Protein',
  'Sausages and Luncheon Meats': 'Protein',
  'Lamb, Veal, and Game Products': 'Protein',
  'Fats and Oils': 'Pantry',
  'Beverages': 'Dairy', // this release's only 3 entries are almond/oat milk
  'Spices and Herbs': 'Pantry',
  'Soups, Sauces, and Gravies': 'Pantry',
  'Baked Products': 'Pantry',
  'Sweets': 'Pantry',
};

// Per-item overrides for the 4 "Restaurant Foods" entries, which have no
// category of their own - bucketed by their dominant ingredient instead.
const NAME_OVERRIDES = {
  'Restaurant, Chinese, fried rice, without meat': 'Grain',
  'Restaurant, Latino, tamale, pork': 'Protein',
  'Restaurant, Latino, pupusas con frijoles (pupusas, bean)': 'Protein',
  'Restaurant, Chinese, sweet and sour pork': 'Protein',
};

function bucketCategory(food) {
  if (NAME_OVERRIDES[food.description]) return NAME_OVERRIDES[food.description];
  const usdaCat = food.foodCategory?.description ?? '';
  if (usdaCat === 'Vegetables and Vegetable Products' && AROMATIC_RE.test(food.description)) {
    return 'Aromatic';
  }
  return USDA_CATEGORY_MAP[usdaCat] ?? 'Pantry';
}

// ---- nutrient extraction (USDA nutrient IDs, verified against this file) ----
const NUTRIENT_IDS = {
  calories: [1008, 2047, 2048],
  protein: [1003],
  carbs: [1005, 1050],
  fat: [1004],
  fiber: [1079],
  sugar: [2000, 1063],
  vitC: [1162],
  calcium: [1087],
  iron: [1089],
  potassium: [1092],
  magnesium: [1090],
  sodium: [1093],
};

function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}

function extractNutrients(food) {
  const byId = new Map();
  for (const fn of food.foodNutrients || []) {
    if (fn.nutrient && typeof fn.amount === 'number') byId.set(fn.nutrient.id, fn.amount);
  }
  const pick = (ids) => {
    for (const id of ids) if (byId.has(id)) return byId.get(id);
    return null;
  };
  const calories = pick(NUTRIENT_IDS.calories);
  return {
    calories: calories == null ? null : Math.round(calories),
    protein: round1(pick(NUTRIENT_IDS.protein)),
    carbs: round1(pick(NUTRIENT_IDS.carbs)),
    fat: round1(pick(NUTRIENT_IDS.fat)),
    fiber: round1(pick(NUTRIENT_IDS.fiber)),
    sugar: round1(pick(NUTRIENT_IDS.sugar)),
    vitC: round1(pick(NUTRIENT_IDS.vitC)),
    calcium: round1(pick(NUTRIENT_IDS.calcium)),
    iron: round1(pick(NUTRIENT_IDS.iron)),
    potassium: round1(pick(NUTRIENT_IDS.potassium)),
    magnesium: round1(pick(NUTRIENT_IDS.magnesium)),
    sodium: round1(pick(NUTRIENT_IDS.sodium)),
  };
}

// ---- assemble + dedupe by name (case-insensitive) ----
const seen = new Set();
const out = [];
let dupes = 0;
for (const food of foods) {
  const key = food.description.trim().toLowerCase();
  if (seen.has(key)) { dupes++; continue; }
  seen.add(key);

  out.push({
    name: food.description.trim(),
    category: bucketCategory(food),
    foodGroup: food.foodCategory?.description ?? null,
    foodSubgroup: food.scientificName ?? null,
    fdcId: food.fdcId,
    ...extractNutrients(food),
  });
}

fs.writeFileSync('usda_foundation_foods.json', JSON.stringify(out, null, 2));

console.log('input foods (non-null):', foods.length);
console.log('output rows:', out.length, '(dupes skipped:', dupes, ')');

const cats = new Map();
for (const r of out) cats.set(r.category, (cats.get(r.category) || 0) + 1);
console.log('final category counts:', [...cats.entries()].sort((a, b) => b[1] - a[1]));

const missingCalories = out.filter(r => r.calories == null).length;
console.log('rows missing calories:', missingCalories);
