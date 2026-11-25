import { isMockApp } from './apps';
import { getServicesContent, type ServiceEntry } from './content';
import { openDetails } from './openDetails';
import { APPS, MORE_APPS, type AppTile, type Title } from './catalog';
import { apiFetch, currentProfileId, looksLikePack, matchLibraryItems, sortEpisodes, type MediaItem } from './media';
import type { Navigate } from '../nav/ViewStackContext';

const NETWORK_TO_APP: Record<string, string> = {
  'prime video': 'prime',
  netflix: 'netflix',
  starz: 'starz',
  showtime: 'paramount',
  'pluto tv': 'pluto',
  peacock: 'peacock',
  tubi: 'tubi',
  fox: 'fox',
  'paramount+': 'paramount',
  'disney+': 'disney',
  hulu: 'hulu',
  youtube: 'youtube',
  max: 'max',
  'hbo max': 'max',
  'bbc iplayer': 'iplayer',
  'apple tv+': 'appletv',
  'apple tv': 'appletv',
  freevee: 'freevee',
};

export function allApps(): readonly AppTile[] {
  return [...APPS, ...MORE_APPS];
}

export function appById(id: string): AppTile | undefined {
  return allApps().find((app) => app.id === id);
}

export function appIdForNetwork(network?: string): string | undefined {
  if (network === undefined || network === '') return undefined;
  return NETWORK_TO_APP[network.toLowerCase()];
}

export function serviceSearchUrl(appId: string, title: string): string {
  const query = encodeURIComponent(title);
  switch (appId) {
    case 'netflix':
      return `https://www.netflix.com/search?q=${query}`;
    case 'prime':
      return `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${query}`;
    case 'youtube':
      return `https://www.youtube.com/results?search_query=${query}`;
    case 'disney':
      return `https://www.disneyplus.com/search`;
    case 'hulu':
      return `https://www.hulu.com/search?q=${query}`;
    case 'freevee':
      return `https://www.amazon.com/s?k=${query}&i=instant-video`;
    case 'max':
      return `https://play.max.com/search/result?q=${query}`;
    case 'iplayer':
      return `https://www.bbc.co.uk/iplayer/search?q=${query}`;
    case 'appletv':
      return `https://tv.apple.com/search?term=${query}`;
    case 'peacock':
      return `https://www.peacocktv.com/watch/search?q=${query}`;
    case 'paramount':
      return `https://www.paramountplus.com/search/?q=${query}`;
    case 'tubi':
      return `https://tubitv.com/search/${query}`;
    case 'pluto':
      return `https://pluto.tv/search/details?query=${query}`;
    case 'starz':
      return `https://www.starz.com/us/en/search?q=${query}`;
    case 'fox':
      return `https://www.fox.com/search/${query}`;
    default:
      return appById(appId)?.url ?? '';
  }
}

export function watchSource(title: Title, library: readonly MediaItem[]): string {
  if (title.id.startsWith('tt') || title.playable === true || matchLibraryItems(title, library).length > 0) {
    return 'TVM Stream';
  }
  return title.network ?? 'TVM';
}

export type WatchAction =
  | { kind: 'play'; id: string }
  | { kind: 'details'; id: string }
  | { kind: 'service'; appId: string; url?: string };

export function resolveWatch(title: Title, library: readonly MediaItem[]): WatchAction {
  if (title.id.startsWith('tt')) {
    if (title.kind === 'series' && title.progress === undefined) return { kind: 'details', id: title.id };
    return { kind: 'play', id: title.id };
  }

  if (title.id.startsWith('rd:') || title.playable === true) {
    const item = library.find((entry) => entry.id === title.id);
    if (title.kind === 'series' || looksLikePack(title.title, item?.filename ?? '')) {
      const owned = matchLibraryItems(title, library);
      const resume = owned.find((entry) => entry.progress !== undefined && !looksLikePack(entry.title, entry.filename ?? ''));
      if (resume !== undefined) return { kind: 'play', id: resume.id };
      const episode = sortEpisodes(owned.filter((entry) => entry.playable && entry.season !== undefined))[0];
      if (episode !== undefined) return { kind: 'play', id: episode.id };
      return { kind: 'details', id: title.id };
    }
    return { kind: 'play', id: title.id };
  }

  const owned = matchLibraryItems(title, library);
  const resume = owned.find((entry) => entry.progress !== undefined && !looksLikePack(entry.title, entry.filename ?? ''));
  if (resume !== undefined) return { kind: 'play', id: resume.id };
  if (title.kind === 'series' && owned.length > 0) {
    const episode = sortEpisodes(owned.filter((entry) => entry.playable && entry.season !== undefined))[0];
    if (episode !== undefined) return { kind: 'play', id: episode.id };
    return { kind: 'details', id: title.id };
  }
  const movie = owned.find((entry) => entry.playable && !looksLikePack(entry.title, entry.filename ?? ''));
  if (movie !== undefined) return { kind: 'play', id: movie.id };
  if (owned.length > 0) return { kind: 'details', id: title.id };

  const appId = appIdForNetwork(title.network);
  if (appId !== undefined) {
    if (isMockApp(appId)) return { kind: 'service', appId };
    return { kind: 'service', appId, url: serviceSearchUrl(appId, title.title) };
  }
  return { kind: 'details', id: title.id };
}

