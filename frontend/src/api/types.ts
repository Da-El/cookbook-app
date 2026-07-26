export interface UserProfile {
  id: number;
  email: string;
  display_name: string;
  has_onboarded: boolean;
}

export interface IngredientSummary {
  id: number;
  name: string;
  category: string;
  foodb_group: string | null;
  foodb_subgroup: string | null;
  rating: number;
  rating_count: number;
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
