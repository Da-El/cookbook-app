export interface FilterPreset {
  id: string;
  name: string;
  mealType: string;
  diet: string;
  sort: string;
  difficulty: string;
  maxTime: number | null;
  occasion: string;
}

const KEY = 'cb-filter-presets';
const MAX = 10;

function read(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as FilterPreset[]) : [];
  } catch {
    return [];
  }
}

function write(presets: FilterPreset[]) {
  localStorage.setItem(KEY, JSON.stringify(presets));
}

export function getFilterPresets(): FilterPreset[] {
  return read();
}

/** Most-recently-saved first, capped at MAX - an old preset falls off rather
 * than growing the list forever. */
export function saveFilterPreset(name: string, filters: Omit<FilterPreset, 'id' | 'name'>): FilterPreset {
  const preset: FilterPreset = { id: crypto.randomUUID(), name: name.trim(), ...filters };
  write([preset, ...read()].slice(0, MAX));
  return preset;
}

export function deleteFilterPreset(id: string) {
  write(read().filter((p) => p.id !== id));
}

/** True once at least one filter differs from its default - saving an
 * all-"All" preset would just be a no-op chip cluttering the row. */
export function isNonDefaultFilter(f: Omit<FilterPreset, 'id' | 'name'>): boolean {
  return (
    f.mealType !== 'All' ||
    f.diet !== 'All' ||
    f.sort !== 'top' ||
    f.difficulty !== 'All' ||
    f.maxTime != null ||
    f.occasion !== 'All'
  );
}
