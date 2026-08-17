export const TORRENTIO_BASE = 'https://torrentio.strem.fun';
export const TORRENTIO_USER_AGENT = 'tvm-core';

function torrentioHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers(extra);
  headers.set('user-agent', TORRENTIO_USER_AGENT);
  return headers;
}

const CAM_PATTERN = /\b(cam|camrip|telesync|tsrip|hdcam|hdts)\b/i;
const CACHED_PATTERN = /⚡|\bcached\b|\brd\+|\bdownloaded\b/i;

export interface DebridStream {
  url: string;
  title: string;
  quality: number;
  cached: boolean;
}

export function torrentioBaseUrl(token: string): string {
  return `${TORRENTIO_BASE}/realdebrid=${encodeURIComponent(token)}`;
}

export function parsePlayId(id: string): { imdb: string; season?: number; episode?: number } | null {
  const match = id.trim().match(/^(tt\d+)(?::(\d+):(\d+))?$/i);
  if (match === null || match[1] === undefined) return null;
  const season = match[2] !== undefined ? Number(match[2]) : undefined;
  const episode = match[3] !== undefined ? Number(match[3]) : undefined;
  if (season !== undefined && (!Number.isFinite(season) || season < 0)) return null;
  if (episode !== undefined && (!Number.isFinite(episode) || episode < 1)) return null;
  return {
    imdb: match[1].toLowerCase(),
    ...(season !== undefined ? { season } : {}),
    ...(episode !== undefined ? { episode } : {}),
  };
}

export function extractImdb(id: string): string | null {
  const match = id.trim().match(/tt\d+/i);
  return match === null ? null : match[0].toLowerCase();
}

export function parseSeasonEpisode(id: string): { season: number; episode: number } | null {
  const match = id.trim().match(/:(\d+):(\d+)$/);
  if (match === null || match[1] === undefined || match[2] === undefined) return null;
  const season = Number(match[1]);
  const episode = Number(match[2]);
  if (!Number.isFinite(season) || !Number.isFinite(episode) || episode < 1) return null;
  return { season, episode };
}

export function torrentioStreamPaths(imdb: string, season?: number, episode?: number): string[] {
  const id = imdb.startsWith('tt') ? imdb : `tt${imdb}`;
  if (season !== undefined && episode !== undefined) {
    return [
      `stream/series/${id}:${season}:${episode}.json`,
      `stream/series/${id}:${season}:${String(episode).padStart(2, '0')}.json`,
    ];
  }
  return [`stream/movie/${id}.json`, `stream/series/${id}.json`];
}

function qualityScore(label: string): number {
  if (/\b2160p|4k|uhd\b/i.test(label)) return 40;
  if (/\b1080p\b/i.test(label)) return 30;
  if (/\b720p\b/i.test(label)) return 15;
  if (/\b480p\b/i.test(label)) return 5;
  return 10;
}

export function parseDebridStream(raw: Record<string, unknown>): DebridStream | null {
  const url = typeof raw.url === 'string' ? raw.url : '';
  if (!/^https?:\/\//i.test(url) || /failed_access|videos\/failed|copyright|infringement/i.test(url)) {
    return null;
  }
  const title = String(raw.title || raw.name || 'Stream').split('\n')[0] ?? 'Stream';
  if (CAM_PATTERN.test(title)) return null;
  return {
    url,
    title,
    quality: qualityScore(`${String(raw.name ?? '')} ${title}`),
    cached: CACHED_PATTERN.test(`${String(raw.name ?? '')} ${title}`),
  };
}

export const PLAYABLE_STREAM_LIMIT = 5;

export function streamHeight(label: string): number {
  if (/\b2160p|4k|uhd\b/i.test(label)) return 2160;
  if (/\b1080p\b/i.test(label)) return 1080;
  if (/\b720p\b/i.test(label)) return 720;
  if (/\b480p\b/i.test(label)) return 480;
  return 1080;
}

export function capStreamsToHeight(streams: readonly DebridStream[], maxHeight: number): DebridStream[] {
  const capped = streams.filter((stream) => streamHeight(`${stream.title}`) <= maxHeight);
  return capped.length > 0 ? capped : streams.filter((stream) => stream.quality <= 15);
}

export function rankDebridStreams(streams: readonly DebridStream[]): DebridStream[] {
  return [...streams].sort((left, right) => {
    if (left.cached !== right.cached) return left.cached ? -1 : 1;
    return right.quality - left.quality;
  });
}

export function pickDebridStream(streams: readonly DebridStream[]): DebridStream | null {
  const ranked = rankDebridStreams(streams);
  return ranked.find((stream) => stream.quality >= 15) ?? ranked[0] ?? null;
}

export function isTorrentioHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'torrentio.strem.fun';
  } catch {
    return false;
  }
}

const MAX_RESOLVE_HOPS = 3;

export async function resolveTorrentioUrl(url: string, fetchImpl: typeof fetch, hops = 0): Promise<string | null> {
  if (!isTorrentioHost(url)) return url;
  if (hops >= MAX_RESOLVE_HOPS) return null;
  try {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      headers: torrentioHeaders({ accept: '*/*' }),
      signal: AbortSignal.timeout(14_000),
    });
    const location = response.headers.get('location');
    if (location !== null && location !== '') {
      try {
        const next = new URL(location, url).href;
        if (isTorrentioHost(next)) return resolveTorrentioUrl(next, fetchImpl, hops + 1);
        return next;
      } catch {
        return null;
      }
    }
    if (typeof response.url === 'string' && response.url !== '' && !isTorrentioHost(response.url)) {
      return response.url;
    }
    const type = response.headers.get('content-type') ?? '';
    if (!type.toLowerCase().includes('json')) return null;
    const body = (await response.json()) as { url?: unknown };
    if (typeof body.url === 'string' && /^https?:\/\//i.test(body.url)) {
      return isTorrentioHost(body.url) ? resolveTorrentioUrl(body.url, fetchImpl, hops + 1) : body.url;
    }
    return null;
  } catch {
    return null;
  }
}

export function isLikelyDirectPlayUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/download\.real-debrid\.com/i.test(url)) return true;
  if (/real-debrid\.com\/d\//i.test(url)) return false;
  return /\.(m3u8|mp4|m4v|mkv|webm|mov)(\?|$)/i.test(url);
}

export function needsUnrestrict(url: string): boolean {
  return !isLikelyDirectPlayUrl(url);
}

export async function fetchTorrentioStreams(
  token: string,
  imdb: string,
  season: number | undefined,
  episode: number | undefined,
  fetchImpl: typeof fetch,
): Promise<DebridStream[]> {
  const base = torrentioBaseUrl(token);
  const seen = new Set<string>();
  const streams: DebridStream[] = [];
  for (const path of torrentioStreamPaths(imdb, season, episode)) {
    try {
      const response = await fetchImpl(`${base}/${path}`, {
        headers: torrentioHeaders({ accept: 'application/json' }),
        signal: AbortSignal.timeout(14_000),
      });
      if (!response.ok) continue;
      let body: { streams?: Array<Record<string, unknown>> };
      try {
        body = (await response.json()) as { streams?: Array<Record<string, unknown>> };
      } catch {
        continue;
      }
      for (const raw of body.streams ?? []) {
        const stream = parseDebridStream(raw);
        if (stream === null || seen.has(stream.url)) continue;
        seen.add(stream.url);
        streams.push(stream);
      }
      if (streams.length > 0) break;
    } catch {
      continue;
    }
  }
  return streams;
}
