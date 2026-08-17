import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { catalogCachePath } from '../update/paths.ts';
import { preferBackdrop, preferPoster } from './artwork.ts';
import { hueFor } from './title.ts';
import type { MediaItem } from './types.ts';

const CINEMETA = 'https://v3-cinemeta.strem.io';
const TVMAZE = 'https://api.tvmaze.com';
const FETCH_MS = 12_000;
const BUNDLE_TTL_MS = 12 * 60 * 1000;
const GENRE_TTL_MS = 20 * 60 * 1000;
const META_TTL_MS = 30 * 60 * 1000;

export const GENRE_RAILS = [
  { id: 'horror', title: 'Horror', genre: 'Horror' },
  { id: 'action', title: 'Action', genre: 'Action' },
  { id: 'comedy', title: 'Comedy', genre: 'Comedy' },
  { id: 'thriller', title: 'Thriller', genre: 'Thriller' },
  { id: 'scifi', title: 'Sci-Fi', genre: 'Sci-Fi' },
  { id: 'romance', title: 'Romance', genre: 'Romance' },
  { id: 'crime', title: 'Crime', genre: 'Crime' },
  { id: 'documentary', title: 'Documentaries', genre: 'Documentary' },
  { id: 'anime', title: 'Anime', genre: 'Anime' },
] as const;

export function seriesGenresForRail(genre: string): readonly string[] {
  return genre === 'Anime' ? ['Anime', 'Animation'] : [genre];
}

export interface CatalogBundle {
  moviesTop: MediaItem[];
  seriesTop: MediaItem[];
  moviesRated: MediaItem[];
  seriesRated: MediaItem[];
  recentTv: MediaItem[];
  newFilms: MediaItem[];
  catalog: MediaItem[];
}

export interface TitleMeta {
  item: MediaItem;
  children: MediaItem[];
}

/** Cinemeta reuses some IMDb ids: /meta/movie/tt1196946 is Le Mans, /meta/series is The Mentalist. */
export function chooseCinemetaMeta(movie: TitleMeta | null, series: TitleMeta | null): TitleMeta | null {
  if (series !== null && series.children.length > 0) return series;
  if (series !== null && movie !== null && series.item.title !== movie.item.title) return series;
  return movie ?? series;
}

export function parseYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1800) return Math.trunc(value);
  if (typeof value !== 'string') return null;
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match === null ? null : Number(match[0]);
}

export function mapCinemetaMeta(raw: Record<string, unknown>, kind: 'movie' | 'series'): MediaItem | null {
  const id = String(raw.id || raw.imdb_id || '');
  if (!/^tt\d+$/i.test(id)) return null;
  const title = String(raw.name || raw.title || '').trim();
  if (title === '') return null;
  const genres = Array.isArray(raw.genre)
    ? raw.genre.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const poster = preferPoster(id.toLowerCase(), typeof raw.poster === 'string' ? raw.poster : '', '');
  const backdrop = preferBackdrop(
    id.toLowerCase(),
    (typeof raw.background === 'string' ? raw.background : '') || (typeof raw.backdrop === 'string' ? raw.backdrop : ''),
    typeof raw.poster === 'string' ? raw.poster : '',
  );
  const runtime =
    typeof raw.runtime === 'string'
      ? raw.runtime
      : typeof raw.runtime === 'number'
        ? `${raw.runtime} min`
        : undefined;
  return {
    id: id.toLowerCase(),
    title,
    year: parseYear(raw.year) ?? parseYear(raw.releaseInfo),
    kind,
    synopsis: typeof raw.description === 'string' ? raw.description : '',
    poster,
    backdrop,
    genres,
    rating: raw.imdbRating !== undefined && raw.imdbRating !== null ? String(raw.imdbRating) : '',
    runtime,
    playable: true,
    hue: hueFor(title),
    showTitle: title,
  };
}

export function parseAired(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function episodeScore(video: Record<string, unknown>): string {
  const raw = video.imdbRating ?? video.rating;
  if (raw === undefined || raw === null || raw === '') return '';
  const text = String(raw).trim();
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value > 10) return '';
  return text;
}

