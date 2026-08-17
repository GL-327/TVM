import type { MediaItem } from './types.ts';

export function genreWeights(history: readonly MediaItem[]): Map<string, number> {
  const weights = new Map<string, number>();
  for (const item of history) {
    for (const genre of item.genres) {
      const key = genre.toLowerCase();
      if (key === '' || key === 'your files') continue;
      weights.set(key, (weights.get(key) ?? 0) + 1);
    }
  }
  return weights;
}

export function scoreForYou(item: MediaItem, weights: Map<string, number>, now = new Date()): number {
  let score = 0;
  for (const genre of item.genres) {
    score += (weights.get(genre.toLowerCase()) ?? 0) * 8;
  }
  if ((item.year ?? 0) >= now.getFullYear() - 2) score += 6;
  if (item.rating !== '') {
    const rating = Number(item.rating);
    if (Number.isFinite(rating)) score += rating;
  }
  return score;
}

export function pickYouMightLike(
  pool: readonly MediaItem[],
  history: readonly MediaItem[],
  exclude: ReadonlySet<string>,
  limit = 16,
): MediaItem[] {
  const unused = pool.filter((item) => !exclude.has(item.id) && !exclude.has(item.title));
  if (history.length === 0) return unused.slice(0, limit);
  const weights = genreWeights(history);
  return [...unused]
    .sort((left, right) => scoreForYou(right, weights) - scoreForYou(left, weights))
    .slice(0, limit);
}

export function becauseYouWatched(
  source: MediaItem | undefined,
  pool: readonly MediaItem[],
  exclude: ReadonlySet<string>,
  limit = 12,
): MediaItem[] {
  if (source === undefined) return [];
  const wanted = new Set(source.genres.map((genre) => genre.toLowerCase()));
  if (wanted.size === 0) return [];
  return pool
    .filter((item) => item.id !== source.id && !exclude.has(item.id) && item.genres.some((genre) => wanted.has(genre.toLowerCase())))
    .slice(0, limit);
}

export function takeUnused(source: readonly MediaItem[], used: Set<string>, limit: number): MediaItem[] {
  const out: MediaItem[] = [];
  for (const item of source) {
    if (used.has(item.id) || used.has(item.title)) continue;
    used.add(item.id);
    used.add(item.title);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function interleaveUnused(
  first: readonly MediaItem[],
  second: readonly MediaItem[],
  used: Set<string>,
  limit: number,
): MediaItem[] {
  const takeNext = (source: readonly MediaItem[], cursor: { index: number }): MediaItem | null => {
    while (cursor.index < source.length) {
      const item = source[cursor.index];
      cursor.index += 1;
      if (item === undefined) continue;
      if (used.has(item.id) || used.has(item.title)) continue;
      used.add(item.id);
      used.add(item.title);
      return item;
    }
    return null;
  };
  const left = { index: 0 };
  const right = { index: 0 };
  const out: MediaItem[] = [];
  let fromFirst = true;
  while (out.length < limit) {
    const item = fromFirst
      ? (takeNext(first, left) ?? takeNext(second, right))
      : (takeNext(second, right) ?? takeNext(first, left));
    if (item === null) break;
    out.push(item);
    fromFirst = !fromFirst;
  }
  return out;
}
