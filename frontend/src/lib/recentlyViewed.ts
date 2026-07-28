const KEY = 'cb-recently-viewed';
const MAX = 12;

export interface RecentlyViewedItem {
  kind: 'meal' | 'ingredient';
  id: number;
  name: string;
  /// Cuisine for a meal, category for an ingredient - whatever `mealBackground`/
  /// `ingredientBackground` uses to pick a gradient when there's no photo.
  subtitle: string;
  photo_url: string | null;
}

function read(): RecentlyViewedItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecentlyViewedItem[]) : [];
  } catch {
    return [];
  }
}

export function getRecentlyViewed(): RecentlyViewedItem[] {
  return read();
}

/** Most-recent-first, de-duped by kind+id, capped at MAX - a repeat visit
 * just moves the item back to the front rather than piling up a duplicate. */
export function addRecentlyViewed(item: RecentlyViewedItem) {
  const next = [
    item,
    ...read().filter((i) => !(i.kind === item.kind && i.id === item.id)),
  ].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
}