export function mapCinemetaVideos(show: MediaItem, videos: unknown): MediaItem[] {
  if (!Array.isArray(videos)) return [];
  const items: MediaItem[] = [];
  for (const raw of videos) {
    if (typeof raw !== 'object' || raw === null) continue;
    const video = raw as Record<string, unknown>;
    const season = video.season !== undefined ? Number(video.season) : NaN;
    const episode =
      video.episode !== undefined ? Number(video.episode) : video.number !== undefined ? Number(video.number) : NaN;
    if (!Number.isFinite(season) || !Number.isFinite(episode) || season < 1 || episode < 1) continue;
    const name = String(video.title || video.name || `Episode ${episode}`);
    const thumbnail = typeof video.thumbnail === 'string' ? video.thumbnail : show.poster;
    const aired = parseAired(video.released) ?? parseAired(video.firstAired);
    items.push({
      id: `${show.id}:${season}:${episode}`,
      title: show.title,
      year: show.year,
      kind: 'series',
      synopsis: typeof video.overview === 'string' ? video.overview : typeof video.description === 'string' ? video.description : '',
      poster: thumbnail,
      backdrop: show.backdrop,
      genres: show.genres,
      rating: episodeScore(video),
      playable: true,
      hue: show.hue,
      season,
      episode,
      episodeName: name,
      showTitle: show.title,
      ...(aired !== undefined ? { aired } : {}),
    });
  }
  return items.sort((left, right) => (left.season ?? 0) - (right.season ?? 0) || (left.episode ?? 0) - (right.episode ?? 0));
}

export function parseTvmazeEpisodes(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const episode = entry as Record<string, unknown>;
    const season = Number(episode.season);
    const number = Number(episode.number);
    if (!Number.isFinite(season) || !Number.isFinite(number) || season < 1 || number < 1) continue;
    const rating = episode.rating;
    const average =
      typeof rating === 'object' && rating !== null ? (rating as { average?: unknown }).average : undefined;
    const value = Number(average);
    if (!Number.isFinite(value) || value <= 0 || value > 10) continue;
    out.set(`${season}:${number}`, String(average));
  }
  return out;
}

export function applyEpisodeRatings(items: MediaItem[], ratings: Map<string, string>): MediaItem[] {
  return items.map((item) => {
    if (item.rating !== '') return item;
    if (item.season === undefined || item.episode === undefined) return item;
    const score = ratings.get(`${item.season}:${item.episode}`);
    if (score === undefined) return item;
    return { ...item, rating: score };
  });
}

export function newReleaseYear(now = new Date()): number {
  return now.getFullYear();
}

export function filterNewFilms(items: readonly MediaItem[], now = new Date()): MediaItem[] {
  const floor = newReleaseYear(now) - 1;
  return items.filter((item) => item.kind === 'movie' && (item.year ?? 0) >= floor);
}

