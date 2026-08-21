import { randomBytes } from 'node:crypto';

const HOP_TTL_MS = 6 * 60 * 60 * 1000;

export interface MediaHop {
  url: string;
  playlist: boolean;
  expires: number;
  mimeType?: string;
}

export type HopMint = (url: string, playlist?: boolean, mimeType?: string) => string;

const hops = new Map<string, MediaHop>();

function pruneHops(now = Date.now()): void {
  for (const [token, hop] of hops) {
    if (hop.expires <= now) hops.delete(token);
  }
}

export function mintHop(url: string, playlist = isHlsPlaylist(url, ''), mimeType = ''): string {
  pruneHops();
  const token = randomBytes(12).toString('hex');
  hops.set(token, {
    url,
    playlist,
    expires: Date.now() + HOP_TTL_MS,
    ...(mimeType !== '' ? { mimeType } : {}),
  });
  return `/api/live/hop/${token}`;
}

export function hopRecord(token: string): MediaHop | null {
  const hop = hops.get(token);
  if (hop === undefined) return null;
  if (hop.expires <= Date.now()) {
    hops.delete(token);
    return null;
  }
  return hop;
}

export function hopTarget(token: string): string | null {
  return hopRecord(token)?.url ?? null;
}

export function liveStreamPath(id: string): string {
  return `/api/live/stream/${encodeURIComponent(id)}`;
}

/**
 * Same-origin hop so the desktop player can load a remote live playlist
 * without CORS, and so panel credentials never reach the player.
 *
 * On-demand Real-Debrid media is deliberately not hopped: re-buffering a whole
 * movie through Node starves the media element into a play→buffer loop, and
 * Real-Debrid already serves those URLs with permissive CORS.
 */
export function hopRemoteHls(url: string, mimeType = ''): string {
  if (url.startsWith('/')) return url;
  if (!isHlsPlaylist(url, mimeType)) return url;
  return mintHop(url, true, mimeType);
}

export function isHlsPlaylist(url: string, contentType: string): boolean {
  if (/mpegurl|x-mpegurl|vnd\.apple\.mpegurl/i.test(contentType)) return true;
  return /\.m3u8(\?|$)/i.test(url);
}

export function looksLikeHlsBody(text: string): boolean {
  const start = text.trimStart();
  return start.startsWith('#EXTM3U') || start.startsWith('#EXT-X-');
}

export function looksLikeHlsBytes(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.byteLength, 64);
  let text = '';
  for (let i = 0; i < n; i += 1) {
    const code = bytes[i];
    if (code === undefined || code === 0) break;
    if (code < 9) return false;
    text += String.fromCharCode(code);
  }
  return looksLikeHlsBody(text);
}

export function looksLikeMpegTs(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) return false;
  if (bytes[0] === 0x47) return true;
  return bytes.byteLength > 4 && bytes[4] === 0x47;
}

/** Bounded Range probes (`bytes=0-511`) answer with this many bytes. */
export const HEAD_PROBE_BYTES = 512;

/** File size from `Content-Range: bytes 0-511/9999`. Unknown (`*`) → null. */
export function totalFromContentRange(contentRange: string | null | undefined): string | null {
  if (contentRange === null || contentRange === undefined || contentRange === '') return null;
  const match = /\/(\d+)\s*$/.exec(contentRange);
  return match?.[1] ?? null;
}

/**
 * Entity size for a HEAD/probe response. Range windows (`bytes=0-511`) return
 * Content-Length 512 — Chromium then treats the file as 512 bytes, plays one
 * frame, and buffer→play loops forever. Prefer Content-Range's total; if the
 * advertised length is the probe window, omit it (unknown is safer than wrong).
 */
export function probeContentLength(
  contentLength: string | null | undefined,
  contentRange: string | null | undefined,
): string | null {
  const total = totalFromContentRange(contentRange);
  if (total !== null) return total;
  if (contentRange !== null && contentRange !== undefined && contentRange !== '') return null;
  if (contentLength === null || contentLength === undefined || contentLength === '') return null;
  const size = Number(contentLength);
  if (Number.isFinite(size) && size <= HEAD_PROBE_BYTES) return null;
  return contentLength;
}

/** Mime stored on a hop so later GETs can skip a first-byte sniff. */
export function hopMediaType(url: string, playlist = false): string {
  if (playlist || isHlsPlaylist(url, '')) return 'application/vnd.apple.mpegurl';
  if (/\.(ts|m2ts)(\?|$)/i.test(url)) return 'video/mp2t';
  if (/\.(mp4|m4s|m4v|cmfv|cmfa)(\?|$)/i.test(url)) return 'video/mp4';
  if (/\.webm(\?|$)/i.test(url)) return 'video/webm';
  return '';
}

/**
 * RangeLoader / mpegts.js Range GETs and hops that already know their mime
 * must pipe immediately. Waiting on a 24-byte sniff stalls the first chunk.
 */
export function skipMediaSniff(hintType: string, hasRange: boolean): boolean {
  if (hasRange) return true;
  const mime = (hintType.split(';')[0] ?? '').trim().toLowerCase();
  return mime === 'video/mp4' || mime === 'video/mp2t' || mime === 'video/webm' || mime === 'video/iso.segment';
}

/** Chromium will not play `application/octet-stream` even when the bytes are MP4. */
export function browserMediaType(contentType: string, playlist: boolean): string {
  if (playlist) return 'application/vnd.apple.mpegurl';
  const mime = contentType.split(';')[0]?.trim() ?? '';
  if (/mp2t|mpegts|mpeg2-ts/i.test(mime)) return 'video/mp2t';
  if (mime === '' || /octet-stream|binary|force-download|encrypted/i.test(mime)) return 'video/mp4';
  return mime;
}

function rewriteUriAttr(line: string, base: URL, mint: HopMint): string {
  return line.replace(/URI="([^"]+)"/gi, (_match, uri: string) => {
    try {
      const absolute = new URL(uri, base).href;
      const playlist = isHlsPlaylist(absolute, '');
      return `URI="${mint(absolute, playlist, hopMediaType(absolute, playlist))}"`;
    } catch {
      return _match;
    }
  });
}

/** Point every media URI at a Core hop so panel passwords never reach the player. */
export function rewriteHlsPlaylist(text: string, playlistUrl: string, mint: HopMint = mintHop): string {
  let base: URL;
  try {
    base = new URL(playlistUrl);
  } catch {
    return text;
  }
  let nextIsPlaylist = false;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === '') return line;
      if (trimmed.startsWith('#')) {
        nextIsPlaylist = /#EXT-X-STREAM-INF\b/i.test(trimmed) || /#EXT-X-I-FRAME-STREAM-INF\b/i.test(trimmed);
        return rewriteUriAttr(line, base, mint);
      }
      try {
        const absolute = new URL(trimmed, base).href;
        const playlist = nextIsPlaylist || isHlsPlaylist(absolute, '');
        nextIsPlaylist = false;
        return mint(absolute, playlist, hopMediaType(absolute, playlist));
      } catch {
        nextIsPlaylist = false;
        return line;
      }
    })
    .join('\n');
}
