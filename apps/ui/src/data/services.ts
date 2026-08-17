import { isMockApp } from './apps';
import { openDetails } from './openDetails';
import { APPS, MORE_APPS, type AppTile, type Title } from './catalog';
import { looksLikePack, matchLibraryItems, sortEpisodes, type MediaItem } from './media';
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
