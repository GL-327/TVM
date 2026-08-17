import { looksLikePack, matchLibraryItems, sortEpisodes, type MediaItem } from './media';
import type { Title } from './catalog';

const PACK_EXPAND_LIMIT = 8;

export function torrentKey(id: string): string | null {
  if (!id.startsWith('rd:t:')) return null;
  const rest = id.slice('rd:t:'.length);
  const cut = rest.lastIndexOf(':');
  if (cut === -1) return rest === '' ? null : rest;
  const maybeIndex = rest.slice(cut + 1);
  return /^\d+$/.test(maybeIndex) ? rest.slice(0, cut) : rest;
}

export function episodeKey(item: MediaItem): string {
  if (item.season !== undefined && item.episode !== undefined) return `s${item.season}e${item.episode}`;
  return (item.filename ?? item.id).toLowerCase();
}

export function episodeHeading(item: MediaItem): string {
  if (item.episodeName !== undefined && item.episodeName !== '') return item.episodeName;
  if (item.episode !== undefined) return `Episode ${item.episode}`;
  return item.filename ?? item.title;
}

function packScore(item: MediaItem): number {
  const name = `${item.title} ${item.filename ?? ''}`;
  let score = 0;
  if (/\bcomplete|box\s*set|seasons?\s*1\s*to/i.test(name)) score += 120;
  if (/\bS\d{1,2}\s*[-–]\s*S?\d{1,2}\b/i.test(name)) score += 80;
  if (/\bS\d{1,2}[\s._-]*E\d{1,2}\s*[-–]/i.test(name)) score += 20;
  if (looksLikePack(item.title, item.filename ?? '')) score += 10;
  return score;
}

/** Prefer complete-series torrents so season chips are not stuck on S01. */
export function packsToExpand(title: Title, library: readonly MediaItem[]): string[] {
  const matched = matchLibraryItems(title, library).filter((item) => item.id.startsWith('rd:t:'));
  const ranked = [...matched].sort((left, right) => packScore(right) - packScore(left));
  const ids: string[] = [];
  const seen = new Set<string>();
  if (title.id.startsWith('rd:t:')) {
    const key = torrentKey(title.id);
    if (key !== null) {
      seen.add(key);
      ids.push(title.id);
    }
  }
  for (const item of ranked) {
    const key = torrentKey(item.id);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    ids.push(item.id);
    if (ids.length >= PACK_EXPAND_LIMIT) break;
  }
  return ids;
}

export function mergeEpisodes(groups: readonly MediaItem[][]): MediaItem[] {
  const byKey = new Map<string, MediaItem>();
  for (const group of groups) {
    for (const item of group) {
      if (!item.playable) continue;
      if (looksLikePack(item.title, item.filename ?? '')) continue;
      const key = episodeKey(item);
      const existing = byKey.get(key);
      if (existing === undefined) {
        byKey.set(key, item);
        continue;
      }
      if ((item.episodeName?.length ?? 0) > (existing.episodeName?.length ?? 0)) byKey.set(key, item);
    }
  }
  return sortEpisodes([...byKey.values()]);
}

export function placeholderSeasons(title: Title): number[] {
  const count = Math.max(1, Math.min(title.seasons ?? 8, 30));
  return Array.from({ length: count }, (_, index) => index + 1);
}

export function placeholderEpisodes(title: Title, season: number, count = 12): MediaItem[] {
  const episodeCount = Math.max(1, Math.min(count, 40));
  return Array.from({ length: episodeCount }, (_, index) => {
    const episode = index + 1;
    return {
      id: `${title.id}:${season}:${episode}`,
      title: title.title,
      year: title.year > 0 ? title.year : null,
      kind: 'series' as const,
      synopsis: '',
      poster: title.poster,
      backdrop: title.backdrop,
      genres: [...title.genres],
      rating: title.rating,
      playable: true,
      hue: title.hue,
      season,
      episode,
      episodeName: `Episode ${episode}`,
      showTitle: title.title,
    };
  });
}
