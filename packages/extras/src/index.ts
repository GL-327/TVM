/** Fetch-only extras, shared by Core and clients without a current Core. */
export interface Segment { start: number; end: number }
export interface Segments {
  intro: Segment | null;
  recap: Segment | null;
  credits: { start: number; end: number | null } | null;
  source: 'theintrodb' | 'aniskip' | null;
}
export const emptySegments = (): Segments => ({ intro: null, recap: null, credits: null, source: null });
export interface Subtitle { id: string; language: string; label: string; url: string }
export interface Trailer { youtubeId: string; name: string }
export interface AnimeTitle { english: string | null; malId: number | null }
export interface UpcomingEpisode { season: number; episode: number; name: string; airstamp: string }
export interface Collection { name: string | null; ids: string[] }
export interface SegmentInput { id: string; season?: number; episode?: number; title?: string; anime?: boolean }
export interface CacheEntry { expires: number; value: unknown }
export interface ExtrasCache {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
}
export interface ExtrasOptions {
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
export const validImdb = (id: string): boolean => /^tt\d{5,12}$/.test(id);
const DAY = 86_400_000;

/** HTTPS, no credentials/custom ports, and a DNS label boundary (not evil-strem.io). */
export function isSubtitleUrl(input: string): boolean {
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
export function subtitleLanguage(value: string): string {
  const code = value.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return languageAliases[code] ?? (/^[a-z]{3}$/.test(code) ? code : '');
}
export function orderSubtitles(subtitles: readonly Subtitle[], languages: readonly string[] = ['eng']): Subtitle[] {
  const preferred = languages.map(subtitleLanguage);
  const rank = (s: Subtitle): number => { const i = preferred.indexOf(s.language); return i < 0 ? 999 : i; };
  return [...subtitles].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}
const languageLabel = (code: string): string => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code; } catch { return code; }
};

/** Decode UTF-8 strictly before falling back to the legacy OpenSubtitles encoding. */
export function subtitleToVtt(bytes: ArrayBuffer): string {
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

export function createExtras(options: ExtrasOptions = {}) {
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
export type ExtrasClient = ReturnType<typeof createExtras>;

export interface WatchHistoryEntry<T extends { id: string; genres: string[] }> {
  item: T;
  at: string;
  seconds: number;
  days: Record<string, number>;
  finished: boolean;
}
/** UTC calendar totals; a streak can continue today if the viewer watched yesterday. */
export function summarizeWatchHistory<T extends { id: string; genres: string[] }>(entries: readonly WatchHistoryEntry<T>[], now = Date.now()) {
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
export function watchedDelta(position: number, previous: { position: number; updated: string } | undefined, now: number): number {
  if (!Number.isFinite(position) || position < 0) return 0;
  const elapsed = previous ? Math.max(0, (now - Date.parse(previous.updated)) / 1000) : 30;
  if (!Number.isFinite(elapsed) || (previous && !Number.isFinite(previous.position))) return 0;
  return Math.min(Math.max(0, position - (previous?.position ?? 0)), elapsed + (previous ? 2 : 0), 120);
}
