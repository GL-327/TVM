import { APPS, MORE_APPS, TVM_STREAM, type AppTile } from './catalog';

export const MOCK_APP_IDS = ['netflix', 'prime', 'max', 'appletv', 'disney', 'hulu', 'peacock'] as const;
export type MockAppId = (typeof MOCK_APP_IDS)[number];

export function isMockApp(id: string): boolean {
  return (MOCK_APP_IDS as readonly string[]).includes(id);
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

export async function fetchAppHub(id: string): Promise<AppHubPayload | null> {
  try {
    const response = await fetch(`/api/apps/${encodeURIComponent(id)}`);
    if (!response.ok) return null;
    return (await response.json()) as AppHubPayload;
  } catch {
    return null;
  }
}
