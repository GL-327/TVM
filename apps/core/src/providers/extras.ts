import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createPreviewMedia } from './previewMedia.ts';
import { currentSyncDirectory } from '../requestContext.ts';
import { readPrefs, writePrefs } from '../prefs.ts';
import { readPrivateJson } from './privateJson.ts';
import { isFinished, readProgress, type ProgressEntry } from './progress.ts';
import { readWatchlist } from './watchlist.ts';
import { writeSealed } from './vault.ts';
import type { MediaItem, PlaybackResolution } from './types.ts';

// BEGIN GENERATED @tvm/extras — edit packages/extras/src/index.ts
/** Fetch-only extras, shared by Core and clients without a current Core. */
interface Segment { start: number; end: number }
interface Segments {
  intro: Segment | null;
  recap: Segment | null;
  credits: { start: number; end: number | null } | null;
  source: 'theintrodb' | 'aniskip' | null;
}
const emptySegments = (): Segments => ({ intro: null, recap: null, credits: null, source: null });
interface Subtitle { id: string; language: string; label: string; url: string }
interface Trailer { youtubeId: string; name: string }
interface AnimeTitle { english: string | null; malId: number | null }
interface UpcomingEpisode { season: number; episode: number; name: string; airstamp: string }
interface Collection { name: string | null; ids: string[] }
interface SegmentInput { id: string; season?: number; episode?: number; title?: string; anime?: boolean }
interface CacheEntry { expires: number; value: unknown }
interface ExtrasCache {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
}
interface ExtrasOptions {
  fetch?: typeof fetch;
  cache?: ExtrasCache;
  now?: () => number;
  timeoutMs?: number;
}

type Row = Record<string, unknown>;
const row = (value: unknown): Row => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];
const str = (value: unknown): string => typeof value === 'string' ? value : '';
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const validImdb = (id: string): boolean => /^tt\d{5,12}$/.test(id);
const DAY = 86_400_000;

/** HTTPS, no credentials/custom ports, and a DNS label boundary (not evil-strem.io). */
function isSubtitleUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443')
      && (u.hostname === 'strem.io' || u.hostname.endsWith('.strem.io'));
  } catch { return false; }
}

const languageAliases: Record<string, string> = {
  en: 'eng', es: 'spa', fr: 'fra', fre: 'fra', de: 'deu', ger: 'deu', it: 'ita', pt: 'por',
  ja: 'jpn', ko: 'kor', zh: 'zho', chi: 'zho', nl: 'nld', dut: 'nld', cs: 'ces', cze: 'ces',
  ro: 'ron', rum: 'ron', el: 'ell', gre: 'ell', ar: 'ara', ru: 'rus', pl: 'pol', tr: 'tur',
  sv: 'swe', no: 'nor', da: 'dan', fi: 'fin', he: 'heb', hi: 'hin', uk: 'ukr', pob: 'por', pb: 'por',
};
function subtitleLanguage(value: string): string {
  const code = value.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return languageAliases[code] ?? (/^[a-z]{3}$/.test(code) ? code : '');
}
function orderSubtitles(subtitles: readonly Subtitle[], languages: readonly string[] = ['eng']): Subtitle[] {
  const preferred = languages.map(subtitleLanguage);
  const rank = (s: Subtitle): number => { const i = preferred.indexOf(s.language); return i < 0 ? 999 : i; };
  return [...subtitles].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}
const languageLabel = (code: string): string => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code; } catch { return code; }
};

/** Decode UTF-8 strictly before falling back to the legacy OpenSubtitles encoding. */
function subtitleToVtt(bytes: ArrayBuffer): string {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { text = new TextDecoder('windows-1252').decode(bytes); }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT(?:\s|$)/.test(text)) return text;
  const timing = /^(\d{1,2}:\d{2}:\d{2}),(\d{3})([ \t]+-->[ \t]+)(\d{1,2}:\d{2}:\d{2}),(\d{3})(?:[ \t].*)?$/gm;
  text = text.replace(timing, '$1.$2$3$4.$5');
  if (!/\d{1,2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}\.\d{3}/.test(text)) return 'WEBVTT\n\n';
  return `WEBVTT\n\n${text.trim()}\n`;
}

