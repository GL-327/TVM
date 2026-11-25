import type { MediaItem } from './types.ts';

/*
 * Age limits. TVM's catalogue sources carry genres but no certificates, so a
 * limit is a genre rule from packages/content/parental.json, and the apps say
 * "Filters by genre" next to it.
 */

export interface AgeLevel {
  maxAge: number;
  label: string;
  allow: string[] | null;
  block: string[];
  liveGroups: string[] | null;
}

export const AGE_LIMITS = [7, 12, 15, 18] as const;
export type AgeLimit = (typeof AGE_LIMITS)[number];

/** Used when parental.json cannot be read, so a kids profile never falls open. */
export const FALLBACK_LEVELS: AgeLevel[] = [
  { maxAge: 7, label: 'Up to 7', allow: ['Animation', 'Family'], block: ['Horror', 'Crime', 'Thriller', 'War', 'Mystery', 'Romance'], liveGroups: ['Kids'] },
  { maxAge: 12, label: 'Up to 12', allow: null, block: ['Horror', 'Crime', 'Thriller', 'War'], liveGroups: ['Kids', 'Movies', 'Music', 'Science', 'Sport'] },
  { maxAge: 15, label: 'Up to 15', allow: null, block: ['Horror'], liveGroups: null },
  { maxAge: 18, label: 'No limit', allow: null, block: [], liveGroups: null },
];

export function isAgeLimit(value: unknown): value is AgeLimit {
  return typeof value === 'number' && (AGE_LIMITS as readonly number[]).includes(value);
}

export function parseLevels(raw: unknown): AgeLevel[] {
  if (!Array.isArray(raw)) return FALLBACK_LEVELS;
  const levels = raw.flatMap((entry): AgeLevel[] => {
    if (entry === null || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    if (!isAgeLimit(row['maxAge'])) return [];
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    return [{
      maxAge: row['maxAge'],
      label: typeof row['label'] === 'string' ? row['label'] : `Up to ${row['maxAge']}`,
      allow: row['allow'] === null || row['allow'] === undefined ? null : strings(row['allow']),
      block: strings(row['block']),
      liveGroups: row['liveGroups'] === null || row['liveGroups'] === undefined ? null : strings(row['liveGroups']),
    }];
  });
  return levels.length === AGE_LIMITS.length ? levels : FALLBACK_LEVELS;
}

export function levelFor(maxAge: number, levels: readonly AgeLevel[] = FALLBACK_LEVELS): AgeLevel {
  return levels.find((level) => level.maxAge === maxAge) ?? levels[levels.length - 1] ?? FALLBACK_LEVELS[3]!;
}

const norm = (genre: string): string => genre.trim().toLowerCase();

/**
 * True when a title suits the limit. Files from the viewer's own library have
 * no genres, so nothing says what they are: they stay hidden up to 12.
 */
export function allowedForLevel(
  item: Pick<MediaItem, 'genres' | 'kind'>,
  level: AgeLevel,
  certificate?: { age: number } | null,
): boolean {
  if (level.maxAge >= 18) return true;
  // A real certificate (BBFC or MPA, by IMDb id) decides; genres are the fallback.
  if (certificate !== undefined && certificate !== null) return certificate.age <= level.maxAge;
  const genres = (item.genres ?? []).map(norm);
  if (genres.length === 0) return level.allow === null && (item.kind !== 'file' || level.maxAge >= 15);
  if (level.block.some((blocked) => genres.includes(norm(blocked)))) return false;
  if (level.allow !== null && !level.allow.some((allowed) => genres.includes(norm(allowed)))) return false;
  return true;
}

export function filterForLevel<T extends Pick<MediaItem, 'genres' | 'kind'> & { id?: string }>(
  items: readonly T[],
  level: AgeLevel,
  certificateOf?: (id: string) => { age: number } | null | undefined,
): T[] {
  if (level.maxAge >= 18) return [...items];
  return items.filter((item) =>
    allowedForLevel(item, level, item.id === undefined || certificateOf === undefined ? undefined : certificateOf(item.id)));
}

export function liveGroupAllowed(group: string, level: AgeLevel): boolean {
  return level.liveGroups === null || level.liveGroups.some((allowed) => norm(allowed) === norm(group));
}
