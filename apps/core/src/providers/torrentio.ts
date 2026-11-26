export const TORRENTIO_BASE = 'https://torrentio.strem.fun';
export const TORRENTIO_USER_AGENT = 'tvm-core';

function torrentioHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers(extra);
  headers.set('user-agent', TORRENTIO_USER_AGENT);
  return headers;
}

const CINEMA_RECORDING = /(?:^|[^a-z0-9])(?:hd[ ._-]?)?(?:cam(?:rip)?|ts(?:rip)?|tc(?:rip)?|tele[ ._-]?(?:sync|cine))(?=$|[^a-z0-9])/i;
const PRE_RELEASE = /(?:^|[^a-z0-9])(?:screener|dvdscr(?:eener)?|scr|workprint)(?=$|[^a-z0-9])/i;
const CACHED_PATTERN = /\u26a1|\bcached\b|\brd\+|\bdownloaded\b/i;

export interface TorrentioRelease {
  title: string;
  quality: number;
  cached: boolean;
  description?: string;
  filename?: string;
  sizeBytes?: number;
  pack?: boolean;
  providerLabel?: string;
  releaseId?: string;
}

export interface DebridStream extends TorrentioRelease {
  url: string;
}

export function releaseTier(release: TorrentioRelease): 'retail' | 'cinema' | 'screener' {
  // A terminal .ts is a container extension. A TS release tag is not.
  const tags = [release.title, release.filename].map(name => name?.replace(/\.ts$/i, '')
    .replace(/^.*?\b(?:19\d{2}|20\d{2}|s\d{1,3}e\d{1,3})\b/i, ''));
  const label = [release.providerLabel, ...tags].join(' ');
  if (PRE_RELEASE.test(label)) return 'screener';
  return CINEMA_RECORDING.test(label) ? 'cinema' : 'retail';
}

export function withCinemaFallback<T extends TorrentioRelease>(releases: readonly T[]): T[] {
  const retail = releases.filter(release => releaseTier(release) === 'retail');
  return retail.length ? retail : releases.filter(release => releaseTier(release) === 'cinema');
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

export function parseTorrentioRelease(raw: Record<string, unknown>): TorrentioRelease {
  const description = typeof raw.description === 'string' ? raw.description : String(raw.title ?? '');
  const lines = description.split(/\r?\n/);
  const title = (lines[0] || String(raw.name || 'Stream')).trim();
  const name = String(raw.name ?? '');
  const hints = raw.behaviorHints as { filename?: unknown; videoSize?: unknown } | undefined;
  const filename = typeof hints?.filename === 'string' ? hints.filename :
    lines.slice(1).find(line => /\.(?:mkv|mp4|m4v|avi|webm|ts)$/i.test(line));
  const pack = !!filename && !/\bs\d{1,3}[ ._-]*e\d{1,3}\b/i.test(title) &&
    /\b(?:s\d{1,3}|seasons?|complete)\b|сезон|серии:/i.test(title);
  return {
    title,
    quality: qualityScore(`${name} ${title}`),
    cached: CACHED_PATTERN.test(name.replace(/\b(?:not[ -]cached|uncached)\b/gi, '')),
    description: [name, description].join('\n'),
    providerLabel: name.split(/\r?\n/).at(-1),
    ...(filename ? { filename } : {}),
    ...(pack ? { pack } : {}),
    ...(typeof hints?.videoSize === 'number' && Number.isSafeInteger(hints.videoSize) && hints.videoSize > 0
      ? { sizeBytes: hints.videoSize } : {}),
    ...(typeof raw.infoHash === 'string' && /^[a-f0-9]{40}$/i.test(raw.infoHash)
      ? { releaseId: `${raw.infoHash.toLowerCase()}:${Number.isInteger(raw.fileIdx) ? raw.fileIdx : ''}` } : {}),
  };
}

export function parseDebridStream(raw: Record<string, unknown>): DebridStream | null {
  const url = typeof raw.url === 'string' ? raw.url : '';
  if (!/^https?:\/\//i.test(url) || /failed_access|videos\/failed|copyright|infringement/i.test(url)) {
    return null;
  }
  return { ...parseTorrentioRelease(raw), url };
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
  const capped = streams.filter((stream) => streamHeight(stream.description ?? stream.title) <= maxHeight);
  return capped.length > 0 ? capped : streams.filter((stream) => stream.quality <= 15);
}

export function rankDebridStreams(streams: readonly DebridStream[]): DebridStream[] {
  return [...streams].sort((left, right) => {
    // A cached low resolution file should not win over a 4K source when the
    // viewer has chosen 4K. Cache status only breaks ties at one resolution.
    if (left.quality !== right.quality) return right.quality - left.quality;
    if (left.cached !== right.cached) return left.cached ? -1 : 1;
    return 0;
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

async function fetchReleases<T extends TorrentioRelease>(
  base: string,
  imdb: string,
  season: number | undefined,
  episode: number | undefined,
  fetchImpl: typeof fetch,
  parse: (raw: Record<string, unknown>) => T | null,
  identity: (release: T) => string,
): Promise<T[]> {
  const seen = new Set<string>();
  const streams: T[] = [];
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
      for (const raw of Array.isArray(body.streams) ? body.streams : []) {
        if (!raw || typeof raw !== 'object') continue;
        const stream = parse(raw);
        if (!stream || seen.has(identity(stream))) continue;
        seen.add(identity(stream));
        streams.push(stream);
      }
      if (streams.length > 0) break;
    } catch {
      continue;
    }
  }
  return streams;
}

export function fetchTorrentioStreams(token: string, imdb: string, season: number | undefined,
  episode: number | undefined, fetchImpl: typeof fetch): Promise<DebridStream[]> {
  return fetchReleases(torrentioBaseUrl(token), imdb, season, episode, fetchImpl, parseDebridStream, stream => stream.url);
}

/** Public listings contain release metadata only. Playback still requires a resolved Debrid link. */
export function fetchTorrentioReleases(imdb: string, season: number | undefined,
  episode: number | undefined, fetchImpl: typeof fetch): Promise<TorrentioRelease[]> {
  return fetchReleases(TORRENTIO_BASE, imdb, season, episode, fetchImpl,
    raw => typeof raw.infoHash === 'string' ? parseTorrentioRelease(raw) : null,
    release => release.releaseId ?? release.description ?? release.title);
}
