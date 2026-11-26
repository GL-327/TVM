import { createHash } from 'node:crypto';
import type { CorePrefs } from '../prefs.ts';
import type { DebridStream } from './torrentio.ts';

export interface PlaybackClient {
  player: 'mpv' | 'html5' | 'exoplayer' | 'avplayer' | 'roku';
  maxHeight?: number;
  hevc?: boolean;
  hdr?: boolean;
  mkv?: boolean;
}

export interface Version {
  id: string;
  label: string;
  height: number | null;
  hdr: 'dv' | 'hdr10+' | 'hdr10' | 'hlg' | null;
  source: 'remux' | 'bluray' | 'web-dl' | 'webrip' | 'hdtv' | 'other';
  codec: string | null;
  sizeBytes: number | null;
  bitrateMbps: number | null;
  audio: { codec: string | null; channels: string | null; atmos: boolean };
  languages: string[];
  upscaled: boolean;
  cached: boolean;
  recommended: boolean;
}

const ISO: Record<string, string> = {
  ar: 'ara', be: 'bel', bg: 'bul', bn: 'ben', ca: 'cat', cs: 'ces', cy: 'cym', da: 'dan', de: 'deu',
  el: 'ell', en: 'eng', es: 'spa', et: 'est', eu: 'eus', fa: 'fas', fi: 'fin', fr: 'fra', ga: 'gle',
  gl: 'glg', gu: 'guj', he: 'heb', hi: 'hin', hr: 'hrv', hu: 'hun', id: 'ind', is: 'isl', it: 'ita',
  ja: 'jpn', ka: 'kat', kk: 'kaz', km: 'khm', kn: 'kan', ko: 'kor', lt: 'lit', lv: 'lav', mk: 'mkd',
  ml: 'mal', mr: 'mar', ms: 'msa', my: 'mya', ne: 'nep', nl: 'nld', nb: 'nor', no: 'nor', pa: 'pan',
  pl: 'pol', pt: 'por', ro: 'ron', ru: 'rus', sk: 'slk', sl: 'slv', sq: 'sqi', sr: 'srp', sv: 'swe',
  sw: 'swa', ta: 'tam', te: 'tel', th: 'tha', tl: 'tgl', tr: 'tur', uk: 'ukr', ur: 'urd', vi: 'vie',
  zh: 'zho', zu: 'zul',
};
const LEGACY: Record<string, string> = {
  chi: 'zho', cze: 'ces', dut: 'nld', fre: 'fra', ger: 'deu', gre: 'ell', per: 'fas',
  rum: 'ron', slo: 'slk', alb: 'sqi', baq: 'eus', bur: 'mya', geo: 'kat', ice: 'isl',
  mac: 'mkd', may: 'msa', wel: 'cym', mandarin: 'zho', cantonese: 'yue',
};
const display = new Intl.DisplayNames('en', { type: 'language' });
const names = new Map(Object.entries(ISO).map(([two, three]) => [display.of(two)?.toLowerCase() ?? two, three]));
const flags: Record<string, string> = {
  US: 'eng', GB: 'eng', FR: 'fra', DE: 'deu', ES: 'spa', MX: 'spa', IT: 'ita', BR: 'por', PT: 'por',
  JP: 'jpn', KR: 'kor', CN: 'zho', TW: 'zho', HK: 'yue', RU: 'rus', UA: 'ukr', PL: 'pol', TR: 'tur',
  NL: 'nld', SE: 'swe', DK: 'dan', FI: 'fin', NO: 'nor', CZ: 'ces', HU: 'hun', RO: 'ron', GR: 'ell',
  IL: 'heb', IR: 'fas', SA: 'ara', TH: 'tha', VN: 'vie', ID: 'ind',
};

export function languageCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase();
  return LEGACY[code] ?? ISO[code] ?? names.get(code) ?? (/^[a-z]{3}$/.test(code) ? code : null);
}

function releaseLanguages(release: string, title: string): string[] {
  // Torrentio puts audio flags after the filename. Codes must be bounded:
  // arbitrary three-letter words in a movie title are not language labels.
  const languages = new Set<string>();
  for (const pair of release.matchAll(/[\u{1f1e6}-\u{1f1ff}]{2}/gu)) {
    const country = [...pair[0]].map(c => String.fromCharCode(c.codePointAt(0)! - 0x1f1e6 + 65)).join('');
    if (flags[country]) languages.add(flags[country]);
  }
  const tags = release.replace(title, '').split(/[^A-Za-z]+/);
  const fileTags = title.split(/(?:2160p|1080p|720p|480p|\b4k\b)/i).slice(1).join(' ').split(/[^A-Za-z]+/);
  for (const tag of [...tags, ...fileTags]) {
    const code = tag.toLowerCase();
    const language = names.get(code) ?? LEGACY[code] ?? (Object.values(ISO).includes(code) ? code : undefined);
    if (language) languages.add(language);
  }
  return [...languages];
}

