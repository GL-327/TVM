import fallbackImdb from './fallback-imdb.json';

const FALLBACK_IMDB = fallbackImdb as Readonly<Record<string, string>>;

export function imdbIdFrom(id: string): string | null {
  const match = id.trim().match(/tt\d+/i);
  return match === null ? null : match[0].toLowerCase();
}

export function catalogImdb(id: string): string | null {
  const fromId = imdbIdFrom(id);
  if (fromId !== null) return fromId;
  const slug = id.trim().split(':')[0]?.toLowerCase() ?? '';
  return FALLBACK_IMDB[slug] ?? null;
}

export function playIdFor(showId: string, season?: number, episode?: number): string {
  // An owned provider file already identifies the exact episode. Appending a
  // season or extracting an IMDb substring loses that file's identity.
  if (showId.startsWith('rd:') || showId.startsWith('live:')) return showId;
  const imdb = catalogImdb(showId);
  const base = imdb ?? showId;
  if (season !== undefined && episode !== undefined) return `${base}:${season}:${episode}`;
  return base;
}

export function imdbScore(rating: string): string | null {
  const trimmed = rating.trim();
  if (!/^\d(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value > 10) return null;
  return trimmed;
}

export function certificateLabel(rating: string): string | null {
  const trimmed = rating.trim();
  if (trimmed === '' || imdbScore(trimmed) !== null) return null;
  return trimmed;
}

export function imdbTitleUrl(id: string): string | null {
  const imdb = imdbIdFrom(id);
  return imdb === null ? null : `https://www.imdb.com/title/${imdb}/`;
}

export function seriesGraphUrl(): string {
  return 'https://seriesgraph.com/';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function formatAired(value: string): string | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${day} ${MONTHS[month - 1]} ${match[1]}`;
}
