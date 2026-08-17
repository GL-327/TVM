export function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const TITLE_CUT =
  /\b(?:s(?:eason)?[\s._-]*\d{1,2}(?:[\s._-]*e[\s._-]*\d{1,2})?|\d{1,2}x\d{1,2}|season[\s._-]*\d{1,2}|(?:19|20)\d{2}|\d{3,4}p|2160p|1080p|720p|480p|4k|uhd|complete|collection|box\s*set|bluray|webrip|webdl|web-dl)\b/i;

/** Drop episode titles, codecs and years so a catalog name can match a release. */
export function releaseTitleHead(value: string): string {
  const spaced = value.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const match = spaced.match(TITLE_CUT);
  if (match === null || match.index === undefined || match.index < 2) return spaced;
  const head = spaced.slice(0, match.index).trim();
  return head.length >= 2 ? head : spaced;
}

const RELEASE = new Set([
  'complete',
  'season',
  'series',
  'collection',
  'boxset',
  '1080p',
  '2160p',
  '720p',
  '480p',
  '4k',
  'uhd',
  'hdr',
  'bluray',
  'webrip',
  'webdl',
  'web',
  'hdtv',
  'bdrip',
  'x264',
  'x265',
  'h264',
  'h265',
  'hevc',
  'avc',
  'proper',
  'repack',
  'extended',
  'remux',
  'mkv',
  'mp4',
  'avi',
  'mov',
  'm4v',
  'ts',
  'm2ts',
  'wmv',
]);

function isNoise(token: string): boolean {
  if (RELEASE.has(token)) return true;
  if (/^s\d{1,2}(e\d{1,2})?$/.test(token)) return true;
  if (/^\d{1,2}x\d{1,2}$/.test(token)) return true;
  if (/^\d{3,4}p$/.test(token)) return true;
  if (/^(19|20)\d{2}$/.test(token)) return true;
  return false;
}

export function titleTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[._]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !isNoise(token));
}

/**
 * A catalog title matches a cloud filename only when the catalog words appear
 * as a contiguous run, with no extra title after them. "Last" must not steal
 * "The Last of Us", and "The Boys" must not steal "The Boys in the Boat".
 */
export function titlesMatch(catalogTitle: string, libraryName: string): boolean {
  const needle = titleTokens(catalogTitle);
  const hay = titleTokens(releaseTitleHead(libraryName));
  if (needle.length === 0 || hay.length === 0) return false;
  if (needle.join('').length < 4) return false;

  for (let start = 0; start <= hay.length - needle.length; start += 1) {
    if (!needle.every((token, index) => hay[start + index] === token)) continue;
    const before = hay.slice(0, start);
    const after = hay.slice(start + needle.length);
    if (after.length > 0) continue;
    if (before.length === 0) return true;
    if (before.length === 1 && (before[0] === 'the' || needle.length === 1)) return true;
  }
  return false;
}