export const POOR_RELEASE = /\b(?:cam|hdcam|camrip|telesync|telecine|hdts|hdtc|tsrip|ts|tc|screener|dvdscr|dvdscreener|scr|workprint)\b/i;
const UPSCALED = /\b(?:up[ ._-]?scal(?:e[ds]?|ing)|aius|ups|re[ ._-]?grad(?:e[ds]?|ing))\b/i;
const SOURCE_RANK: Record<Version['source'], number> = { remux: 5, bluray: 4, 'web-dl': 3, webrip: 2, hdtv: 1, other: 0 };
const SOURCE_LABEL: Record<Version['source'], string> = { remux: 'REMUX', bluray: 'BluRay', 'web-dl': 'WEB-DL', webrip: 'WEBRip', hdtv: 'HDTV', other: '' };

export function runtimeSeconds(value?: string): number | null {
  if (!value) return null;
  const hours = Number(value.match(/(\d+(?:\.\d+)?)\s*h/i)?.[1] ?? 0);
  const minutes = Number(value.match(/(\d+(?:\.\d+)?)\s*m/i)?.[1] ?? (/^\d+$/.test(value) ? value : 0));
  return hours || minutes ? (hours * 60 + minutes) * 60 : null;
}

export function qualityCap(quality: CorePrefs['quality']): number {
  return quality === 'original' ? Infinity : quality === 'saver' ? 720 : Number(quality);
}

export function parsePlaybackClient(raw: unknown): PlaybackClient | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const client = raw as PlaybackClient;
  if (!['mpv', 'html5', 'exoplayer', 'avplayer', 'roku'].includes(client.player)) return undefined;
  return {
    player: client.player,
    ...(Number.isFinite(client.maxHeight) && client.maxHeight! > 0 ? { maxHeight: Math.floor(client.maxHeight!) } : {}),
    ...Object.fromEntries((['hevc', 'hdr', 'mkv'] as const).flatMap(key => typeof client[key] === 'boolean' ? [[key, client[key]]] : [])),
  };
}

export function supportsVersion(version: Version, filename: string, client?: PlaybackClient): boolean {
  if (!client) return true;
  if (version.height !== null && version.height > (client.maxHeight ?? Infinity)) return false;
  const mpv = client.player === 'mpv';
  const avplayer = client.player === 'avplayer';
  const exoplayer = client.player === 'exoplayer';
  if (version.codec === 'hevc' && !(client.hevc ?? (mpv || avplayer))) return false;
  if (version.hdr && !(client.hdr ?? mpv)) return false;
  if (/\.mkv\b/i.test(filename) && !(client.mkv ?? (mpv || exoplayer))) return false;
  if (avplayer && (['av1', 'vp9', 'vp8'].includes(version.codec ?? '') || /\.(?:webm|avi)\b/i.test(filename))) return false;
  if (client.player === 'roku' && (['av1', 'vp9', 'vp8'].includes(version.codec ?? '') || /\.(?:webm|avi|mov)\b/i.test(filename))) return false;
  return true;
}