function createExtras(options: ExtrasOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const memory = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<unknown>>();
  async function cached<T>(key: string, ttl: number, fallback: T, work: () => Promise<T>): Promise<T> {
    const hit = memory.get(key) ?? options.cache?.get(key);
    if (hit && hit.expires > now()) return hit.value as T;
    const running = pending.get(key);
    if (running) return running as Promise<T>;
    const task = (async () => {
      let value = fallback;
      let expires = now() + ttl;
      try { value = await work(); }
      catch { expires = now() + 60_000; }
      if (value === null || (Array.isArray(value) && !value.length) || row(value).source === null
        || (row(value).english === null && row(value).malId === null)) expires = Math.min(expires, now() + 60_000);
      const entry = { value, expires };
      memory.delete(key);
      memory.set(key, entry);
      if (memory.size > 512) memory.delete(memory.keys().next().value!);
      const bodies = [...memory.keys()].filter(key => key.startsWith('vtt:'));
      if (bodies.length > 8) memory.delete(bodies[0]!);
      try { options.cache?.set(key, entry); } catch { /* A full disk must not hide playback. */ }
      return value;
    })().finally(() => { pending.delete(key); });
    pending.set(key, task);
    return task;
  }
  /** The deadline covers body reads too, including a misbehaving injected fetch. */
  async function request<T>(url: string, consume: (r: Response) => Promise<T>, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(url, { ...init, signal: controller.signal });
          if (!response.ok) throw new Error(`upstream ${response.status}`);
          return consume(response);
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('extras timeout')); }, options.timeoutMs ?? 6000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  const json = (url: string, init?: RequestInit): Promise<Row> => request(url, async r => row(await r.json()), init);
  const sparql = async (query: string): Promise<Row[]> => {
    const data = await json(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, {
      headers: { accept: 'application/sparql-results+json', 'user-agent': 'TVM-client/1.1 (https://github.com/GL-327/TVM)' },
    });
    return rows(row(data.results).bindings);
  };
  const binding = (r: Row, key: string): string => str(row(r[key]).value);
  const animeTitle = (title: string): Promise<AnimeTitle> => {
    const clean = title.trim().slice(0, 200);
    if (!clean) return Promise.resolve({ english: null, malId: null });
    return cached(`anime:${clean.toLowerCase()}`, 7 * DAY, { english: null, malId: null } as AnimeTitle, async () => {
      const data = await json('https://graphql.anilist.co', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query: 'query($search:String!){Media(search:$search,type:ANIME){idMal title{english romaji}}}', variables: { search: clean } }),
      });
      const media = row(row(data.data).Media);
      return { english: str(row(media.title).english).trim() || null, malId: positive(media.idMal) ? media.idMal : null };
    });
  };
  async function segments(input: SegmentInput): Promise<Segments> {
    if (!validImdb(input.id)) return emptySegments();
    if ((input.season !== undefined && (!Number.isInteger(input.season) || input.season < 0))
      || (input.episode !== undefined && (!Number.isInteger(input.episode) || input.episode < 1))) return emptySegments();
    const key = `segments:${input.id}:${input.season ?? ''}:${input.episode ?? ''}:${input.anime ? input.title ?? '' : ''}`;
    return cached(key, DAY, emptySegments(), async () => {
      let result = emptySegments();
      try {
        const series = input.season !== undefined && input.episode !== undefined;
        const tmdb = await cached(`tmdb:${input.id}:${series}`, 30 * DAY, null as string | null, async () => {
          try {
            const matches = await sparql(`SELECT ?tmdb WHERE { ?item wdt:P345 "${input.id}"; wdt:${series ? 'P4983' : 'P4947'} ?tmdb. } LIMIT 1`);
            const id = binding(matches[0] ?? {}, 'tmdb');
            if (/^\d+$/.test(id)) return id;
          } catch { /* Some networks block Wikidata. Cinemeta also carries the mapping. */ }
          const meta = row((await json(`https://v3-cinemeta.strem.io/meta/${series ? 'series' : 'movie'}/${input.id}.json`)).meta);
          const id = typeof meta.moviedb_id === 'number' ? String(meta.moviedb_id) : str(meta.moviedb_id);
          return /^\d+$/.test(id) ? id : null;
        });
        if (tmdb) {
          const params = new URLSearchParams({ tmdb_id: tmdb });
          if (series) { params.set('season', String(input.season)); params.set('episode', String(input.episode)); }
          const data = await json(`https://api.theintrodb.org/v2/media?${params}`);
          const range = (value: unknown, credits = false): { start: number; end: number | null } | null => {
            for (const s of rows(value)) {
              // TheIntroDB uses null to mean the beginning of the media.
              const start = s.start_ms === null ? 0 : s.start_ms;
              if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) continue;
              if (credits && s.end_ms === null) return { start: start / 1000, end: null };
              if (positive(s.end_ms) && s.end_ms > start) return { start: start / 1000, end: s.end_ms / 1000 };
            }
            return null;
          };
          result = { intro: range(data.intro) as Segment | null, recap: range(data.recap) as Segment | null, credits: range(data.credits, true), source: null };
          if (result.intro || result.recap || result.credits) result.source = 'theintrodb';
        }
      } catch { /* Anime fallback still runs when the primary service is down. */ }
      if (result.source || !input.anime || !input.title || !input.episode) return result;
      const anime = await animeTitle(input.title);
      if (!anime.malId) return result;
      const data = await json(`https://api.aniskip.com/v2/skip-times/${anime.malId}/${input.episode}?types[]=op&types[]=ed&types[]=recap&episodeLength=0`);
      for (const s of rows(data.results)) {
        const interval = row(s.interval);
        const start = interval.startTime;
        const end = interval.endTime;
        if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || !positive(end) || end <= start) continue;
        const segment = { start, end };
        if (s.skipType === 'op' && !result.intro) result.intro = segment;
        if (s.skipType === 'ed' && !result.credits) result.credits = segment;
        if (s.skipType === 'recap' && !result.recap) result.recap = segment;
      }
      if (result.intro || result.recap || result.credits) result.source = 'aniskip';
      return result;
    });
  }
  async function subtitles(input: SegmentInput, languages: readonly string[] = ['eng']): Promise<Subtitle[]> {
    if (!validImdb(input.id)) return [];
    const series = input.season !== undefined && input.episode !== undefined;
    if (series && (!Number.isInteger(input.season) || input.season! < 0 || !Number.isInteger(input.episode) || input.episode! < 1)) return [];
    const video = series ? `${input.id}:${input.season}:${input.episode}` : input.id;
    const list = await cached(`subs:${video}`, DAY, [] as Subtitle[], async () => {
      const data = await json(`https://opensubtitles-v3.strem.io/subtitles/${series ? 'series' : 'movie'}/${video}.json`);
      const seen = new Set<string>();
      const list: Subtitle[] = [];
      // The addon ranks releases; keep its first valid file for each language.
      for (const s of rows(data.subtitles)) {
        const language = subtitleLanguage(str(s.lang));
        const url = str(s.url);
        if (!language || seen.has(language) || !isSubtitleUrl(url)) continue;
        seen.add(language);
        list.push({ id: str(s.id) || `${video}:${language}`, language, label: languageLabel(language), url: `/api/extras/subtitle.vtt?u=${encodeURIComponent(url)}` });
      }
      return list;
    });
    return orderSubtitles(list, languages);
  }
  async function subtitleVtt(url: string): Promise<string | null> {
    if (!isSubtitleUrl(url)) return null;
    return cached(`vtt:${url}`, DAY, null as string | null, async () => {
      // Redirects are disabled, so an allowed CDN cannot redirect into the LAN.
      return request(url, async r => {
        if (r.url && !isSubtitleUrl(r.url)) throw new Error('subtitle host');
        if (Number(r.headers.get('content-length')) > 2_000_000) throw new Error('subtitle too large');
        const reader = r.body?.getReader();
        if (!reader) return 'WEBVTT\n\n';
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > 2_000_000) throw new Error('subtitle too large');
            chunks.push(chunk.value);
          }
        } finally { void reader.cancel().catch(() => {}); }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return subtitleToVtt(bytes.buffer);
      }, { redirect: 'error' });
    });
  }
  async function trailers(id: string): Promise<Trailer[]> {
    if (!validImdb(id)) return [];
    return cached(`trailers:${id}`, 7 * DAY, [] as Trailer[], async () => {
      const metas = await Promise.all(['movie', 'series'].map(kind => json(`https://v3-cinemeta.strem.io/meta/${kind}/${id}.json`).catch(() => ({}))));
      const seen = new Set<string>();
      return metas.flatMap(meta => rows(row(row(meta).meta).trailers)).flatMap(t => {
        const youtubeId = str(t.source);
        if (!/^[\w-]{11}$/.test(youtubeId) || seen.has(youtubeId)) return [];
        seen.add(youtubeId);
        return [{ youtubeId, name: str(t.name) || str(t.type) || 'Trailer' }];
      });
    });
  }
  async function collection(id: string): Promise<Collection> {
    if (!validImdb(id)) return { name: null, ids: [] };
    return cached(`collection:${id}`, 7 * DAY, { name: null, ids: [] } as Collection, async () => {
      const matches = await sparql(`SELECT ?collection ?collectionLabel ?imdb (MIN(?released) AS ?date) WHERE {
        ?source wdt:P345 "${id}"; wdt:P179 ?collection.
        ?film wdt:P179 ?collection; wdt:P345 ?imdb.
        OPTIONAL { ?film wdt:P577 ?released. }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      } GROUP BY ?collection ?collectionLabel ?imdb ORDER BY ?date ?imdb LIMIT 100`);
      const groups = new Map<string, { name: string; ids: string[] }>();
      for (const r of matches) {
        const key = binding(r, 'collection');
        const imdb = binding(r, 'imdb');
        if (!key || !validImdb(imdb)) continue;
        const group = groups.get(key) ?? { name: binding(r, 'collectionLabel'), ids: [] };
        if (!group.ids.includes(imdb)) group.ids.push(imdb);
        groups.set(key, group);
      }
      // Prefer the smallest specific collection (e.g. a trilogy over the franchise).
      const chosen = [...groups.values()].filter(g => g.ids.length >= 2 && g.ids.includes(id)).sort((a, b) => a.ids.length - b.ids.length)[0];
      return chosen ? { name: chosen.name || null, ids: chosen.ids } : { name: null, ids: [] };
    });
  }
  async function upcoming(id: string): Promise<UpcomingEpisode | null> {
    if (!validImdb(id)) return null;
    return cached(`upcoming:${id}`, DAY, null as UpcomingEpisode | null, async () => {
      const show = await cached(`tvmaze:${id}`, 30 * DAY, null as number | null, async () => {
        const data = await json(`https://api.tvmaze.com/lookup/shows?imdb=${id}`);
        return positive(data.id) ? data.id : null;
      });
      if (!show) return null;
      const data = await json(`https://api.tvmaze.com/shows/${show}?embed=nextepisode`);
      const next = row(row(data._embedded).nextepisode);
      if (!positive(next.season) || !positive(next.number) || !str(next.airstamp) || !Number.isFinite(Date.parse(str(next.airstamp)))) return null;
      return { season: next.season, episode: next.number, name: str(next.name), airstamp: str(next.airstamp) };
    });
  }
  return { segments, subtitles, subtitleVtt, trailers, collection, upcoming, animeTitle };
}
type ExtrasClient = ReturnType<typeof createExtras>;

