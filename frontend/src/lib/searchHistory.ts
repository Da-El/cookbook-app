const KEY = 'cb-recent-searches';
const MAX = 8;

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function write(terms: string[]) {
  localStorage.setItem(KEY, JSON.stringify(terms));
}

export function getRecentSearches(): string[] {
  return read();
}

/** Most-recent-first, case-insensitive de-duped, capped at MAX - a repeat
 * search just moves back to the front rather than piling up duplicates. */
export function addRecentSearch(term: string) {
  const trimmed = term.trim();
  if (!trimmed) return;
  const next = [trimmed, ...read().filter((t) => t.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX);
  write(next);
}

export function removeRecentSearch(term: string) {
  write(read().filter((t) => t !== term));
}

export function clearRecentSearches() {
  localStorage.removeItem(KEY);
}
