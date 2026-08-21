import { APPS, MORE_APPS, TITLES, TVM_STREAM, type AppTile } from './catalog';
import { toMediaItem } from './media';

export const MOCK_APP_IDS = ['netflix', 'prime', 'max', 'appletv', 'disney', 'hulu', 'peacock'] as const;
export type MockAppId = (typeof MOCK_APP_IDS)[number];
export const HUB_APP_IDS = [
  ...MOCK_APP_IDS,
  'youtube',
  'freevee',
  'iplayer',
  'paramount',
  'tubi',
  'pluto',
  'starz',
  'fox',
] as const;

export function isMockApp(id: string): boolean {
  return (MOCK_APP_IDS as readonly string[]).includes(id);
}

export function isHubApp(id: string): boolean {
  return (HUB_APP_IDS as readonly string[]).includes(id);
}

export type AppTileOpen = { kind: 'service'; id: string } | { kind: 'library' };

/** Every catalog tile opens the service hub. TVM Stream is the library, not a hub. */
export function appTileOpen(id: string): AppTileOpen {
  if (id === 'tvm-stream') return { kind: 'library' };
  return { kind: 'service', id };
}

export interface AppsCatalog {
  ribbon: AppTile[];
  grid: AppTile[];
}

function asTile(entry: {
  id: string;
  name: string;
  accent: string;
  wordmark?: string;
  icon?: string;
  url?: string;
}): AppTile {
  return {
    id: entry.id,
    name: entry.name,
    accent: entry.accent,
    url: entry.url ?? (isMockApp(entry.id) ? 'internal:mock' : ''),
    wordmark: entry.wordmark,
    icon: entry.icon,
  };
}

export function fallbackApps(): AppsCatalog {
  return {
    ribbon: [TVM_STREAM, ...APPS],
    grid: [TVM_STREAM, ...APPS, ...MORE_APPS],
  };
}

/** Name / wordmark / id match used by Home search. */
export function searchApps(query: string, catalog: AppsCatalog = fallbackApps()): AppTile[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const seen = new Set<string>();
  const out: AppTile[] = [];
  for (const app of [...catalog.ribbon, ...catalog.grid]) {
    if (seen.has(app.id)) continue;
    const hay = `${app.name} ${app.wordmark ?? ''} ${app.id}`.toLowerCase();
    if (!hay.includes(needle)) continue;
    seen.add(app.id);
    out.push(app);
  }
  return out;
}

export async function fetchApps(): Promise<AppsCatalog> {
  try {
    const response = await fetch('/api/apps');
    if (!response.ok) return fallbackApps();
    const body = (await response.json()) as { ribbon?: unknown; grid?: unknown };
    const ribbon = Array.isArray(body.ribbon) ? body.ribbon.map((entry) => asTile(entry as AppTile)) : [];
    const grid = Array.isArray(body.grid) ? body.grid.map((entry) => asTile(entry as AppTile)) : [];
    if (ribbon.length === 0) return fallbackApps();
    return { ribbon, grid: grid.length > 0 ? grid : ribbon };
  } catch {
    return fallbackApps();
  }
}

export interface AppHubPayload {
  id: string;
  name: string;
  accent: string;
  layout: string;
  wordmark: string;
  logo: string;
  disclaimer: string;
  hero: import('./media').MediaItem | null;
  continueWatching: import('./media').MediaItem[];
  rails: Array<{ id: string; title: string; items: import('./media').MediaItem[] }>;
}

const hubCache = new Map<string, AppHubPayload>();
const hubInflight = new Map<string, Promise<AppHubPayload>>();

export function peekAppHub(id: string): AppHubPayload | null {
  return hubCache.get(id) ?? null;
}

export function invalidateAppHubs(): void {
  hubCache.clear();
  hubInflight.clear();
}

/** Start the hub catalog fetch without waiting. Safe to call from focus. */
export function prefetchAppHub(id: string): void {
  if (!isHubApp(id)) return;
  void fetchAppHub(id);
}

function hubLayout(id: string): string {
  return isMockApp(id) ? id : 'hub';
}

/** Local catalog used when the core hub endpoint is down, so mock apps still open. */
export function fallbackAppHub(id: string): AppHubPayload {
  const tile = [...APPS, ...MORE_APPS].find((entry) => entry.id === id);
  const films = TITLES.filter((title) => title.kind === 'movie').slice(0, 16);
  const shows = TITLES.filter((title) => title.kind === 'series').slice(0, 16);
  const lead = TITLES[0];
  return {
    id,
    name: tile?.name ?? 'App',
    accent: tile?.accent ?? '#ff7a4a',
    layout: hubLayout(id),
    wordmark: tile?.wordmark ?? tile?.name ?? 'App',
    logo: tile?.icon ?? '',
    disclaimer: 'Local catalog. Playback uses TVM Stream.',
    hero: lead === undefined ? null : toMediaItem(lead),
    continueWatching: [],
    rails: [
      { id: `${id}-films`, title: 'Movies', items: films.map(toMediaItem) },
      { id: `${id}-shows`, title: 'Series', items: shows.map(toMediaItem) },
      { id: `${id}-trending`, title: 'Trending now', items: TITLES.slice(0, 16).map(toMediaItem) },
    ],
  };
}

async function loadAppHub(id: string): Promise<AppHubPayload> {
  try {
    const response = await fetch(`/api/apps/${encodeURIComponent(id)}`);
    if (response.ok) {
      const payload = (await response.json()) as AppHubPayload;
      hubCache.set(id, payload);
      return payload;
    }
  } catch {
    // Core is optional. Mock hubs still open from the bundled catalog.
  }
  const local = fallbackAppHub(id);
  hubCache.set(id, local);
  return local;
}

export async function fetchAppHub(id: string): Promise<AppHubPayload> {
  const cached = hubCache.get(id);
  if (cached !== undefined) return cached;
  const pending = hubInflight.get(id);
  if (pending !== undefined) return pending;
  const request = loadAppHub(id).finally(() => {
    hubInflight.delete(id);
  });
  hubInflight.set(id, request);
  return request;
}
