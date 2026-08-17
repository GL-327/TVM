const JUNK =
  /\b(1080p|720p|2160p|480p|4k|uhd|hdr10\+?|hdr|dv|webrip|web-?dl|bluray|blu-ray|bdrip|brrip|hdrip|dvdrip|bdremux|x264|x265|h264|h265|hevc10?|avc|aac|dts|truehd|atmos|remux|proper|repack|extended|unrated|directors?\.?cut|multi|subbed|dubbed|internal|limited|complete|season|s\d{1,2}e\d{1,2}|e\d{1,2}|ita|eng|spa|subs?|dlmux|oxtorrent|eztv|rartv|rarbg|yts|yify|tgx|10bit|imax|nvenc|web)\b/gi;

const EPISODE_RANGE =
  /\bS\d{1,2}[\s._-]*E\d{1,2}\s*[-–]\s*E?\d{1,2}\b/i;
const SEASON_SPAN = /\bS\d{1,2}\s*[-–]\s*S?\d{1,2}\b/i;

export function isEpisodeRange(name: string): boolean {
  return EPISODE_RANGE.test(name) || SEASON_SPAN.test(name);
}

export function looksLikePack(title: string, filename = ''): boolean {
  const name = `${title} ${filename}`;
  if (isEpisodeRange(name)) return true;
  if (/\bS\d{1,2}[\s._-]*E\d{1,2}\b/i.test(name)) return false;
  return /\b(S\d{1,2}|season|seasons|complete|collection|box\s*set|temporada)\b/i.test(name);
}

export function parseSeason(filename: string): number | null {
  const match =
    filename.match(/\bS(?:eason)?[\s._-]*(\d{1,2})\b/i) ??
    filename.match(/\bSeason[\s._-]*(\d{1,2})\b/i);
  if (match === null) return null;
  const season = Number(match[1]);
  return Number.isFinite(season) && season > 0 ? season : null;
}

export function parseEpisode(filename: string): { season: number; episode: number } | null {
  if (isEpisodeRange(filename)) return null;
  const match =
    filename.match(/\bS(\d{1,2})[\s._-]*E(\d{1,2})\b/i) ??
    filename.match(/\b(\d{1,2})x(\d{1,2})\b/i) ??
    filename.match(/\bSeason[\s._-]*(\d{1,2})\D{0,20}(?:Episode|Ep)[\s._-]*(\d{1,2})\b/i);
  if (match === null) return null;
  const season = Number(match[1]);
  const episode = Number(match[2]);
  if (!Number.isFinite(season) || !Number.isFinite(episode) || season < 1 || episode < 1) return null;
  return { season, episode };
}

/** Chapter name after SxxExx, if the release included one. */
export function parseEpisodeTitle(filename: string): string | null {
  const spaced = filename
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = spaced.match(/\bS\d{1,2}[\s._-]*E\d{1,2}\b(.*)$/i);
  if (match === null || match[1] === undefined) return null;
  const rest = match[1]
    .replace(/^[\s\-–:._]+/, '')
    .replace(/\b(?:\d{3,4}p|2160p|1080p|720p|480p|4k|uhd|hdr|webrip|web-?dl|bluray|x264|x265|h264|h265|hevc)\b.*$/i, '')
    .replace(JUNK, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (rest.length < 2 || rest.length > 52) return null;
  return rest;
}

export function episodeLabel(season: number, episode: number): string {
  return `S${season} E${episode}`;
}

const TITLE_CUT =
  /\b(?:S(?:eason)?[\s._-]*\d{1,2}(?:[\s._-]*E[\s._-]*\d{1,2})?|\d{1,2}x\d{1,2}|Season[\s._-]*\d{1,2})\b/i;

/** Filename text before season/episode/year so episode names do not become the title. */
export function releaseTitleHead(filename: string): string {
  const spaced = filename
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const episodeAt = spaced.search(TITLE_CUT);
  const yearAt = spaced.search(/\b(?:19|20)\d{2}\b/);
  const qualityAt = spaced.search(
    /\b(?:\d{3,4}p|2160p|1080p|720p|480p|4k|uhd|complete|collection|box\s*set|bluray|webrip|web-?dl)\b/i,
  );
  const cuts = [episodeAt, yearAt, qualityAt].filter((index) => index > 0);
  if (cuts.length === 0) return spaced;
  const head = spaced.slice(0, Math.min(...cuts)).trim();
  return head.length >= 2 ? head : spaced;
}

export function parseFilename(filename: string): { title: string; year: number | null } {
  const base = filename
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\{[^}]*}/g, ' ')
    .replace(/\([^)]*www[^)]*\)/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s-\s?[A-Za-z0-9@]+$/g, ' ');
  const yearMatch = base.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch !== null ? Number(yearMatch[0]) : null;
  const head = releaseTitleHead(base);
  const title = head.replace(JUNK, ' ').replace(/\s+/g, ' ').trim() || base.trim() || filename;
  return { title, year };
}

export function isDisplayTitle(title: string): boolean {
  if (title.length < 2 || title.length > 46) return false;
  if (/[\[\]{}]/.test(title)) return false;
  if (/\b(s\d|e\d|1080|2160|webrip)\b/i.test(title)) return false;
  return true;
}

export function hueFor(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

const SKIP = /\.(srt|idx|sub|nfo|txt|jpg|jpeg|png|gif|bmp|exe|zip|rar|7z|iso|sfv|md5|url)$/i;

export function isVideoFile(filename: string, mimeType?: string): boolean {
  if (mimeType !== undefined && mimeType.startsWith('video/')) return true;
  return /\.(mp4|m4v|mkv|webm|mov|avi|wmv|ts|m2ts|mpg|mpeg)$/i.test(filename);
}

/** Keep likely videos; drop subtitles and junk. Unknown extensions stay in. */
export function isPlayableFile(filename: string, mimeType?: string): boolean {
  if (mimeType !== undefined && mimeType.startsWith('audio/')) return false;
  if (SKIP.test(filename)) return false;
  return true;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const RELEASE_NOISE = new Set([
  'complete',
  'season',
  'seasons',
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
  'x264',
  'x265',
  'h264',
  'h265',
  'hevc',
  'mkv',
  'mp4',
]);

function titleTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[._]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((token) => {
      if (token.length === 0 || RELEASE_NOISE.has(token)) return false;
      if (/^s\d{1,2}(e\d{1,2})?$/.test(token)) return false;
      if (/^\d{3,4}p$/.test(token)) return false;
      if (/^(19|20)\d{2}$/.test(token)) return false;
      return true;
    });
}

/** Catalog name vs a parsed title or release filename. */
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