interface WatchHistoryEntry<T extends { id: string; genres: string[] }> {
  item: T;
  at: string;
  seconds: number;
  days: Record<string, number>;
  finished: boolean;
}
/** UTC calendar totals; a streak can continue today if the viewer watched yesterday. */
function summarizeWatchHistory<T extends { id: string; genres: string[] }>(entries: readonly WatchHistoryEntry<T>[], now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const date = new Date(`${today}T00:00:00Z`);
  const weekStart = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  let week = 0, month = 0, all = 0, finished = 0;
  const days = new Set<string>();
  const genres = new Map<string, number>();
  for (const entry of entries) {
    const seconds = Number.isFinite(entry.seconds) ? Math.max(0, entry.seconds) : 0;
    all += seconds;
    if (entry.finished) finished++;
    for (const [day, seconds] of Object.entries(entry.days)) {
      if (!Number.isFinite(seconds) || seconds <= 0 || day > today) continue;
      days.add(day);
      if (day >= weekStart) week += seconds;
      if (day >= monthStart) month += seconds;
    }
    for (const genre of entry.item.genres) genres.set(genre, (genres.get(genre) ?? 0) + seconds);
  }
  let streakDays = 0;
  let cursor = date.getTime();
  if (!days.has(today)) cursor -= DAY;
  while (days.has(new Date(cursor).toISOString().slice(0, 10))) { streakDays++; cursor -= DAY; }
  return { week, month, all, finished, streakDays,
    topGenres: [...genres].map(([genre, seconds]) => ({ genre, seconds })).sort((a, b) => b.seconds - a.seconds).slice(0, 10),
    history: [...entries].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200).map(e => ({ item: e.item, at: e.at, seconds: e.seconds })),
  };
}

