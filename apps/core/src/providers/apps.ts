import { readFileSync } from 'node:fs';
import { tmdbKeyPath } from '../update/paths.ts';
import { createCatalogService, type CatalogBundle, type CatalogService, type TitleMeta } from './cinemeta.ts';
import { HUB_SEEDS } from './hubSeeds.ts';
import { hueFor } from './title.ts';
import type { CatalogRail, MediaItem } from './types.ts';

const TVMAZE = 'https://api.tvmaze.com';
const TMDB = 'https://api.themoviedb.org/3';
const FETCH_MS = 12_000;
const HUB_TTL_MS = 20 * 60 * 1000;

export type AppLayout =
  | 'netflix'
  | 'prime'
  | 'max'
  | 'appletv'
  | 'disney'
  | 'hulu'
  | 'peacock'
  | 'hub';

export interface AppTileSpec {
  id: string;
  name: string;
  accent: string;
  wordmark: string;
  icon: string;
  url: string;
  layout: AppLayout;
  mock: boolean;
  ribbon: boolean;
}

export interface AppHub {
  id: string;
  name: string;
  accent: string;
  layout: AppLayout;
  wordmark: string;
  logo: string;
  disclaimer: string;
  hero: MediaItem | null;
  continueWatching: MediaItem[];
  rails: CatalogRail[];
}

export interface AppsCatalog {
  ribbon: AppTileSpec[];
  grid: AppTileSpec[];
}

interface HubSpec extends AppTileSpec {
  networks: readonly string[];
  tmdbProviders: readonly number[];
  movies: readonly string[];
}

