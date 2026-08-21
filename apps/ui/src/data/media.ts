import { TITLES, type Title } from './catalog';
import { preferBackdrop, preferPoster } from './artwork';
import { imdbScore } from './playId';
import { normalizeTitle, titlesMatch } from './matchTitle';
import { asSeason } from './seasons';

export { normalizeTitle };

export interface MediaItem {
  id: string;
  title: string;
  year: number | null;
  kind: 'movie' | 'series' | 'file';
  synopsis: string;
  poster: string;
  backdrop: string;
  genres: string[];
  rating: string;
  runtime?: string;
  playable: boolean;
  progress?: number;
  filename?: string;
  hue: number;
  mimeType?: string;
  season?: number;
  episode?: number;
  episodeName?: string;
  showTitle?: string;
  aired?: string;
}

export interface RdStatus {
  configured: boolean;
  username: string | null;
  premium: boolean;
  error: string | null;
}

export interface CatalogRail {
  id: string;
  title: string;
  items: MediaItem[];
}

export interface HomePayload {
  rd: RdStatus;
  featured: MediaItem | null;
  library: MediaItem[];
  continueWatching: MediaItem[];
  watchlist: MediaItem[];
  fileCount: number;
  rails?: CatalogRail[];
}

export interface LiveChannel {
  id: string;
  name: string;
  url?: string;
  group?: string;
  logo?: string;
  picked?: boolean;
}

export interface LiveGroup {
  name: string;
  count: number;
  picked: number;
}

export interface LiveStatus {
  url: string | null;
  host?: string | null;
  username?: string | null;
  configured?: boolean;
  channels: LiveChannel[];
  error: string | null;
  picked?: number;
  total?: number;
  groups?: LiveGroup[];
  needsPicks?: boolean;
  pickLimit?: number;
}

export interface LiveCatalogPage {
  items: LiveChannel[];
  groups: LiveGroup[];
  total: number;
  matched: number;
  offset: number;
  limit: number;
  picked: number;
  pickLimit: number;
  query: string;
  group: string | null;
}

export type StreamTransport = 'direct' | 'hls-session' | 'hls' | 'ts-live' | 'file';

export type PlaybackResult =
  | {
      kind: 'stream';
      url: string;
      title: string;
      filename: string;
      mimeType: string;
      engine: 'html5' | 'native';
      startAt?: number;
      /** How core delivers the bytes; decides the engine attach path. */
      transport?: StreamTransport;
      /** Present when transport is `hls-session`; drives seek/stop endpoints. */
      sessionId?: string;
      /** Movie time of the session's first second; engine adds it to element time. */
      timeOffset?: number;
      /** Probed duration for in-flight HLS sessions. */
      durationSeconds?: number;
      fallbackUrl?: string;
      fallbackEngine?: 'html5' | 'native';
    }
  | { kind: 'unavailable'; reason: string };

export function toMediaItem(title: Title): MediaItem {
  return {
    id: title.id,
    title: title.title,
    year: title.year > 0 ? title.year : null,
    kind: title.kind,
    synopsis: title.synopsis,
    poster: title.poster,
    backdrop: title.backdrop,
    genres: [...title.genres],
    rating: title.rating,
    runtime: title.runtime,
    playable: title.playable === true,
    hue: title.hue,
  };
}

export function asTitle(item: MediaItem): Title {
  const episodeLabel =
    item.season !== undefined && item.episode !== undefined ? `S${item.season} E${item.episode}` : undefined;
  const base: Title = {
    id: item.id,
    title: item.showTitle ?? item.title,
    year: item.year ?? 0,
    kind: item.kind === 'series' || episodeLabel !== undefined || item.season !== undefined ? 'series' : 'movie',
    synopsis: item.synopsis !== '' ? item.synopsis : item.playable ? 'Ready to play.' : '',
    poster: preferPoster(item.id, item.poster, item.backdrop),
    backdrop: preferBackdrop(item.id, item.backdrop, item.poster),
    genres: item.genres,
    rating: item.rating,
    runtime: episodeLabel ?? item.runtime,
    hue: item.hue,
    progress: item.progress,
    playable: item.playable,
    episodeLabel,
  };
  const names = [item.title, item.showTitle ?? '', item.filename ?? ''];
  let match: Title | undefined;
  let matchLength = 0;
  for (const catalog of TITLES) {
    if (!names.some((name) => titlesMatch(catalog.title, name))) continue;
    if (catalog.title.length > matchLength) {
      match = catalog;
      matchLength = catalog.title.length;
    }
  }
  if (match === undefined) return base;
  if (/^tt\d+/i.test(item.id)) {
    return {
      ...base,
      kind: base.kind === 'series' || match.kind === 'series' ? 'series' : match.kind,
      poster: base.poster !== '' ? base.poster : match.poster,
      backdrop: base.backdrop !== '' ? base.backdrop : match.backdrop,
    };
  }
  return {
    ...base,
    title: match.title,
    poster: base.poster !== '' ? base.poster : match.poster,
    backdrop: base.backdrop !== '' ? base.backdrop : match.backdrop,
    synopsis: match.synopsis,
    rating: imdbScore(base.rating) !== null ? base.rating : match.rating !== '' ? match.rating : base.rating,
    genres: match.genres,
    runtime: episodeLabel ?? match.runtime ?? base.runtime,
    year: base.year > 0 ? base.year : match.year,
    hue: match.hue,
    kind: base.kind === 'series' || episodeLabel !== undefined || match.kind === 'series' ? 'series' : 'movie',
    episodeLabel,
  };
}

