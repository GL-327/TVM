import { rdTokenPath } from '../update/paths.ts';
import { hasSecretFile, readSecret, writeSecret } from './secrets.ts';
import type { ProviderManifest, RdStatus } from './types.ts';

const RD_API = 'https://api.real-debrid.com/rest/1.0';

export interface RdUser {
  username: string;
  premium: number;
  expiration: string;
}

export interface RdDownload {
  id: string;
  filename: string;
  mimeType?: string;
  filesize?: number;
  link: string;
  download?: string;
  generated?: string;
}

export interface RdUnrestrict {
  id: string;
  filename: string;
  mimeType?: string;
  filesize?: number;
  download: string;
  streamable?: number;
}

export interface RdTranscode {
  url: string;
  mimeType: string;
}

export interface RdTorrent {
  id: string;
  filename: string;
  status: string;
  progress: number;
  links: string[];
}

export interface RdTorrentInfo extends RdTorrent {
  files: Array<{ id: number; path: string; bytes: number; selected: number }>;
}

export interface RealDebrid {
  manifest(): ProviderManifest;
  configured(): boolean;
  tokenValue(): string | null;
  setToken(token: string): Promise<RdStatus>;
  status(): Promise<RdStatus>;
  downloads(): Promise<RdDownload[]>;
  torrents(): Promise<RdTorrent[]>;
  torrentInfo(id: string): Promise<RdTorrentInfo>;
  unrestrict(link: string): Promise<RdUnrestrict>;
  transcode(id: string): Promise<RdTranscode | null>;
}

export interface RealDebridOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

function redact(value: string): string {
  return value.replace(/(Bearer\s+)(\S+)/gi, '$1[redacted]');
}

function log(...parts: unknown[]): void {
  console.log(parts.map((part) => (typeof part === 'string' ? redact(part) : part)).join(' '));
}