const HUBS: readonly HubSpec[] = [
  {
    id: 'netflix',
    name: 'Netflix',
    accent: '#e50914',
    wordmark: 'NETFLIX',
    icon: '/apps/netflix.svg',
    url: 'https://www.netflix.com/',
    layout: 'netflix',
    mock: true,
    ribbon: true,
    networks: ['netflix'],
    tmdbProviders: [8],
    movies: ['tt1302006', 'tt7126948'],
  },
  {
    id: 'prime',
    name: 'Prime Video',
    accent: '#00a8e1',
    wordmark: 'prime video',
    icon: '/apps/marks/prime.svg',
    url: 'https://www.primevideo.com/',
    layout: 'prime',
    mock: true,
    ribbon: true,
    networks: ['amazon', 'prime video', 'amazon prime'],
    tmdbProviders: [9],
    movies: ['tt8111088'],
  },
  {
    id: 'max',
    name: 'HBO Max',
    accent: '#002be7',
    wordmark: 'max',
    icon: '/apps/marks/max.svg',
    url: 'https://www.max.com/',
    layout: 'max',
    mock: true,
    ribbon: true,
    networks: ['max', 'hbo max', 'hbo'],
    tmdbProviders: [1899, 384],
    movies: ['tt0903747'],
  },
  {
    id: 'appletv',
    name: 'Apple TV',
    accent: '#141414',
    wordmark: 'tv+',
    icon: '/apps/marks/appletv.svg',
    url: 'https://tv.apple.com/',
    layout: 'appletv',
    mock: true,
    ribbon: true,
    networks: ['apple tv+', 'apple tv'],
    tmdbProviders: [350],
    movies: ['tt9737326'],
  },
  {
    id: 'disney',
    name: 'Disney+',
    accent: '#113c8c',
    wordmark: 'disney+',
    icon: '/apps/marks/disney.svg',
    url: 'https://www.disneyplus.com/',
    layout: 'disney',
    mock: true,
    ribbon: true,
    networks: ['disney+', 'disney plus', 'disney'],
    tmdbProviders: [337],
    movies: ['tt2527338'],
  },
  {
    id: 'hulu',
    name: 'Hulu',
    accent: '#1ce783',
    wordmark: 'hulu',
    icon: '/apps/marks/hulu.svg',
    url: 'https://www.hulu.com/',
    layout: 'hulu',
    mock: true,
    ribbon: true,
    networks: ['hulu'],
    tmdbProviders: [15],
    movies: [],
  },
  {
    id: 'peacock',
    name: 'Peacock',
    accent: '#000000',
    wordmark: 'peacock',
    icon: '/apps/marks/peacock.svg',
    url: 'https://www.peacocktv.com/',
    layout: 'peacock',
    mock: true,
    ribbon: true,
    networks: ['peacock'],
    tmdbProviders: [386],
    movies: [],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    accent: '#ffffff',
    wordmark: 'YouTube',
    icon: '/apps/youtube.svg',
    url: 'https://www.youtube.com/tv',
    layout: 'hub',
    mock: false,
    ribbon: false,
    networks: ['youtube'],
    tmdbProviders: [],
    movies: [],
  },
  {
    id: 'freevee',
    name: 'Freevee',
    accent: '#111111',
    wordmark: 'freevee',
    icon: '/apps/marks/freevee.svg',
    url: 'https://www.amazon.com/gp/video/storefront/freevee',
    layout: 'hub',
    mock: false,
    ribbon: false,
    networks: ['freevee', 'imdb tv'],
    tmdbProviders: [],
    movies: ['tt10872600'],
  },
  {
    id: 'iplayer',
    name: 'BBC iPlayer',
    accent: '#ff4d24',
    wordmark: 'iPlayer',
    icon: '/apps/marks/iplayer.svg',
    url: 'https://www.bbc.co.uk/iplayer',
    layout: 'hub',
    mock: false,
    ribbon: false,
    networks: ['bbc', 'bbc one', 'bbc two', 'bbc iplayer'],
    tmdbProviders: [],
    movies: [],
  },
  {
    id: 'paramount',
    name: 'Paramount+',
    accent: '#0062b4',
    wordmark: 'paramount+',
    icon: '/apps/marks/paramount.svg',
    url: 'https://www.paramountplus.com/',
    layout: 'hub',
    mock: false,
    ribbon: false,
    networks: ['paramount+', 'paramount', 'cbs'],
    tmdbProviders: [],
    movies: [],
  },
  {
    id: 'tubi',
    name: 'Tubi',
    accent: '#fa382f',
    wordmark: 'tubi',
    icon: '/apps/marks/tubi.svg',
    url: 'https://tubitv.com/',
    layout: 'hub',
    mock: false,
    ribbon: false,
    networks: ['tubi'],
    tmdbProviders: [],
    movies: [],
  },
  {
    id: 'pluto',
    name: 'Pluto TV',
    accent: '#000000',
    wordmark: 'Pluto TV',
    icon: '/apps/marks/pluto.svg',
    url: 'https://pluto.tv/',
    layout: 'hub',
    mock: false,
    ribbon: false,
    networks: ['pluto tv', 'pluto'],
    tmdbProviders: [],
    movies: [],
  },
  {
    id: 'starz',
    name: 'Starz',
    accent: '#121212',
    wordmark: 'STARZ',
    icon: '/apps/marks/starz.svg',
    url: 'https://www.starz.com/',
    layout: 'hub',
    mock: false,
    ribbon: false,
    networks: ['starz'],
    tmdbProviders: [],
    movies: [],
  },
  {
    id: 'fox',
    name: 'Fox',
    accent: '#000000',
    wordmark: 'FOX',
    icon: '/apps/marks/fox.svg',
    url: 'https://www.fox.com/',
    layout: 'hub',
    mock: false,
    ribbon: false,
    networks: ['fox', 'fx'],
    tmdbProviders: [],
    movies: [],
  },
];

const TVM_STREAM_TILE: AppTileSpec = {
  id: 'tvm-stream',
  name: 'TVM Stream',
  accent: '#5b3dff',
  wordmark: 'TVM',
  icon: '/apps/tvm.svg',
  url: 'internal:library',
  layout: 'hub',
  mock: false,
  ribbon: true,
};

function asTile(spec: HubSpec): AppTileSpec {
  return {
    id: spec.id,
    name: spec.name,
    accent: spec.accent,
    wordmark: spec.wordmark,
    icon: spec.icon,
    url: spec.url,
    layout: spec.layout,
    mock: spec.mock,
    ribbon: spec.ribbon,
  };
}

export function hubSpec(id: string): HubSpec | undefined {
  return HUBS.find((hub) => hub.id === id);
}