let lastHome: HomePayload | null = null;
let activeProfileId = '';

export function peekHome(): HomePayload | null {
  return lastHome;
}

export function invalidateHome(): void {
  lastHome = null;
}

export function setActiveProfileId(id: string): void {
  if (activeProfileId === id) return;
  activeProfileId = id;
  lastHome = null;
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (activeProfileId !== '') headers.set('X-TVM-Profile', activeProfileId);
  return fetch(input, { ...init, headers });
}

export function looksLikePack(title: string, filename = ''): boolean {
  const name = `${title} ${filename}`;
  if (/\bS\d{1,2}[\s._-]*E\d{1,2}\s*[-–]\s*E?\d{1,2}\b/i.test(name) || /\bS\d{1,2}\s*[-–]\s*S?\d{1,2}\b/i.test(name)) {
    return true;
  }
  if (/\bS\d{1,2}[\s._-]*E\d{1,2}\b/i.test(name)) return false;
  return /\b(S\d{1,2}|season|seasons|complete|collection|box\s*set|temporada)\b/i.test(name);
}

export function matchPlayback(title: Title, library: readonly MediaItem[]): string | null {
  return matchLibraryItems(title, library)[0]?.id ?? null;
}

export function matchLibraryItems(title: Title, library: readonly MediaItem[]): MediaItem[] {
  return library.filter((item) =>
    [item.showTitle ?? '', item.title, item.filename ?? ''].some((name) => titlesMatch(title.title, name)),
  );
}

export function packIdFor(title: Title, library: readonly MediaItem[]): string | null {
  const matches = matchLibraryItems(title, library);
  const pack = matches.find((item) => looksLikePack(item.title, item.filename ?? '') && item.id.startsWith('rd:t:'));
  if (pack !== undefined) return pack.id;
  return matches.find((item) => item.id.startsWith('rd:t:'))?.id ?? null;
}

export function uniqueShows(items: readonly MediaItem[]): Title[] {
  const seen = new Set<string>();
  const out: Title[] = [];
  for (const item of items) {
    const title = asTitle(item);
    const key = normalizeTitle(title.title);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

export function sortEpisodes(items: readonly MediaItem[]): MediaItem[] {
  return [...items].sort((left, right) => {
    const season = (left.season ?? 99) - (right.season ?? 99);
    if (season !== 0) return season;
    return (left.episode ?? 99) - (right.episode ?? 99);
  });
}

export async function fetchRdStatus(): Promise<RdStatus | null> {
  try {
    const response = await apiFetch('/api/rd/status');
    if (!response.ok) return null;
    return (await response.json()) as RdStatus;
  } catch {
    return null;
  }
}

export async function saveRdToken(token: string): Promise<RdStatus> {
  const response = await apiFetch('/api/rd/token', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const body = (await response.json()) as RdStatus & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? 'The token was not stored.');
  }
  lastHome = null;
  return body;
}

export async function clearRdToken(): Promise<RdStatus> {
  return saveRdToken('');
}

export async function fetchHome(): Promise<HomePayload | null> {
  try {
    const response = await apiFetch('/api/home');
    if (!response.ok) return lastHome;
    const payload = (await response.json()) as HomePayload;
    lastHome = payload;
    return payload;
  } catch {
    return lastHome;
  }
}

export async function fetchLibrary(): Promise<MediaItem[]> {
  try {
    const response = await apiFetch('/api/library');
    if (!response.ok) return [];
    const body = (await response.json()) as { items?: MediaItem[] };
    return body.items ?? [];
  } catch {
    return [];
  }
}

export async function fetchMedia(id: string): Promise<MediaItem | null> {
  try {
    const response = await apiFetch(`/api/media?id=${encodeURIComponent(id)}`);
    if (!response.ok) return null;
    return (await response.json()) as MediaItem;
  } catch {
    return null;
  }
}

export async function searchLibrary(query: string): Promise<MediaItem[]> {
  const response = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) return [];
  const body = (await response.json()) as { items?: MediaItem[] };
  return body.items ?? [];
}