export function describeVersion(stream: DebridStream, seconds: number | null): Version {
  const release = stream.description ?? stream.title;
  const height = /\b(?:4k|uhd|2160p)\b/i.test(release) ? 2160 :
    Number(release.match(/\b(1440|1080|720|576|480|360)[pi]\b/i)?.[1]) || null;
  const hdr = /\b(?:dv|dovi|dolby[ ._-]?vision)\b/i.test(release) ? 'dv' :
    /\bhdr10(?:\+|plus)/i.test(release) ? 'hdr10+' : /\bhlg\b/i.test(release) ? 'hlg' :
      /\bhdr(?:10)?\b/i.test(release) ? 'hdr10' : null;
  const source = /\bremux\b/i.test(release) ? 'remux' : /\b(?:blu[ ._-]?ray|bdrip|brrip)\b/i.test(release) ? 'bluray' :
    /\bweb[ ._-]?dl\b/i.test(release) ? 'web-dl' : /\bweb[ ._-]?rip\b/i.test(release) ? 'webrip' :
      /\bhdtv\b/i.test(release) ? 'hdtv' : 'other';
  const codec = /\b(?:hevc|[xh][ ._-]?265)\b/i.test(release) ? 'hevc' :
    /\b(?:avc|[xh][ ._-]?264)\b/i.test(release) ? 'h264' : /\bav1\b/i.test(release) ? 'av1' :
      /\bvp9\b/i.test(release) ? 'vp9' : /\bvp8\b/i.test(release) ? 'vp8' : null;
  const audioCodec = release.match(/\b(true[ ._-]?hd|dts[ ._-]?hd(?:[ ._-]?ma)?|dts[ ._-]?x|dts|ddp|eac3|dd\+|aac|ac3|flac|opus)(?=\b|\d)/i)?.[1];
  const audio = {
    codec: audioCodec?.toLowerCase().replace(/[ ._]/g, '-') ?? null,
    channels: release.match(/\b([257]\.1|2\.0|1\.0)\b/)?.[1] ?? null,
    atmos: /\batmos\b/i.test(release),
  };
  const size = release.match(/\b(\d+(?:[.,]\d+)?)\s*([kmgt])(?:i)?b\b/i);
  const sizeBytes = size ? Math.round(Number(size[1]!.replace(',', '.')) * 1024 ** ('kmgt'.indexOf(size[2]!.toLowerCase()) + 1)) : null;
  const bitrateMbps = sizeBytes && seconds ? Math.round(sizeBytes * 80 / seconds / 1e6) / 10 : null;
  const hdrLabel = hdr === 'dv' ? 'Dolby Vision' : hdr?.toUpperCase();
  const label = [height === 2160 ? '4K' : height ? `${height}p` : null, hdrLabel, SOURCE_LABEL[source],
    bitrateMbps ? `${bitrateMbps} Mb/s` : null].filter(Boolean).join(' \u00b7 ') || stream.title;
  return {
    id: createHash('sha256').update(stream.title).update('\0').update(release).update('\0')
      .update(stream.releaseId ?? stream.url.split('?')[0]!.replace(/realdebrid=[^/]+/i, 'realdebrid')).digest('hex').slice(0, 24),
    label, height, hdr, source, codec, sizeBytes, bitrateMbps, audio, languages: releaseLanguages(release, stream.title),
    upscaled: UPSCALED.test(release), cached: stream.cached, recommended: false,
  };
}

export function rankVersions(streams: readonly DebridStream[], options: {
  prefs: CorePrefs; originalLanguage: string | null; runtime: number | null; maxHeight: number; client?: PlaybackClient;
}): { stream: DebridStream; version: Version }[] {
  const { prefs, originalLanguage, runtime, maxHeight, client } = options;
  const cap = Math.min(maxHeight, client?.maxHeight ?? Infinity,
    qualityCap(prefs.quality));
  const preferred = prefs.audioLanguage === 'original' ? originalLanguage : languageCode(prefs.audioLanguage);
  const match = (v: Version) => preferred && v.languages.includes(preferred) ? 1 : 0;
  const seen = new Set<string>();
  const eligible = streams.flatMap(stream => {
    const release = (stream.description ?? stream.title).replace(/\.(?:mkv|mp4|avi|ts|m4v|webm)\b/gi, '');
    if (POOR_RELEASE.test(stream.title) || POOR_RELEASE.test(release) || /\.m3u8(?:\?|$)/i.test(stream.url)) return [];
    const v = describeVersion(stream, runtime);
    if ((v.height ?? 1080) > cap || (v.upscaled && (prefs.skipUpscaled || prefs.quality === 'original'))) return [];
    if (!supportsVersion(v, stream.title + ' ' + stream.url, client)) return [];
    if (originalLanguage && prefs.audioLanguage === 'original' &&
      ((v.languages.length > 0 && !v.languages.includes(originalLanguage)) ||
        (v.languages.length === 0 && /\b(?:dub(?:bed)?|fandub)\b/i.test(stream.title) && !/\b(?:dual|multi)\b/i.test(stream.title)))) return [];
    if (seen.has(v.id)) return [];
    seen.add(v.id);
    return [{ stream, version: v }];
  });
  eligible.sort(({ version: a }, { version: b }) =>
    match(b) - match(a) ||
    (prefs.quality === 'saver'
      ? Number(b.cached) - Number(a.cached) || (a.sizeBytes ?? Infinity) - (b.sizeBytes ?? Infinity) || (a.height ?? 1080) - (b.height ?? 1080)
      : (b.height ?? 1080) - (a.height ?? 1080) || Number(b.cached) - Number(a.cached) ||
        SOURCE_RANK[b.source] - SOURCE_RANK[a.source] || (b.bitrateMbps ?? b.sizeBytes ?? 0) - (a.bitrateMbps ?? a.sizeBytes ?? 0)));
  if (eligible[0]) eligible[0].version.recommended = true;
  return eligible;
}