/** Seek jumps cannot add more watch time than the elapsed heartbeat interval. */
function watchedDelta(position: number, previous: { position: number; updated: string } | undefined, now: number): number {
  if (!Number.isFinite(position) || position < 0) return 0;
  const elapsed = previous ? Math.max(0, (now - Date.parse(previous.updated)) / 1000) : 30;
  if (!Number.isFinite(elapsed) || (previous && !Number.isFinite(previous.position))) return 0;
  return Math.min(Math.max(0, position - (previous?.position ?? 0)), elapsed + (previous ? 2 : 0), 120);
}
// END GENERATED @tvm/extras

export interface CoreExtrasOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  title?: (id: string) => Promise<{ tmdbId?: number; series: boolean } | null>;
  scope: () => string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Capture the age rule before awaiting, then prime certificates and filter. */
  filter: () => (items: MediaItem[]) => Promise<MediaItem[]>;
  item: (id: string) => Promise<MediaItem | null>;
}
interface HistoryEntry {
  item: MediaItem;
  at: string;
  seconds: number;
  days: Record<string, number>;
  finished: boolean;
}
interface HistoryState { entries: Record<string, HistoryEntry>; clearedAt?: string }
export type ExtrasPlaybackResolution = PlaybackResolution & { segments?: Segments };
export interface WatchStats {
  week: number; month: number; all: number; finished: number; streakDays: number;
  topGenres: { genre: string; seconds: number }[];
  history: { item: MediaItem; at: string; seconds: number }[];
}
const imdbOf = (id: string): string | undefined => id.match(/(?:^|:)(tt\d{5,12})(?=:|$)/)?.[1];