export async function requestPlayback(input: {
  id?: string;
  link?: string;
  title?: string;
  season?: number;
  episode?: number;
}): Promise<PlaybackResult> {
  try {
    const response = await apiFetch('/api/playback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as {
      kind?: string;
      error?: string;
      reason?: string;
    } & Partial<Extract<PlaybackResult, { kind: 'stream' }>>;
    if (body.kind === 'stream') return body as Extract<PlaybackResult, { kind: 'stream' }>;
    if (body.kind === 'unavailable') {
      return { kind: 'unavailable', reason: typeof body.reason === 'string' && body.reason !== '' ? body.reason : 'internal' };
    }
    return {
      kind: 'unavailable',
      reason: typeof body.error === 'string' && body.error !== '' ? body.error : 'internal',
    };
  } catch {
    return { kind: 'unavailable', reason: 'network' };
  }
}

export async function saveProgress(id: string, position: number, duration: number): Promise<void> {
  await apiFetch('/api/progress', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, position, duration }),
  });
}

export async function fetchChildren(id: string): Promise<MediaItem[]> {
  try {
    const response = await apiFetch(`/api/media/children?id=${encodeURIComponent(id)}`);
    if (!response.ok) return [];
    const body = (await response.json()) as { items?: MediaItem[] };
    return (body.items ?? []).map((item) => {
      const season = asSeason(item.season);
      const episode = asSeason(item.episode);
      return {
        ...item,
        ...(season !== undefined ? { season } : {}),
        ...(episode !== undefined ? { episode } : {}),
      };
    });
  } catch {
    return [];
  }
}

export async function fetchWatchlist(): Promise<MediaItem[]> {
  try {
    const response = await apiFetch('/api/watchlist');
    if (!response.ok) return [];
    const body = (await response.json()) as { items?: MediaItem[] };
    return body.items ?? [];
  } catch {
    return [];
  }
}

export async function addWatchlist(item: MediaItem): Promise<MediaItem[]> {
  const response = await apiFetch('/api/watchlist', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ item }),
  });
  const body = (await response.json()) as { items?: MediaItem[] };
  return body.items ?? [];
}

export async function removeWatchlist(id: string): Promise<MediaItem[]> {
  const response = await apiFetch('/api/watchlist/remove', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const body = (await response.json()) as { items?: MediaItem[] };
  return body.items ?? [];
}

export async function fetchLive(): Promise<LiveStatus | null> {
  try {
    const response = await apiFetch('/api/live');
    if (!response.ok) return null;
    return (await response.json()) as LiveStatus;
  } catch {
    return null;
  }
}

export async function saveLivePlaylist(input: string | { url?: string; text?: string }): Promise<LiveStatus> {
  const body = typeof input === 'string' ? { url: input } : input;
  const response = await apiFetch('/api/live', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json()) as LiveStatus;
}

export async function saveXtream(input: { host: string; username: string; password: string }): Promise<LiveStatus> {
  const response = await apiFetch('/api/live/xtream', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as LiveStatus & { error?: string };
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : 'The login was not stored.');
  }
  return body;
}

export async function clearXtream(): Promise<LiveStatus> {
  const response = await apiFetch('/api/live/xtream', { method: 'DELETE' });
  return (await response.json()) as LiveStatus;
}

export async function fetchLiveCatalog(query: {
  q?: string;
  group?: string;
  offset?: number;
  limit?: number;
}): Promise<LiveCatalogPage> {
  const params = new URLSearchParams();
  if (query.q !== undefined && query.q !== '') params.set('q', query.q);
  if (query.group !== undefined && query.group !== '') params.set('group', query.group);
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const response = await apiFetch(`/api/live/catalog${suffix}`);
  return (await response.json()) as LiveCatalogPage;
}

export async function toggleLivePick(id: string, picked: boolean): Promise<LiveStatus> {
  const response = await apiFetch('/api/live/picks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, picked }),
  });
  return (await response.json()) as LiveStatus;
}

export async function setLiveGroupPicks(group: string, picked: boolean): Promise<LiveStatus> {
  const response = await apiFetch('/api/live/picks/group', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ group, picked }),
  });
  return (await response.json()) as LiveStatus;
}

export async function clearCache(): Promise<void> {
  await apiFetch('/api/maintenance/clear-cache', { method: 'POST' });
  lastHome = null;
}

export async function factoryReset(): Promise<void> {
  await apiFetch('/api/maintenance/factory-reset', { method: 'POST' });
  lastHome = null;
  activeProfileId = '';
}

export interface SessionStatus {
  appliance: boolean;
  mode: 'kiosk' | 'desktop' | 'unknown';
}

export async function fetchSession(): Promise<SessionStatus> {
  try {
    const response = await apiFetch('/api/system/session');
    if (!response.ok) return { appliance: false, mode: 'unknown' };
    return (await response.json()) as SessionStatus;
  } catch {
    return { appliance: false, mode: 'unknown' };
  }
}

export async function requestSession(mode: 'kiosk' | 'desktop'): Promise<{ ok: boolean; reason?: string }> {
  try {
    const response = await apiFetch('/api/system/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    return (await response.json()) as { ok: boolean; reason?: string };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
