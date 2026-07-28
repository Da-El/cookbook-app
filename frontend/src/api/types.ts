export interface UserProfile {
  id: number;
  email: string;
  display_name: string;
  has_onboarded: boolean;
  is_admin: boolean;
}

export interface FlagRow {
  id: number;
  content_type: 'meal_revision' | 'review' | 'ingredient_edit' | 'alias' | 'substitute' | 'guide_edit' | 'user_profile';
  content_id: number;
  reason: string;
  flagged_by_name: string | null;
  created_at: string;
  summary: string;
  link: string | null;
  still_exists: boolean;
}

export interface IngredientSummary {
  id: number;
  name: string;
  category: string;
  food_group: string | null;
  food_subgroup: string | null;
  rating: number;
  rating_count: number;
  /// Heuristic, community-editable - see backend/src/diet.rs. Empty means
  /// "not yet tagged," not "compatible with nothing."
  diet_flags: string[];
}

export interface Micros {
  vit_c_mg: number | null;
  calcium_mg: number | null;
  iron_mg: number | null;
  potassium_mg: number | null;
  magnesium_mg: number | null;
  sodium_mg: number | null;
}

export interface Nutrition {
  serving_size: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sugar: number | null;
  source: string;
  micros: Micros;
}

export interface IngredientDetail extends IngredientSummary {
  description: string;
  photo_url: string | null;
  nutrition: Nutrition | null;
}

// ---------- import ----------

export interface DraftIngredient {
  raw_line: string;
  amount: number | null;
  unit: string | null;
  name: string;
  note: string | null;
  matched_ingredient_id: number | null;
  matched_name: string | null;
}

export interface RecipeDraft {
  title: string;
  description: string;
  image_url: string | null;
  servings: string | null;
  total_minutes: number | null;
  ingredients: DraftIngredient[];
  steps: string[];
  source_url: string | null;
  source_name: string | null;
}

export interface ImportResponse {
  import_id: number;
  extractor: string;
  draft: RecipeDraft;
  matched_count: number;
  total_count: number;
}

// ---------- planning ----------

export type PlanSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface PlanEntry {
  id: number;
  plan_date: string;
  slot: PlanSlot;
  meal_id: number;
  meal_name: string;
  cuisine: string;
  time_minutes: number;
  photo_url: string | null;
  servings: number;
  rating: number;
}

export interface GroceryItem {
  key: string;
  name: string;
  ingredient_id: number | null;
  category: string;
  total_label: string | null;
  in_fridge: boolean;
  from_meals: string[];
  unquantified: string[];
  meal_count: number;
}

export interface GroceryList {
  items: GroceryItem[];
  meals_planned: number;
  shared_count: number;
}

export interface PlanSuggestion {
  id: number;
  name: string;
  cuisine: string;
  time_minutes: number;
  rating: number;
  photo_url: string | null;
  shared: number;
  total: number;
  shared_names: string[];
}

/** The subset of a cookbook meal the planner's picker needs. */
export interface CookbookMealLite {
  id: number;
  name: string;
  cuisine: string;
  time_minutes: number;
  photo_url: string | null;
}

// ---------- guides ----------

export interface GuideSummary {
  id: number;
  slug: string;
  title: string;
  summary: string;
  topic: string;
  minutes: number | null;
  helpful_count: number;
  rating: number;
  rating_count: number;
}

export interface GuideDetail extends GuideSummary {
  body: string;
  your_helpful_vote: boolean;
  your_rating: number | null;
}