async function within<T>(work: Promise<T>, fallback: T, ms = 6000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work.catch(() => fallback), new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms); })]);
  } finally { clearTimeout(timer); }
}

function fallbackItem(id: string, title?: string): MediaItem {
  return { id, title: title || id, year: null, kind: /:\d+:\d+$/.test(id) ? 'series' : 'file',
    synopsis: '', poster: '', backdrop: '', genres: [], rating: '', playable: true, hue: 210 };
}

/** Public upstream data only. History and language choices use the profile's sealed store. */
function diskCache(dataDir: string, now: () => number) {
  const path = join(dataDir, 'cache', 'extras.json');
  const bodiesDir = join(dataDir, 'cache', 'extras-subtitles');
  const bodyPath = (key: string): string => join(bodiesDir, `${createHash('sha256').update(key).digest('hex')}.json`);
  let entries: Record<string, CacheEntry> = {};
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) entries = raw as Record<string, CacheEntry>;
  } catch { /* Empty cache. */ }
  return {
    get(key: string): CacheEntry | undefined {
      let entry = entries[key];
      if (key.startsWith('vtt:')) {
        try { entry = JSON.parse(readFileSync(bodyPath(key), 'utf8')) as CacheEntry; } catch { return undefined; }
      }
      return entry && typeof entry.expires === 'number' && entry.expires > now() ? entry : undefined;
    },
    set(key: string, entry: CacheEntry): void {
      // Keep bodies outside the small metadata JSON, with a bounded disk cache.
      if (key.startsWith('vtt:')) {
        try {
          mkdirSync(bodiesDir, { recursive: true });
          writeFileSync(bodyPath(key), JSON.stringify(entry));
          const files = readdirSync(bodiesDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
            .map(name => ({ path: join(bodiesDir, name), at: statSync(join(bodiesDir, name)).mtimeMs }))
            .sort((a, b) => b.at - a.at);
          for (const file of files.slice(32)) unlinkSync(file.path);
        } catch { /* Caching subtitles is optional. */ }
        return;
      }
      entries[key] = entry;
      entries = Object.fromEntries(Object.entries(entries).filter(([, e]) => e.expires > now()).slice(-512));
      try {
        mkdirSync(join(dataDir, 'cache'), { recursive: true });
        writeFileSync(path, JSON.stringify(entries));
      } catch { /* Read-only disks are fine. */ }
    },
  };
}

