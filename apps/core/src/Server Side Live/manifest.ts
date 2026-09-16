/**
 * Rewriting an HLS manifest so nothing inside it points off this machine.
 *
 * This is the "reflect" half of the proxy. Fetching a manifest through Core
 * and handing it to a player unchanged achieves nothing: the player reads the
 * segment URLs inside it and goes straight to the provider, which is the CORS
 * failure, the missing-Referer 403 and the credential leak all at once. Every
 * URL in the body has to be replaced with a Core token before the body is
 * served.
 *
 * "Every URL" is wider than it sounds. Segments sit on their own lines, but
 * variant playlists, AES-128 key files, fMP4 initialisation segments and
 * alternate audio renditions all hide in URI="..." attributes, and a manifest
 * that rewrites the segments but not the key URI leaks the provider host on
 * the very first decryption. They are handled together below for that reason.
 */

export type MintUrl = (url: string, playlist: boolean, mimeType: string) => string;

/** Attributes that carry a URL. EXT-X-KEY is the one that is easy to forget. */
const URI_ATTRIBUTE = /URI="([^"]*)"/gi;

/** Tags whose *next* non-comment line is a playlist rather than a segment. */
const VARIANT_TAG = /^#EXT-X-(?:STREAM-INF|I-FRAME-STREAM-INF)\b/i;

export function isHlsPlaylistUrl(url: string, contentType = ''): boolean {
  if (/mpegurl|x-mpegurl|vnd\.apple\.mpegurl/i.test(contentType)) return true;
  return /\.m3u8(\?|$)/i.test(url);
}

export function looksLikeManifest(text: string): boolean {
  const head = text.trimStart();
  return head.startsWith('#EXTM3U') || head.startsWith('#EXT-X-');
}

/** Best guess at what a URL will serve, so the proxy can answer HEAD without a sniff. */
export function guessMediaType(url: string, playlist = false): string {
  if (playlist || isHlsPlaylistUrl(url)) return 'application/vnd.apple.mpegurl';
  if (/\.(ts|m2ts)(\?|$)/i.test(url)) return 'video/mp2t';
  if (/\.(mp4|m4s|m4v|cmfv|cmfa)(\?|$)/i.test(url)) return 'video/mp4';
  if (/\.webm(\?|$)/i.test(url)) return 'video/webm';
  if (/\.(aac|m4a)(\?|$)/i.test(url)) return 'audio/aac';
  if (/\.key(\?|$)/i.test(url)) return 'application/octet-stream';
  return '';
}

function absolute(reference: string, base: URL): string | null {
  const trimmed = reference.trim();
  if (trimmed === '') return null;
  try {
    return new URL(trimmed, base).href;
  } catch {
    return null;
  }
}

function rewriteAttributes(line: string, base: URL, mint: MintUrl): string {
  return line.replace(URI_ATTRIBUTE, (whole, uri: string) => {
    const target = absolute(uri, base);
    if (target === null) return whole;
    // A key URI is not a playlist even when the manifest that names it is.
    const playlist = isHlsPlaylistUrl(target);
    return `URI="${mint(target, playlist, guessMediaType(target, playlist))}"`;
  });
}

/**
 * Rewrite one manifest.
 *
 * `manifestUrl` is the *upstream* address the body came from, not the proxy
 * address the client asked for — relative segment paths resolve against where
 * the manifest actually lives, and resolving them against the Core URL would
 * produce segment tokens pointing back at Core in a loop.
 */
export function rewriteManifest(text: string, manifestUrl: string, mint: MintUrl): string {
  let base: URL;
  try {
    base = new URL(manifestUrl);
  } catch {
    return text;
  }

  let nextLineIsVariant = false;
  const lines = text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (trimmed === '') return line;

    if (trimmed.startsWith('#')) {
      if (VARIANT_TAG.test(trimmed)) nextLineIsVariant = true;
      return rewriteAttributes(line, base, mint);
    }

    const target = absolute(trimmed, base);
    if (target === null) {
      nextLineIsVariant = false;
      return line;
    }
    const playlist = nextLineIsVariant || isHlsPlaylistUrl(target);
    nextLineIsVariant = false;
    return mint(target, playlist, guessMediaType(target, playlist));
  });

  return lines.join('\n');
}

/**
 * Does this body still mention a host other than the proxy?
 *
 * Used by the test that proves the reflect is complete. A rewrite that misses
 * one URI is not a partial success — it is a leak of the provider address on
 * the first request the player makes.
 */
export function remainingAbsoluteUrls(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) {
      for (const match of trimmed.matchAll(URI_ATTRIBUTE)) {
        const uri = match[1] ?? '';
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) found.push(uri);
      }
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) found.push(trimmed);
  }
  return found;
}