export function performWatch(navigate: Navigate, action: WatchAction, title?: Title): void {
  if (action.kind === 'play') {
    navigate.pushModal('player', {
      params: {
        id: action.id,
        ...(title !== undefined ? { title: title.title } : {}),
      },
    });
    return;
  }
  if (action.kind === 'service') {
    navigate.push('service', {
      params: {
        id: action.appId,
        ...(action.url !== undefined ? { url: action.url } : {}),
      },
    });
    return;
  }
  if (title !== undefined) {
    openDetails(navigate, title);
    return;
  }
  navigate.push('details', { params: { id: action.id } });
}

export type ConnectedServiceStatus = ServiceEntry & { connected: boolean };

function connectedStorageKey(profileId = currentProfileId()): string {
  return `tvm.services.connected.${profileId || 'default'}`;
}

function readLocalConnectedIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(connectedStorageKey());
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set();
  }
}

function writeLocalConnectedIds(ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(connectedStorageKey(), JSON.stringify([...ids]));
  } catch {
    // Ignore private mode / storage quota errors.
  }
}

export function serviceUrlForTitle(service: Pick<ServiceEntry, 'search' | 'home'>, title: string): string {
  if (service.search !== null && service.search !== '') {
    return service.search.replace('{q}', encodeURIComponent(title));
  }
  return service.home;
}

export function openServiceExternal(url: string, service?: Pick<ServiceEntry, 'id' | 'ios' | 'android'>): Window | null {
  if (typeof window === 'undefined') return null;
  const nativeBridge = (
    window as Window & {
      tvmServices?: { openExternal?: (target: string, meta?: unknown) => boolean };
    }
  ).tvmServices;
  if (typeof nativeBridge?.openExternal === 'function') {
    if (nativeBridge.openExternal(url, service)) return null;
  }
  try {
    return window.open(url, 'tvm-service', 'popup,width=1280,height=800');
  } catch {
    try {
      return window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      return null;
    }
  }
}

export async function fetchServices(): Promise<ConnectedServiceStatus[]> {
  const bundled = getServicesContent().services;
  try {
    const res = await apiFetch('/api/services', { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const body = (await res.json()) as { services?: Array<Partial<ServiceEntry> & { id: string; connected?: boolean }> };
      if (Array.isArray(body.services) && body.services.length > 0) {
        const connectedMap = new Map(body.services.map((entry) => [entry.id, entry.connected === true]));
        return bundled.map((svc) => ({
          ...svc,
          connected: connectedMap.get(svc.id) === true,
        }));
      }
    }
  } catch {
    // Fall back to local connected flags per profile.
  }
  const localIds = readLocalConnectedIds();
  return bundled.map((svc) => ({ ...svc, connected: localIds.has(svc.id) }));
}

export async function setServiceConnected(id: string, connected: boolean): Promise<ConnectedServiceStatus[]> {
  const local = readLocalConnectedIds();
  if (connected) local.add(id);
  else local.delete(id);
  writeLocalConnectedIds(local);

  try {
    const res = await apiFetch('/api/services/connected', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, connected }),
    });
    if (res.ok) return fetchServices();
  } catch {
    // Older/mobile Core: local fallback already saved.
  }
  const bundled = getServicesContent().services;
  return bundled.map((svc) => ({ ...svc, connected: local.has(svc.id) }));
}