export function createCoreExtras(options: CoreExtrasOptions) {
  const now = options.now ?? Date.now;
  const client: ExtrasClient = createExtras({ fetch: options.fetch, now, cache: diskCache(options.dataDir, now) });
  const previews = createPreviewMedia({ dataDir: options.dataDir, env: options.env, now, fetch: options.fetch,
    trailers: id => client.trailers(id), title: options.title ?? (async () => null) });
  const prefs = () => readPrefs(options.dataDir);
  async function canPreview(id: string): Promise<boolean> {
    if (!validImdb(id)) return false;
    const filter = options.filter();
    const item = await within(options.item(id), null);
    // Adult profiles may play an event whose details catalogue is still warming.
    return (await filter([item ?? fallbackItem(id)])).length > 0;
  }
  const known = new Map<string, MediaItem>();
  const knownItem = (id: string): MediaItem | undefined => {
    const source = known.get(id) ?? known.get(imdbOf(id) ?? '');
    if (!source) return undefined;
    return { ...source, id };
  };
  const historyPath = (scope: string): string => join(scope, 'extras-history.json');
  const stateFor = (scope: string): HistoryState => {
    try {
      const saved = readPrivateJson<HistoryState>(scope, historyPath(scope));
      if (saved?.entries && typeof saved.entries === 'object') return saved;
    } catch { /* Recover from damaged history without touching progress. */ }
    // Existing progress is a snapshot, not a play log. Preserve it as an estimate,
    // once, then record time deltas so subsequent seeks do not become watch time.
    const entries: Record<string, HistoryEntry> = {};
    for (const [id, p] of Object.entries(readProgress(scope))) {
      if (!Number.isFinite(p.position) || p.position <= 0 || !Number.isFinite(Date.parse(p.updated))) continue;
      const seconds = Math.min(p.position, Number.isFinite(p.duration) && p.duration > 0 ? p.duration : p.position);
      const item = knownItem(id) ?? readWatchlist(scope).find(item => item.id === (imdbOf(id) ?? id)) ?? fallbackItem(id, p.completedTitle);
      entries[id] = { item, at: p.updated, seconds, days: { [p.updated.slice(0, 10)]: seconds }, finished: isFinished(p) || !!p.completedAt };
    }
    return { entries };
  };
  const persist = (scope: string, state: HistoryState): void => { writeSealed(scope, historyPath(scope), state); };
  const remember = (item: MediaItem): void => {
    known.set(item.id, item);
    if (known.size > 512) known.delete(known.keys().next().value!);
  };
  const languages = (scope = options.scope()): string[] => {
    if (currentSyncDirectory(options.dataDir)) return prefs().subtitleLanguages;
    try {
      const saved = readPrivateJson<{ language: string }>(scope, join(scope, 'extras-subtitle.json'));
      return saved?.language ? [...new Set([saved.language, ...readPrefs(options.dataDir).subtitleLanguages])] : readPrefs(options.dataDir).subtitleLanguages;
    } catch { return readPrefs(options.dataDir).subtitleLanguages; }
  };
  const saveLanguage = (language: string): void => {
    const scope = options.scope();
    // Reuse preference validation/normalization, but keep the actual choice per profile.
    const valid = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(language);
    if (!valid) return;
    if (currentSyncDirectory(options.dataDir)) {
      writePrefs(options.dataDir, { subtitleLanguages: [...new Set([language, ...prefs().subtitleLanguages])] });
    } else writeSealed(scope, join(scope, 'extras-subtitle.json'), { language });
  };
  async function metadata(ids: string[]): Promise<MediaItem[]> {
    const found = new Map<string, MediaItem>();
    let offset = 0;
    let stopped = false;
    const work = Promise.all(Array.from({ length: Math.min(6, ids.length) }, async () => {
      while (!stopped && offset < ids.length) {
        const id = ids[offset++]!;
        const item = await within(options.item(id), null);
        if (item) found.set(id, item);
      }
    }));
    await within(work, []);
    stopped = true;
    return ids.flatMap(id => found.has(id) ? [found.get(id)!] : []);
  }
  async function collection(id: string) {
    const filter = options.filter();
    const result = await client.collection(id);
    const items = (await metadata(result.ids)).filter(item => item.kind === 'movie');
    const allowed = await filter(items);
    return allowed.length >= 2 ? { name: result.name, items: allowed } : { name: null, items: [] };
  }
  async function upcomingHome() {
    const scope = options.scope();
    const filter = options.filter();
    const at = now();
    const progress = readProgress(scope);
    const ids = [...new Set([
      ...readWatchlist(scope).filter(item => item.kind === 'series').map(item => imdbOf(item.id)),
      ...Object.entries(progress).filter(([, p]) => p.position >= 30 && !isFinished(p)).map(([id]) => /:\d+:\d+$/.test(id) ? imdbOf(id) : undefined),
    ].filter((id): id is string => !!id))].slice(0, 50);
    const items = (await metadata(ids)).filter(item => item.kind === 'series');
    const allowed = await filter(items);
    // Six requests at a time; never scan an unbounded watchlist upstream.
    const out: { item: MediaItem; next: UpcomingEpisode }[] = [];
    const deadline = Date.now() + 6000;
    let offset = 0;
    await Promise.all(Array.from({ length: Math.min(6, allowed.length) }, async () => {
      while (offset < allowed.length && Date.now() < deadline) {
        const item = allowed[offset++]!;
        const next = await client.upcoming(imdbOf(item.id) ?? '');
        const date = next ? Date.parse(next.airstamp) : NaN;
        if (next && date >= at && date <= at + 7 * DAY) out.push({ item, next });
      }
    }));
    return { items: out.sort((a, b) => a.next.airstamp.localeCompare(b.next.airstamp)) };
  }
  async function upcoming(id: string) {
    const filter = options.filter();
    const item = await within(options.item(id), null);
    if (!item || item.kind !== 'series' || !(await filter([item])).length) return { next: null };
    return { next: await client.upcoming(id) };
  }
  function recordProgress(id: string, position: number, duration: number, previous?: ProgressEntry): void {
    if (!prefs().extras.watchStats || !Number.isFinite(position) || !Number.isFinite(duration) || position < 0 || duration <= 0) return;
    const scope = options.scope();
    try {
      const state = stateFor(scope);
      const at = new Date(now()).toISOString();
      const entry = state.entries[id] ?? { item: knownItem(id) ?? fallbackItem(id), at, seconds: 0, days: {}, finished: false };
      const delta = watchedDelta(position, previous, now());
      const day = at.slice(0, 10);
      entry.item = knownItem(id) ?? entry.item;
      entry.at = at;
      entry.seconds += delta;
      entry.days[day] = (entry.days[day] ?? 0) + delta;
      entry.finished ||= isFinished({ position, duration });
      state.entries[id] = entry;
      persist(scope, state);
    } catch { /* Statistics must never prevent saving playback progress. */ }
  }
  function stats(): WatchStats {
    const scope = options.scope();
    const state = stateFor(scope);
    for (const entry of Object.values(state.entries)) entry.item = knownItem(entry.item.id) ?? entry.item;
    // Persist migration once. Clearing uses an empty state rather than deleting it.
    try { persist(scope, state); } catch { /* No disk space. */ }
    return summarizeWatchHistory(Object.values(state.entries), now());
  }
  function clearStats(): void { persist(options.scope(), { entries: {}, clearedAt: new Date(now()).toISOString() }); }
  async function enrichPlayback(result: PlaybackResolution, input: SegmentInput, scope = options.scope()): Promise<ExtrasPlaybackResolution> {
    if (result.kind !== 'stream' || !imdbOf(input.id)) return result;
    const id = imdbOf(input.id)!;
    const meta = knownItem(id);
    const title = input.title || meta?.title;
    const anime = input.anime || meta?.genres.some(g => g.toLowerCase() === 'anime');
    // Start both in parallel and keep either result that arrives inside the budget.
    let subtitles: Awaited<ReturnType<ExtrasClient['subtitles']>> = [];
    let segments = emptySegments();
    const settings = prefs();
    const work = Promise.all([
      settings.extras.onlineSubtitles && settings.subtitleMode !== 'off'
        ? client.subtitles({ ...input, id }, languages(scope)).then(value => { subtitles = value; }) : undefined,
      client.segments({ ...input, id, title, anime }).then(value => { segments = value; }),
    ]).catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, 1450); })]); }
    finally { clearTimeout(timer); }
    return { ...result, subtitles: [...(result.subtitles ?? []), ...subtitles], segments };
  }
  return { client, collection, upcoming, upcomingHome, stats, clearStats, recordProgress, remember, languages, saveLanguage, enrichPlayback,
    previews, prefs: prefs, canPreview };
}
export type CoreExtras = ReturnType<typeof createCoreExtras>;