export function createRealDebrid(options: RealDebridOptions): RealDebrid {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const { dataDir } = options;

  const token = (): string | null => {
    const path = rdTokenPath(dataDir);
    const stored = readSecret(path);
    if (stored !== null) return stored;
    // An empty file means the user cleared the token. Do not fall back to env.
    if (hasSecretFile(path)) return null;
    return env['TVM_RD_TOKEN']?.trim() ?? null;
  };

  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const secret = token();
    if (secret === null) {
      const error = new Error('not-configured');
      error.name = 'RdAuth';
      throw error;
    }

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${secret}`);
    headers.set('User-Agent', 'tvm-core');
    log('tvm-core: rd', init.method ?? 'GET', path);

    const response = await fetchImpl(`${RD_API}${path}`, { ...init, headers });
    if (response.status === 401 || response.status === 403) {
      const error = new Error('needs-auth');
      error.name = 'RdAuth';
      throw error;
    }
    if (!response.ok) {
      throw new Error(`Real-Debrid replied ${response.status}`);
    }
    return response;
  };

  const readList = async <T>(path: string): Promise<T[]> => {
    const response = await request(path);
    if (response.status === 204) return [];
    const text = await response.text();
    if (text.trim() === '') return [];
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  };

  const toStatus = (user: RdUser | null, error: string | null): RdStatus => ({
    configured: token() !== null,
    username: user?.username ?? null,
    premium: (user?.premium ?? 0) > 0,
    error,
  });

  return {
    manifest: () => ({
      id: 'rd',
      name: 'Real-Debrid',
      capabilities: ['catalog', 'meta', 'playback', 'search'],
    }),

    configured: () => token() !== null,
    tokenValue: () => token(),

    async setToken(value: string): Promise<RdStatus> {
      const trimmed = value.trim();
      writeSecret(rdTokenPath(dataDir), trimmed);
      if (trimmed === '') return toStatus(null, null);
      return this.status();
    },

    async status(): Promise<RdStatus> {
      if (token() === null) return toStatus(null, null);
      try {
        const user = (await (await request('/user')).json()) as RdUser;
        return toStatus(user, null);
      } catch (error) {
        const reason = error instanceof Error && error.name === 'RdAuth' ? 'needs-auth' : 'unreachable';
        return toStatus(null, reason);
      }
    },

    async downloads(): Promise<RdDownload[]> {
      const collected: RdDownload[] = [];
      for (let offset = 0; offset < 500; offset += 100) {
        const page = await readList<RdDownload>(`/downloads?limit=100&offset=${offset}`);
        if (page.length === 0) break;
        collected.push(...page);
        if (page.length < 100) break;
      }
      return collected;
    },

    async torrents(): Promise<RdTorrent[]> {
      const collected: RdTorrent[] = [];
      for (let page = 1; page <= 10; page += 1) {
        const batch = await readList<RdTorrent>(`/torrents?limit=100&page=${page}`);
        if (batch.length === 0) break;
        collected.push(...batch);
        if (batch.length < 100) break;
      }
      return collected;
    },

    async torrentInfo(id: string): Promise<RdTorrentInfo> {
      return (await (await request(`/torrents/info/${encodeURIComponent(id)}`)).json()) as RdTorrentInfo;
    },

    async unrestrict(link: string): Promise<RdUnrestrict> {
      const response = await request('/unrestrict/link', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ link }).toString(),
      });
      return (await response.json()) as RdUnrestrict;
    },

    async transcode(id: string): Promise<RdTranscode | null> {
      try {
        const response = await request(`/streaming/transcode/${encodeURIComponent(id)}`);
        return pickHtml5Transcode(await response.json());
      } catch {
        return null;
      }
    },
  };
}

/**
 * HTML5 wants a playlist Chromium can demux. Real-Debrid's `liveMP4` is a live
 * transcode (often MPEG-TS despite the name) — `video.src` on it play→buffer
 * loops, then TVM hands the file to mpv. HLS first keeps the browser on a
 * paced AAC ladder; liveMP4 remains the last resort.
 */
const HTML5_TRANSCODE_GROUPS = ['apple', 'h264WebM', 'liveMP4'] as const;
const TRANSCODE_GROUPS = ['liveMP4', 'h264WebM', 'apple'] as const;
const TRANSCODE_QUALITIES = ['1080', '1080p', '720', '720p', 'full', 'auto', '480', '360'];

function mimeForGroup(group: string, url: string): string {
  if (group === 'apple' || /\.m3u8(\?|$)/i.test(url)) return 'application/vnd.apple.mpegurl';
  if (group === 'h264WebM') return 'video/webm';
  if (group === 'liveMP4' && !/\.mp4(\?|$)/i.test(url)) return 'video/mp2t';
  return 'video/mp4';
}

function httpUrl(value: unknown): string | null {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
}

function pickTranscodeFrom(
  body: unknown,
  groups: readonly string[],
): RdTranscode | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;

  for (const group of groups) {
    const bucket = record[group];
    if (typeof bucket !== 'object' || bucket === null) continue;
    const map = bucket as Record<string, unknown>;
    for (const quality of TRANSCODE_QUALITIES) {
      const url = httpUrl(map[quality]);
      if (url !== null) return { url, mimeType: mimeForGroup(group, url) };
    }
    for (const value of Object.values(map)) {
      const url = httpUrl(value);
      if (url !== null) return { url, mimeType: mimeForGroup(group, url) };
    }
  }
  return null;
}

export function pickTranscode(body: unknown): RdTranscode | null {
  return pickTranscodeFrom(body, TRANSCODE_GROUPS);
}

/** HLS first so Chromium never plays Real-Debrid's live MP4/MPEG-TS as `video.src`. */
export function pickHtml5Transcode(body: unknown): RdTranscode | null {
  return pickTranscodeFrom(body, HTML5_TRANSCODE_GROUPS);
}

export function isBrowserStream(mimeType: string, url: string): boolean {
  if (/mpegurl|x-mpegurl/i.test(mimeType) || mimeType === 'video/webm' || mimeType === 'video/mp4') {
    return true;
  }
  return /\.(m3u8|mp4|m4v|webm)(\?|$)/i.test(url);
}