export function dedupeItems(items: readonly MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

interface CatalogServiceOptions {
  dataDir: string;
  fetch?: typeof fetch;
}

export function createCatalogService(options: CatalogServiceOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const { dataDir } = options;
  let bundleMem: { at: number; data: CatalogBundle } | null = null;
  const genreMem = new Map<string, { at: number; items: MediaItem[] }>();
  const metaMem = new Map<string, { at: number; data: TitleMeta }>();
  const metaInflight = new Map<string, Promise<TitleMeta | null>>();

  const fetchCatalog = async (path: string, kind: 'movie' | 'series'): Promise<MediaItem[]> => {
    const response = await fetchImpl(`${CINEMETA}${path}`, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!response.ok) return [];
    const body = (await response.json()) as { metas?: Array<Record<string, unknown>> };
    return (body.metas ?? [])
      .map((meta) => mapCinemetaMeta(meta, kind))
      .filter((item): item is MediaItem => item !== null);
  };

  const readDisk = (): CatalogBundle | null => {
    try {
      const parsed = JSON.parse(readFileSync(catalogCachePath(dataDir), 'utf8')) as CatalogBundle & { at?: number };
      if (!Array.isArray(parsed.moviesTop)) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const writeDisk = (data: CatalogBundle): void => {
    try {
      const path = catalogCachePath(dataDir);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ ...data, at: Date.now() }));
    } catch {
      // Catalog cache is optional.
    }
  };

  const loadBundle = async (): Promise<CatalogBundle> => {
    if (bundleMem !== null && Date.now() - bundleMem.at < BUNDLE_TTL_MS) return bundleMem.data;
    const disk = readDisk();
    if (disk !== null && bundleMem === null) {
      bundleMem = { at: Date.now() - BUNDLE_TTL_MS / 2, data: disk };
    }
    try {
      const [moviesTop, seriesTop, moviesRated, seriesRated, recentTv, moviesSkip] = await Promise.all([
        fetchCatalog('/catalog/movie/top.json', 'movie'),
        fetchCatalog('/catalog/series/top.json', 'series'),
        fetchCatalog('/catalog/movie/imdbRating.json', 'movie'),
        fetchCatalog('/catalog/series/imdbRating.json', 'series'),
        fetchCatalog('/catalog/series/last-videos.json', 'series'),
        fetchCatalog('/catalog/movie/top/skip=100.json', 'movie'),
      ]);
      const movies = dedupeItems([...moviesTop, ...moviesSkip]);
      const data: CatalogBundle = {
        moviesTop,
        seriesTop,
        moviesRated,
        seriesRated,
        recentTv,
        newFilms: filterNewFilms(movies),
        catalog: dedupeItems([...movies, ...seriesTop, ...moviesRated, ...seriesRated, ...recentTv]),
      };
      bundleMem = { at: Date.now(), data };
      writeDisk(data);
      return data;
    } catch {
      if (disk !== null) return disk;
      throw new Error('catalog-unavailable');
    }
  };

  const enrichEpisodeRatings = async (items: MediaItem[], imdb: string): Promise<MediaItem[]> => {
    if (items.length === 0 || items.every((item) => item.rating !== '')) return items;
    try {
      const lookup = await fetchImpl(`${TVMAZE}/lookup/shows?imdb=${encodeURIComponent(imdb)}`, {
        headers: { accept: 'application/json', 'user-agent': 'tvm-core' },
        signal: AbortSignal.timeout(FETCH_MS),
      });
      if (!lookup.ok) return items;
      const show = (await lookup.json()) as { id?: unknown };
      if (typeof show.id !== 'number') return items;
      const episodes = await fetchImpl(`${TVMAZE}/shows/${show.id}/episodes`, {
        headers: { accept: 'application/json', 'user-agent': 'tvm-core' },
        signal: AbortSignal.timeout(FETCH_MS),
      });
      if (!episodes.ok) return items;
      return applyEpisodeRatings(items, parseTvmazeEpisodes(await episodes.json()));
    } catch {
      return items;
    }
  };

  return {
    bundle: () => loadBundle(),

    async genre(kind: 'movie' | 'series', genre: string): Promise<MediaItem[]> {
      const key = `${kind}:${genre}`;
      const hit = genreMem.get(key);
      if (hit !== undefined && Date.now() - hit.at < GENRE_TTL_MS) return hit.items;
      const items = await fetchCatalog(
        `/catalog/${kind}/top/genre=${encodeURIComponent(genre)}.json`,
        kind,
      );
      genreMem.set(key, { at: Date.now(), items });
      return items;
    },

    async meta(id: string): Promise<TitleMeta | null> {
      const imdb = id.match(/tt\d+/i)?.[0]?.toLowerCase();
      if (imdb === undefined) return null;
      const hit = metaMem.get(imdb);
      if (hit !== undefined && Date.now() - hit.at < META_TTL_MS) return hit.data;
      const pending = metaInflight.get(imdb);
      if (pending !== undefined) return pending;

      const load = async (): Promise<TitleMeta | null> => {
        const readKind = async (kind: 'movie' | 'series'): Promise<TitleMeta | null> => {
          try {
            const response = await fetchImpl(`${CINEMETA}/meta/${kind}/${imdb}.json`, {
              signal: AbortSignal.timeout(FETCH_MS),
            });
            if (!response.ok) return null;
            const body = (await response.json()) as { meta?: Record<string, unknown> };
            if (body.meta === undefined) return null;
            const item = mapCinemetaMeta(body.meta, kind);
            if (item === null) return null;
            return {
              item,
              children: kind === 'series' ? mapCinemetaVideos(item, body.meta.videos) : [],
            };
          } catch {
            return null;
          }
        };
        const [movie, series] = await Promise.all([readKind('movie'), readKind('series')]);
        const picked = chooseCinemetaMeta(movie, series);
        if (picked === null) return null;
        const data =
          picked.children.length > 0
            ? { ...picked, children: await enrichEpisodeRatings(picked.children, imdb) }
            : picked;
        metaMem.set(imdb, { at: Date.now(), data });
        return data;
      };

      const promise = load().finally(() => {
        metaInflight.delete(imdb);
      });
      metaInflight.set(imdb, promise);
      return promise;
    },

    async search(query: string): Promise<MediaItem[]> {
      const needle = query.trim();
      if (needle.length < 2) return [];
      const encoded = encodeURIComponent(needle);
      const [movies, series] = await Promise.all([
        fetchCatalog(`/catalog/movie/top/search=${encoded}.json`, 'movie'),
        fetchCatalog(`/catalog/series/top/search=${encoded}.json`, 'series'),
      ]);
      return dedupeItems([...movies, ...series]);
    },

    clear(): void {
      bundleMem = null;
      genreMem.clear();
      metaMem.clear();
      try {
        unlinkSync(catalogCachePath(dataDir));
      } catch {
        // Missing cache is fine.
      }
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