/** One route dispatcher lets server.ts keep every Extras route in one block. */
export async function extrasRoute(extras: CoreExtras, path: string, method: string, query: URLSearchParams) {
  const input: SegmentInput = {
    id: query.get('id') ?? '', title: query.get('title') ?? '', anime: query.get('anime') === '1',
    ...(query.has('season') ? { season: Number(query.get('season')) } : {}),
    ...(query.has('episode') ? { episode: Number(query.get('episode')) } : {}),
  };
  if (method === 'POST' && path === '/api/extras/stats/clear') { extras.clearStats(); return { status: 204, body: null }; }
  if (method !== 'GET') return null;
  const prefs = extras.prefs();
  if (path === '/api/extras/hero-clip') {
    const clip = prefs.heroPreviews && await extras.canPreview(input.id)
      ? await extras.previews.hero(input.id) : { status: 'unavailable' };
    return { status: clip.status === 'ready' ? 200 : clip.status === 'preparing' ? 202 : 404, body: clip };
  }
  if (path === '/api/extras/theme') {
    const theme = prefs.extras.themeSongs && await extras.canPreview(input.id) ? await extras.previews.theme(input.id) : null;
    return { status: theme ? 200 : 404, body: theme ?? { error: 'unavailable' } };
  }
  if (path === '/api/extras/ytdlp') {
    const file = prefs.extras.trailers ? await extras.previews.ytdlp() : null;
    return { status: file ? 200 : 404, body: file ? { path: file } : { error: 'unavailable' } };
  }
  if (path === '/api/extras/subtitle.vtt') {
    const url = query.get('u') ?? '';
    if (!isSubtitleUrl(url)) return { status: 400, body: { error: 'invalid_subtitle_url' } };
    const text = await extras.client.subtitleVtt(url);
    return { status: 200, text: text ?? 'WEBVTT\n\n' };
  }
  const result = path === '/api/extras/segments' ? await within(extras.client.segments(input), emptySegments())
    : path === '/api/extras/subtitles' ? { subtitles: prefs.extras.onlineSubtitles ? await extras.client.subtitles(input, extras.languages()) : [] }
    : path === '/api/extras/trailers' ? { trailers: prefs.extras.trailers || prefs.extras.trailerBackdrops ? await extras.client.trailers(input.id) : [] }
    : path === '/api/extras/collection' ? (prefs.extras.collections ? await within(extras.collection(input.id), { name: null, items: [] }) : { name: null, items: [] })
    : path === '/api/extras/upcoming/home' ? (prefs.extras.comingUp ? await within(extras.upcomingHome(), { items: [] }) : { items: [] })
    : path === '/api/extras/upcoming' ? (prefs.extras.comingUp ? await within(extras.upcoming(input.id), { next: null }) : { next: null })
    : path === '/api/extras/stats' ? extras.stats()
    : path === '/api/extras/anime-title' ? (prefs.extras.animeTitles ? await extras.client.animeTitle(input.title ?? '') : { english: null, malId: null }) : undefined;
  return result === undefined ? null : { status: 200, body: result };
}

/** Profile selection is remembered when the preferred list is changed. */
export function writeExtrasPrefs(dataDir: string, extras: CoreExtras | undefined, patch: Parameters<typeof writePrefs>[1]) {
  const prefs = writePrefs(dataDir, patch);
  if (!currentSyncDirectory(dataDir) && patch.subtitleLanguages?.[0]) extras?.saveLanguage(prefs.subtitleLanguages[0] ?? 'eng');
  return prefs;
}
