import {
  createExtras,
  isSubtitleUrl,
  type ExtrasClient,
} from '../../../../packages/extras/src/index';
import { apiFetch, currentProfileId, fetchMedia, invalidateHome, type MediaItem, type PlaybackSegments, type PlaybackSubtitle } from './media';
import { filterItemsByAge } from './parental';
import { readPrefs } from './prefs';
import { effectiveProfileMaxAge, peekActiveProfile } from './profiles';
import { imdbIdFrom } from './playId';

export type ExtrasSegmentWindow = { start: number; end: number };
export type ExtrasCreditsWindow = { start: number; end: number | null };
export type ExtrasSegments = PlaybackSegments;
export type ExtrasSubtitle = PlaybackSubtitle;

export interface ExtrasTrailer {
  youtubeId: string;
  name: string;
}

export interface ExtrasCollection {
  name: string | null;
  items: MediaItem[];
}

export interface ExtrasUpcomingEpisode {
  season: number;
  episode: number;
  name: string;
  airstamp: string;
}

export interface ExtrasUpcomingHomeItem {
  item: MediaItem;
  next: ExtrasUpcomingEpisode;
}

export interface ExtrasStatsGenre {
  genre: string;
  seconds: number;
}

export interface ExtrasStatsHistoryEntry {
  item: MediaItem;
  at: string | number;
  seconds: number;
}

export interface ExtrasStats {
  week: number;
  month: number;
  all: number;
  finished: number;
  streakDays: number;
  topGenres: ExtrasStatsGenre[];
  history: ExtrasStatsHistoryEntry[];
}

export interface ExtrasAnimeTitle {
  english: string | null;
  malId: number | null;
}

const EXTRAS_TIMEOUT_MS = 6_000;
export const STATS_CLEARED_EVENT = 'tvm:stats-cleared';

const segmentsCache = new Map<string, ExtrasSegments | null>();
const subtitlesCache = new Map<string, ExtrasSubtitle[] | null>();
const trailersCache = new Map<string, ExtrasTrailer[] | null>();
const collectionCache = new Map<string, ExtrasCollection | null>();
const upcomingCache = new Map<string, ExtrasUpcomingEpisode | null>();
const animeTitleCache = new Map<string, ExtrasAnimeTitle | null>();

const createdSubtitleBlobs = new Set<string>();
let browserExtrasClient: ExtrasClient | null = null;

function getBrowserExtras(): ExtrasClient {
  if (browserExtrasClient === null) {
    browserExtrasClient = createExtras({
      timeoutMs: EXTRAS_TIMEOUT_MS,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const response = await globalThis.fetch(input, init);
        if (response.type === 'opaque') {
          throw new Error('Cross-origin response blocked');
        }
        return response;
      }) as typeof fetch,
    });
  }
  return browserExtrasClient;
}

function extractSubtitleUpstreamUrl(proxyUrl: string): string | null {
  try {
    const parsed = new URL(proxyUrl, 'http://localhost');
    const upstream = parsed.searchParams.get('u');
    return upstream !== null && isSubtitleUrl(upstream) ? upstream : null;
  } catch {
    return null;
  }
}

