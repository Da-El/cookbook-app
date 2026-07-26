/**
 * No image assets ship with the design. Every "photo" is either a user upload or
 * a deterministic CSS gradient derived from the category/cuisine, so the app
 * still looks intentional before anyone has added photos.
 */

const CATEGORY_GRADIENTS: Record<string, [string, string]> = {
  Vegetable: ['hsl(95 46% 42%)', 'hsl(140 44% 25%)'],
  Herb: ['hsl(120 48% 44%)', 'hsl(96 42% 27%)'],
  Dairy: ['hsl(45 72% 66%)', 'hsl(38 55% 48%)'],
  Aromatic: ['hsl(320 38% 58%)', 'hsl(292 34% 40%)'],
  Pantry: ['hsl(36 68% 56%)', 'hsl(28 60% 40%)'],
  Grain: ['hsl(38 52% 62%)', 'hsl(30 42% 44%)'],
  Protein: ['hsl(8 58% 56%)', 'hsl(352 46% 40%)'],
  Fruit: ['hsl(28 74% 60%)', 'hsl(42 62% 48%)'],
};

const CUISINE_GRADIENTS: Record<string, [string, string]> = {
  Italian: ['hsl(8 54% 50%)', 'hsl(96 40% 30%)'],
  Japanese: ['hsl(352 50% 52%)', 'hsl(18 46% 40%)'],
  Mexican: ['hsl(30 66% 54%)', 'hsl(96 44% 34%)'],
  Chinese: ['hsl(6 56% 50%)', 'hsl(34 52% 42%)'],
  Thai: ['hsl(120 42% 42%)', 'hsl(38 60% 46%)'],
  American: ['hsl(20 56% 50%)', 'hsl(8 48% 38%)'],
};

const CUISINE_FALLBACK: [string, string] = ['hsl(20 54% 50%)', 'hsl(40 46% 40%)'];
const CATEGORY_FALLBACK: [string, string] = ['hsl(36 68% 56%)', 'hsl(28 60% 40%)'];

function gradient([from, to]: [string, string]): string {
  return `linear-gradient(145deg, ${from}, ${to})`;
}

export function categoryGradient(category?: string | null): string {
  return gradient(CATEGORY_GRADIENTS[category ?? ''] ?? CATEGORY_FALLBACK);
}

export function cuisineGradient(cuisine?: string | null): string {
  return gradient(CUISINE_GRADIENTS[cuisine ?? ''] ?? CUISINE_FALLBACK);
}

/** A CSS `background` shorthand: the upload if there is one, else the gradient. */
export function mealBackground(photoUrl: string | null | undefined, cuisine?: string | null): string {
  return photoUrl ? `center/cover no-repeat url("${photoUrl}")` : cuisineGradient(cuisine);
}

export function ingredientBackground(
  photoUrl: string | null | undefined,
  category?: string | null,
): string {
  return photoUrl ? `center/cover no-repeat url("${photoUrl}")` : categoryGradient(category);
}

export function formatTime(minutes: number): string {
  return `${minutes} min`;
}
