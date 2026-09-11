const LIMIT = 8;
const keyFor = (profile: string): string => `tvm.search.recent.${profile || 'device'}`;

export function validSearchTerm(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 80 && !/https?:|\S+\:\/\//i.test(value);
}

export function readRecentSearches(profile: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(keyFor(profile)) ?? '[]');
    return Array.isArray(value) ? value.filter(validSearchTerm).slice(0, LIMIT) : [];
  } catch { return []; }
}

export function saveRecentSearch(profile: string, query: string): string[] {
  const recent = readRecentSearches(profile);
  const term = query.trim();
  if (!validSearchTerm(term)) return recent;
  const next = [term, ...recent.filter((entry) => entry.toLocaleLowerCase() !== term.toLocaleLowerCase())].slice(0, LIMIT);
  try { localStorage.setItem(keyFor(profile), JSON.stringify(next)); } catch { /* Storage is optional. */ }
  return next;
}

export function clearRecentSearches(profile: string): void {
  try { localStorage.removeItem(keyFor(profile)); } catch { /* Storage is optional. */ }
}