function vttTextToTrackUrl(vtt: string): string | null {
  if (!vtt.includes('-->')) return null;
  if (typeof Blob === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt;charset=utf-8' }));
    createdSubtitleBlobs.add(blobUrl);
    return blobUrl;
  }
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`;
}

export function clearExtrasCache(): void {
  segmentsCache.clear();
  subtitlesCache.clear();
  trailersCache.clear();
  collectionCache.clear();
  upcomingCache.clear();
  animeTitleCache.clear();
  browserExtrasClient = null;
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    for (const url of createdSubtitleBlobs) {
      URL.revokeObjectURL(url);
    }
  }
  createdSubtitleBlobs.clear();
}

function timeoutSignal(caller?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(EXTRAS_TIMEOUT_MS);
  return caller === undefined ? timeout : AbortSignal.any([caller, timeout]);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseSegmentWindow(raw: unknown): ExtrasSegmentWindow | null {
  if (raw === null || typeof raw !== 'object') return null;
  const row = raw as { start?: unknown; end?: unknown };
  const start = asFiniteNumber(row.start);
  const end = asFiniteNumber(row.end);
  if (start === null || end === null || start < 0 || end <= start) return null;
  return { start, end };
}

function parseCreditsWindow(raw: unknown): ExtrasCreditsWindow | null {
  if (raw === null || typeof raw !== 'object') return null;
  const row = raw as { start?: unknown; end?: unknown };
  const start = asFiniteNumber(row.start);
  if (start === null || start < 0) return null;
  const end = row.end === null || row.end === undefined ? null : asFiniteNumber(row.end);
  if (end !== null && end <= start) return null;
  return { start, end };
}

export function parseExtrasSegments(raw: unknown): ExtrasSegments | null {
  if (raw === null || typeof raw !== 'object') return null;
  const body = raw as { intro?: unknown; recap?: unknown; credits?: unknown; source?: unknown };
  const source = body.source === 'theintrodb' || body.source === 'aniskip' ? body.source : null;
  return {
    intro: parseSegmentWindow(body.intro),
    recap: parseSegmentWindow(body.recap),
    credits: parseCreditsWindow(body.credits),
    source,
  };
}

export function isAnimeCandidate(genres: readonly string[] | undefined, explicitAnime?: boolean): boolean {
  if (explicitAnime === true) return true;
  if (genres === undefined) return false;
  return genres.some((genre) => /\b(anime|animation)\b/i.test(genre));
}

export async function fetchExtrasSegments(
  input: {
    id: string;
    season?: number;
    episode?: number;
    title?: string;
    anime?: boolean;
  },
  signal?: AbortSignal,
): Promise<ExtrasSegments | null> {
  const imdb = imdbIdFrom(input.id) ?? '';
  const cleanTitle = (input.title ?? '').trim();
  if (imdb === '' && cleanTitle === '') return null;

  const params = new URLSearchParams();
  if (imdb !== '') params.set('id', imdb);
  if (input.season !== undefined) params.set('season', String(input.season));
  if (input.episode !== undefined) params.set('episode', String(input.episode));
  if (cleanTitle !== '') params.set('title', cleanTitle);
  params.set('anime', input.anime ? '1' : '0');

  const key = params.toString();
  if (segmentsCache.has(key)) return segmentsCache.get(key) ?? null;

  try {
    const res = await apiFetch(`/api/extras/segments?${key}`, { signal: timeoutSignal(signal) });
    if (res.status === 404) {
      if (imdb === '') return null;
      const computed = await getBrowserExtras().segments({
        id: imdb,
        season: input.season,
        episode: input.episode,
        title: cleanTitle !== '' ? cleanTitle : undefined,
        anime: input.anime,
      });
      if (signal?.aborted) return null;
      if (computed.source !== null) segmentsCache.set(key, computed);
      return computed;
    }
    if (!res.ok) return null;
    const parsed = parseExtrasSegments(await res.json());
    segmentsCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function fetchExtrasSubtitles(
  input: { id: string; season?: number; episode?: number },
  signal?: AbortSignal,
): Promise<ExtrasSubtitle[] | null> {
  const imdb = imdbIdFrom(input.id);
  if (imdb === null) return null;

  const params = new URLSearchParams({ id: imdb });
  if (input.season !== undefined) params.set('season', String(input.season));
  if (input.episode !== undefined) params.set('episode', String(input.episode));

  const key = params.toString();
  if (subtitlesCache.has(key)) return subtitlesCache.get(key) ?? null;

  try {
    const res = await apiFetch(`/api/extras/subtitles?${key}`, { signal: timeoutSignal(signal) });
    if (res.status === 404) {
      const client = getBrowserExtras();
      const candidates = await client.subtitles(
        { id: imdb, season: input.season, episode: input.episode },
        readPrefs().subtitleLanguages,
      );
      if (signal?.aborted) return null;
      if (candidates.length === 0) return [];
      const resolved = await Promise.all(
        candidates.slice(0, 12).map(async (item): Promise<ExtrasSubtitle | null> => {
          const upstream = extractSubtitleUpstreamUrl(item.url);
          if (upstream === null) return null;
          const vtt = await client.subtitleVtt(upstream);
          if (vtt === null) return null;
          const trackUrl = vttTextToTrackUrl(vtt);
          if (trackUrl === null) return null;
          return {
            id: item.id,
            language: item.language,
            label: item.label,
            url: trackUrl,
          };
        }),
      );
      if (signal?.aborted) return null;
      const usable = resolved.filter((row): row is ExtrasSubtitle => row !== null);
      if (usable.length > 0) subtitlesCache.set(key, usable);
      return usable;
    }
    if (!res.ok) return null;
    const body = (await res.json()) as { subtitles?: unknown };
    if (!Array.isArray(body.subtitles)) return [];
    const list: ExtrasSubtitle[] = [];
    const seen = new Set<string>();
    for (const row of body.subtitles) {
      if (row === null || typeof row !== 'object') continue;
      const item = row as { id?: unknown; language?: unknown; label?: unknown; url?: unknown };
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      if (url === '' || seen.has(url)) continue;
      seen.add(url);
      list.push({
        ...(typeof item.id === 'string' ? { id: item.id } : {}),
        language: typeof item.language === 'string' ? item.language.trim() : '',
        label: typeof item.label === 'string' ? item.label.trim() : '',
        url,
      });
    }
    subtitlesCache.set(key, list);
    return list;
  } catch {
    return null;
  }
}

export async function fetchExtrasTrailers(id: string, signal?: AbortSignal): Promise<ExtrasTrailer[] | null> {
  const imdb = imdbIdFrom(id);
  if (imdb === null) return null;
  if (trailersCache.has(imdb)) return trailersCache.get(imdb) ?? null;

  try {
    const res = await apiFetch(`/api/extras/trailers?id=${encodeURIComponent(imdb)}`, {
      signal: timeoutSignal(signal),
    });
    if (res.status === 404) {
      const out = await getBrowserExtras().trailers(imdb);
      if (signal?.aborted) return null;
      if (out.length > 0) trailersCache.set(imdb, out);
      return out;
    }
    if (!res.ok) return null;
    const body = (await res.json()) as { trailers?: unknown };
    const raw = Array.isArray(body.trailers) ? body.trailers : [];
    const out: ExtrasTrailer[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
      if (entry === null || typeof entry !== 'object') continue;
      const row = entry as { youtubeId?: unknown; name?: unknown };
      const youtubeId = typeof row.youtubeId === 'string' ? row.youtubeId.trim() : '';
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(youtubeId) || seen.has(youtubeId)) continue;
      seen.add(youtubeId);
      out.push({
        youtubeId,
        name: typeof row.name === 'string' && row.name.trim() !== '' ? row.name.trim() : 'Trailer',
      });
    }
    trailersCache.set(imdb, out);
    return out;
  } catch {
    return null;
  }
}

export async function fetchExtrasCollection(id: string, signal?: AbortSignal): Promise<ExtrasCollection | null> {
  const imdb = imdbIdFrom(id);
  if (imdb === null) return null;
  const cacheKey = `${currentProfileId()}:${imdb}`;
  if (collectionCache.has(cacheKey)) return collectionCache.get(cacheKey) ?? null;

  try {
    const res = await apiFetch(`/api/extras/collection?id=${encodeURIComponent(imdb)}`, {
      signal: timeoutSignal(signal),
    });
    if (res.status === 404) {
      const raw = await getBrowserExtras().collection(imdb);
      if (signal?.aborted) return null;
      const resolved = (await Promise.all(raw.ids.map((memberId) => fetchMedia(memberId)))).filter(
        (item): item is MediaItem => item !== null,
      );
      if (signal?.aborted) return null;
      const maxAge = effectiveProfileMaxAge(peekActiveProfile());
      const result: ExtrasCollection = {
        name: raw.name,
        items: filterItemsByAge(resolved, maxAge),
      };
      if (result.items.length >= 2) collectionCache.set(cacheKey, result);
      return result;
    }
    if (!res.ok) return null;
    const body = (await res.json()) as { name?: unknown; items?: unknown };
    const rawItems = Array.isArray(body.items) ? (body.items as MediaItem[]) : [];
    const maxAge = effectiveProfileMaxAge(peekActiveProfile());
    const items = filterItemsByAge(rawItems, maxAge);
    const result: ExtrasCollection = {
      name: typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : null,
      items,
    };
    collectionCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

export function visibleCollectionItems(collection: ExtrasCollection | null, currentId: string): MediaItem[] {
  if (collection === null || collection.items.length < 2) return [];
  const currentImdb = imdbIdFrom(currentId);
  return collection.items.filter((item) => {
    if (item.id === currentId) return false;
    const itemImdb = imdbIdFrom(item.id);
    if (currentImdb !== null && itemImdb === currentImdb) return false;
    return true;
  });
}

function parseUpcomingEpisode(raw: unknown): ExtrasUpcomingEpisode | null {
  if (raw === null || typeof raw !== 'object') return null;
  const row = raw as { season?: unknown; episode?: unknown; name?: unknown; airstamp?: unknown };
  const season = asFiniteNumber(row.season);
  const episode = asFiniteNumber(row.episode);
  const airstamp = typeof row.airstamp === 'string' ? row.airstamp.trim() : '';
  if (season === null || episode === null || airstamp === '') return null;
  const parsed = new Date(airstamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    season,
    episode,
    name: typeof row.name === 'string' ? row.name.trim() : '',
    airstamp,
  };
}

export async function fetchExtrasUpcoming(id: string, signal?: AbortSignal): Promise<ExtrasUpcomingEpisode | null> {
  const imdb = imdbIdFrom(id);
  if (imdb === null) return null;
  if (upcomingCache.has(imdb)) return upcomingCache.get(imdb) ?? null;

  try {
    const res = await apiFetch(`/api/extras/upcoming?id=${encodeURIComponent(imdb)}`, {
      signal: timeoutSignal(signal),
    });
    if (res.status === 404) {
      const next = await getBrowserExtras().upcoming(imdb);
      if (signal?.aborted) return null;
      if (next !== null) upcomingCache.set(imdb, next);
      return next;
    }
    if (!res.ok) return null;
    const body = (await res.json()) as { next?: unknown };
    const next = parseUpcomingEpisode(body.next);
    upcomingCache.set(imdb, next);
    return next;
  } catch {
    return null;
  }
}

export async function fetchExtrasUpcomingHome(signal?: AbortSignal): Promise<ExtrasUpcomingHomeItem[] | null> {
  try {
    const res = await apiFetch('/api/extras/upcoming/home', {
      signal: timeoutSignal(signal),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!Array.isArray(body.items)) return [];
    const maxAge = effectiveProfileMaxAge(peekActiveProfile());
    const out: ExtrasUpcomingHomeItem[] = [];
    for (const entry of body.items) {
      if (entry === null || typeof entry !== 'object') continue;
      const row = entry as { item?: unknown; next?: unknown };
      if (row.item === null || typeof row.item !== 'object') continue;
      const item = row.item as MediaItem;
      const next = parseUpcomingEpisode(row.next);
      if (next === null) continue;
      if (filterItemsByAge([item], maxAge).length === 0) continue;
      out.push({ item, next });
    }
    return out;
  } catch {
    return null;
  }
}

export async function fetchExtrasStats(signal?: AbortSignal): Promise<ExtrasStats | null> {
  try {
    const res = await apiFetch('/api/extras/stats', { signal: timeoutSignal(signal) });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<ExtrasStats>;
    return {
      week: Math.max(0, asFiniteNumber(body.week) ?? 0),
      month: Math.max(0, asFiniteNumber(body.month) ?? 0),
      all: Math.max(0, asFiniteNumber(body.all) ?? 0),
      finished: Math.max(0, Math.floor(asFiniteNumber(body.finished) ?? 0)),
      streakDays: Math.max(0, Math.floor(asFiniteNumber(body.streakDays) ?? 0)),
      topGenres: Array.isArray(body.topGenres)
        ? body.topGenres
            .filter((g): g is ExtrasStatsGenre => g !== null && typeof g === 'object' && typeof g.genre === 'string')
            .map((g) => ({ genre: g.genre, seconds: Math.max(0, asFiniteNumber(g.seconds) ?? 0) }))
        : [],
      history: Array.isArray(body.history)
        ? body.history
            .filter((h): h is ExtrasStatsHistoryEntry => h !== null && typeof h === 'object' && h.item !== null && typeof h.item === 'object')
            .map((h) => ({
              item: h.item,
              at: typeof h.at === 'string' || typeof h.at === 'number' ? h.at : '',
              seconds: Math.max(0, asFiniteNumber(h.seconds) ?? 0),
            }))
        : [],
    };
  } catch {
    return null;
  }
}

export async function clearExtrasStats(): Promise<boolean> {
  try {
    const res = await apiFetch('/api/extras/stats/clear', {
      method: 'POST',
      signal: timeoutSignal(),
    });
    if (!res.ok) return false;
    invalidateHome();
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(STATS_CLEARED_EVENT));
    }
    return true;
  } catch {
    return false;
  }
}

export async function fetchExtrasAnimeTitle(title: string, signal?: AbortSignal): Promise<ExtrasAnimeTitle | null> {
  const clean = title.trim();
  if (clean === '') return null;
  const key = clean.toLowerCase();
  if (animeTitleCache.has(key)) return animeTitleCache.get(key) ?? null;

  try {
    const res = await apiFetch(`/api/extras/anime-title?title=${encodeURIComponent(clean)}`, {
      signal: timeoutSignal(signal),
    });
    if (res.status === 404) {
      const result = await getBrowserExtras().animeTitle(clean);
      if (signal?.aborted) return null;
      if (result.english !== null || result.malId !== null) animeTitleCache.set(key, result);
      return result;
    }
    if (!res.ok) return null;
    const body = (await res.json()) as { english?: unknown; malId?: unknown };
    const result: ExtrasAnimeTitle = {
      english: typeof body.english === 'string' && body.english.trim() !== '' ? body.english.trim() : null,
      malId: asFiniteNumber(body.malId),
    };
    animeTitleCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

export function shouldShowAnimeEnglishTitle(originalTitle: string, englishTitle: string | null | undefined): string | null {
  if (typeof englishTitle !== 'string') return null;
  const cleanEnglish = englishTitle.trim();
  if (cleanEnglish === '') return null;
  if (cleanEnglish.toLowerCase() === originalTitle.trim().toLowerCase()) return null;
  return cleanEnglish;
}

export function formatEpisodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

export function formatUpcomingDate(airstamp: string): string | null {
  const date = new Date(airstamp);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' }).format(date);
  } catch {
    return date.toDateString();
  }
}

export function formatUpcomingShort(airstamp: string): string | null {
  const date = new Date(airstamp);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
  } catch {
    return date.toDateString();
  }
}

export function formatWatchDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 hrs';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const hours = seconds / 3600;
  if (hours >= 10) return `${Math.round(hours)} hrs`;
  return `${hours.toFixed(1)} hrs`;
}

export function youtubeEmbedUrl(youtubeId: string, options: { muted?: boolean; loop?: boolean } = {}): string {
  const id = encodeURIComponent(youtubeId);
  const params = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  });
  if (options.muted) {
    params.set('mute', '1');
    params.set('controls', '0');
  }
  if (options.loop) {
    params.set('loop', '1');
    params.set('playlist', youtubeId);
  }
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

export function youtubeWatchUrl(youtubeId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`;
}