export function listApps(): AppsCatalog {
  return {
    ribbon: [TVM_STREAM_TILE, ...HUBS.filter((hub) => hub.ribbon).map(asTile)],
    grid: [TVM_STREAM_TILE, ...HUBS.map(asTile)],
  };
}

export function matchStudio(show: unknown, needles: readonly string[]): boolean {
  if (show === null || typeof show !== 'object') return false;
  const record = show as { network?: { name?: unknown }; webChannel?: { name?: unknown } };
  const names = [record.webChannel?.name, record.network?.name]
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.toLowerCase());
  if (names.length === 0) return false;
  const haystack = names.join(' | ');
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}

function stubItem(id: string, title: string, kind: MediaItem['kind']): MediaItem {
  return {
    id,
    title,
    year: null,
    kind,
    synopsis: '',
    poster: '',
    backdrop: '',
    genres: [],
    rating: '',
    playable: true,
    hue: hueFor(title),
  };
}

function seriesFromBundle(bundle: CatalogBundle): MediaItem[] {
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const item of [...bundle.seriesTop, ...bundle.seriesRated, ...bundle.recentTv, ...bundle.catalog]) {
    if (item.kind !== 'series' || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function uniqueItems(items: readonly MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const item of items) {
    if (seen.has(item.id) || seen.has(item.title.toLowerCase())) continue;
    seen.add(item.id);
    seen.add(item.title.toLowerCase());
    out.push({ ...item, playable: true });
  }
  return out;
}

function readTmdbKey(dataDir: string, env: NodeJS.ProcessEnv): string {
  const fromEnv = env['TVM_TMDB_KEY']?.trim();
  if (fromEnv) return fromEnv;
  try {
    return readFileSync(tmdbKeyPath(dataDir), 'utf8').trim();
  } catch {
    return '';
  }
}

export interface AppsServiceOptions {
  dataDir?: string;
  fetch?: typeof fetch;
  catalog?: Pick<CatalogService, 'bundle' | 'meta'>;
  continueWatching?: () => Promise<MediaItem[]>;
  env?: NodeJS.ProcessEnv;
}

export function createAppsService(options: AppsServiceOptions = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const dataDir = options.dataDir ?? '';
  const env = options.env ?? process.env;
  const catalog = options.catalog ?? createCatalogService({ dataDir, fetch: fetchImpl });
  const cache = new Map<string, { at: number; hub: AppHub }>();

  const lookupShow = async (imdb: string): Promise<unknown> => {
    const response = await fetchImpl(`${TVMAZE}/lookup/shows?imdb=${encodeURIComponent(imdb)}`, {
      headers: { accept: 'application/json', 'user-agent': 'tvm-core' },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (!response.ok) return null;
    return response.json();
  };

  const hydrate = async (ids: readonly string[], kind: MediaItem['kind']): Promise<MediaItem[]> => {
    const items: MediaItem[] = [];
    for (let i = 0; i < ids.length; i += 6) {
      const batch = ids.slice(i, i + 6);
      const mapped = await Promise.all(
        batch.map(async (id) => {
          try {
            const meta: TitleMeta | null = await catalog.meta(id);
            if (meta !== null) return { ...meta.item, playable: true };
          } catch {
            // Fall through to a stub so the rail still has a card.
          }
          return stubItem(id, id, kind);
        }),
      );
      items.push(...mapped);
    }
    return uniqueItems(items);
  };

  const tmdbDiscover = async (providers: readonly number[], media: 'movie' | 'tv'): Promise<string[]> => {
    const key = readTmdbKey(dataDir, env);
    if (key === '' || providers.length === 0) return [];
    const ids: string[] = [];
    try {
      const list = await fetchImpl(
        `${TMDB}/discover/${media}?api_key=${encodeURIComponent(key)}&watch_region=US&with_watch_providers=${providers.join('|')}&with_watch_monetization_types=flatrate&sort_by=popularity.desc`,
        { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_MS) },
      );
      if (!list.ok) return [];
      const body = (await list.json()) as { results?: Array<{ id?: number }> };
      for (const row of body.results ?? []) {
        if (typeof row.id !== 'number') continue;
        const extra = await fetchImpl(`${TMDB}/${media}/${row.id}/external_ids?api_key=${encodeURIComponent(key)}`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(FETCH_MS),
        });
        if (!extra.ok) continue;
        const idsBody = (await extra.json()) as { imdb_id?: string };
        if (typeof idsBody.imdb_id === 'string' && /^tt\d+$/i.test(idsBody.imdb_id)) ids.push(idsBody.imdb_id);
        if (ids.length >= 16) break;
      }
    } catch {
      return ids;
    }
    return ids;
  };

  return {
    list(): AppsCatalog {
      return listApps();
    },

    async hub(id: string): Promise<AppHub | null> {
      const spec = hubSpec(id);
      if (spec === undefined) return null;
      const hit = cache.get(id);
      if (hit !== undefined && Date.now() - hit.at < HUB_TTL_MS) return hit.hub;

      const seeds = HUB_SEEDS[id];
      let originals: MediaItem[] = [];
      try {
        const bundle = await catalog.bundle();
        const candidates = seriesFromBundle(bundle).slice(0, 40);
        const matched: MediaItem[] = [];
        for (const item of candidates) {
          const imdb = item.id.match(/tt\d+/i)?.[0];
          if (imdb === undefined) continue;
          try {
            const show = await lookupShow(imdb);
            if (matchStudio(show, spec.networks)) matched.push({ ...item, playable: true });
          } catch {
            // Skip titles TVMaze does not know.
          }
          if (matched.length >= 12) break;
        }
        originals = matched;
      } catch {
        originals = [];
      }

      const seedOriginals = await hydrate(seeds?.originals ?? spec.movies, 'series');
      originals = uniqueItems([...originals, ...seedOriginals]);

      const licensedMovies = uniqueItems([
        ...(await hydrate(seeds?.movies ?? spec.movies, 'movie')),
        ...(await hydrate(await tmdbDiscover(spec.tmdbProviders, 'movie'), 'movie')),
      ]);
      const licensedSeries = uniqueItems([
        ...(await hydrate(seeds?.series ?? [], 'series')),
        ...(await hydrate(await tmdbDiscover(spec.tmdbProviders, 'tv'), 'series')),
      ]);

      const pool = uniqueItems([...originals, ...licensedMovies, ...licensedSeries]);
      const seeded = pool.length > 0 ? pool : uniqueItems(await hydrate([...(seeds?.movies ?? spec.movies), ...(seeds?.originals ?? [])], 'movie'));
      const hero = seeded.find((item) => item.backdrop !== '') ?? seeded[0] ?? stubItem(spec.id, spec.name, 'movie');

      let continueWatching: MediaItem[] = [];
      if (options.continueWatching !== undefined) {
        try {
          const watching = await options.continueWatching();
          const ids = new Set(seeded.map((item) => item.id.replace(/:.*$/, '')));
          continueWatching = watching.filter((item) => ids.has(item.id.replace(/:.*$/, ''))).slice(0, 12);
        } catch {
          continueWatching = [];
        }
      }

      const rails: CatalogRail[] = [];
      if (originals.length > 0) {
        rails.push({ id: `${id}-series`, title: `${spec.name} originals`, items: originals.slice(0, 16) });
      }
      if (licensedMovies.length > 0) {
        rails.push({ id: `${id}-films`, title: `Popular films`, items: licensedMovies.slice(0, 16) });
      }
      if (licensedSeries.length > 0) {
        rails.push({ id: `${id}-shows`, title: `Popular series`, items: licensedSeries.slice(0, 16) });
      }
      if (rails.length === 0 && seeded.length > 0) {
        rails.push({ id: `${id}-films`, title: 'Popular now', items: seeded.slice(0, 16) });
      }

      const hub: AppHub = {
        id: spec.id,
        name: spec.name,
        accent: spec.accent,
        layout: spec.layout,
        wordmark: spec.wordmark,
        logo: spec.icon,
        disclaimer: `Not the licensed ${spec.name} app. Playback uses TVM Stream / Real-Debrid.`,
        hero,
        continueWatching,
        rails,
      };
      cache.set(id, { at: Date.now(), hub });
      return hub;
    },
  };
}

export type AppsService = ReturnType<typeof createAppsService>;