export interface HeroPreviewGuardInput {
  heroPreviews: boolean;
  reducedMotion: boolean;
  phoneShell: boolean;
  userAgent: string;
  narrowViewport: boolean;
  coarsePointer: boolean;
  connectionType?: string;
  saveData?: boolean;
  documentHidden: boolean;
}

export function shouldPlayHeroPreview(input: HeroPreviewGuardInput): boolean {
  if (!input.heroPreviews) return false;
  if (input.reducedMotion) return false;
  if (input.phoneShell || input.narrowViewport || input.coarsePointer) return false;
  if (/TVM-iOS|TVM-Android|iPhone|iPad|iPod|Android|Mobile/i.test(input.userAgent)) return false;
  if (input.connectionType === 'cellular' || input.saveData === true) return false;
  if (input.documentHidden) return false;
  return true;
}

export function readRuntimeHeroPreviewGuard(heroPreviews: boolean, reducedMotion: boolean): HeroPreviewGuardInput {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const conn = (nav as (Navigator & { connection?: { type?: string; saveData?: boolean } }) | undefined)?.connection;
  const doc = typeof document !== 'undefined' ? document : undefined;
  const win = typeof window !== 'undefined' ? window : undefined;
  return {
    heroPreviews,
    reducedMotion,
    phoneShell: doc?.documentElement.classList.contains('phone-shell') ?? false,
    userAgent: nav?.userAgent ?? '',
    narrowViewport: win?.matchMedia?.('(max-width: 47.99rem)')?.matches ?? false,
    coarsePointer: win?.matchMedia?.('(pointer: coarse)')?.matches ?? false,
    connectionType: conn?.type,
    saveData: conn?.saveData,
    documentHidden: doc?.hidden ?? false,
  };
}
