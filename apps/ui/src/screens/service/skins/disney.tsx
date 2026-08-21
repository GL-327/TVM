import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Artwork } from '../../../components/Artwork';
import { EmptyState } from '../../../components/EmptyState';
import { FocusButton } from '../../../components/FocusButton';
import { HeroArt } from '../../../components/HeroArt';
import { Rail } from '../../../components/Rail';
import { Skeleton } from '../../../components/Skeleton';
import { preferBackdrop } from '../../../data/artwork';
import { fetchAppHub, type AppHubPayload } from '../../../data/apps';
import { TITLES, type Title } from '../../../data/catalog';
import { asTitle, fetchWatchlist, toMediaItem, type MediaItem } from '../../../data/media';
import { openDetails, openPlayback } from '../../../data/openDetails';
import { certificateLabel } from '../../../data/playId';
import { requestFocus } from '../../../nav/focusEngine';
import { revealFocused } from '../../../nav/revealFocused';
import { useFocusScope, useNavigate, useScopedFocusKey, type Navigate } from '../../../nav/ViewStackContext';
import { wrapFocusId } from '../../../nav/wrapFocus';
import { playLabel, type Lane } from '../layouts';
import './disney.css';

export type HubCatalog = {
  rails?: AppHubPayload['rails'];
  continueWatching?: AppHubPayload['continueWatching'];
  watchlist?: Array<MediaItem | Title>;
  hero?: AppHubPayload['hero'];
  items?: Array<MediaItem | Title>;
};

/** Props the Service dispatcher passes through (hub, catalog, navigate, play). */
export type ServiceHubProps = {
  hub?: AppHubPayload | null;
  appId?: string;
  catalog?: AppHubPayload | HubCatalog | readonly Title[];
  items?: Array<MediaItem | Title>;
  rails?: AppHubPayload['rails'];
  lane?: Lane;
  category?: Lane | string;
  onLane?: (lane: Lane) => void;
  onBack?: () => void;
  onPlay?: (title: Title) => void;
  onOpen?: (title: Title) => void;
  play?: (title: Title) => void;
  navigate?: Navigate;
};

export type DisneyHubProps = ServiceHubProps;

function isHubPayload(value: ServiceHubProps['catalog']): value is AppHubPayload {
  return value !== undefined && !Array.isArray(value) && 'layout' in value && 'id' in value;
}

function catalogWatchlist(catalog: ServiceHubProps['catalog']): Array<MediaItem | Title> | undefined {
  if (catalog === undefined || Array.isArray(catalog) || !('watchlist' in catalog)) return undefined;
  return catalog.watchlist;
}

function catalogRails(catalog: ServiceHubProps['catalog']): AppHubPayload['rails'] | undefined {
  if (catalog === undefined || Array.isArray(catalog) || !('rails' in catalog)) return undefined;
  return catalog.rails;
}

function catalogItems(catalog: ServiceHubProps['catalog']): Array<MediaItem | Title> {
  if (catalog === undefined) return [];
  if (Array.isArray(catalog)) return [...catalog];
  if ('items' in catalog && catalog.items !== undefined) return catalog.items;
  return [];
}

export const DISNEY_TABS: Array<{ id: Lane; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'movies', label: 'Movies' },
  { id: 'shows', label: 'Series' },
  { id: 'new', label: 'Originals' },
  { id: 'list', label: 'Watchlist' },
];

export type DisneyBrand = 'disney' | 'pixar' | 'marvel' | 'starwars' | 'natgeo';

export const DISNEY_BRANDS: Array<{ id: DisneyBrand; label: string }> = [
  { id: 'disney', label: 'Disney' },
  { id: 'pixar', label: 'Pixar' },
  { id: 'marvel', label: 'Marvel' },
  { id: 'starwars', label: 'Star Wars' },
  { id: 'natgeo', label: 'Nat Geo' },
];

export type DisneyNavItem =
  | { id: string; kind: 'tab'; lane: Lane; label: string }
  | { id: string; kind: 'search'; label: string };

export function disneyNavItems(): DisneyNavItem[] {
  return [
    { id: 'service-tab-home', kind: 'tab', lane: 'home', label: 'Home' },
    { id: 'disney-search', kind: 'search', label: 'Search' },
    { id: 'service-tab-list', kind: 'tab', lane: 'list', label: 'Watchlist' },
    { id: 'service-tab-movies', kind: 'tab', lane: 'movies', label: 'Movies' },
    { id: 'service-tab-shows', kind: 'tab', lane: 'shows', label: 'Series' },
    { id: 'service-tab-new', kind: 'tab', lane: 'new', label: 'Originals' },
  ];
}

export function wrapHubFocus(
  direction: string,
  index: number,
  total: number,
  firstId: string,
  lastId: string,
): string | null {
  return wrapFocusId(direction, index, total, firstId, lastId);
}

/** Conveyor clones use `--0` / `--2`. The focusable copy has no suffix. */
export function disneyCardId(prefix: string, titleId: string, loopCopy = 1): string {
  return loopCopy !== 1 ? `${prefix}-${titleId}--${loopCopy}` : `${prefix}-${titleId}`;
}

export function disneyCardIds(prefix: string, titles: readonly Title[]): string[] {
  return titles.map((title) => disneyCardId(prefix, title.id));
}

export function disneyActivateTarget(title: Title): 'player' | 'details' {
  return title.kind === 'series' ? 'details' : 'player';
}

export function activateDisneyTitle(
  title: Title,
  playFn: (title: Title) => void,
  openFn: (title: Title) => void,
): 'player' | 'details' {
  const target = disneyActivateTarget(title);
  if (target === 'details') openFn(title);
  else playFn(title);
  return target;
}

export const DISNEY_RAIL_CAP = 16;

export function capDisneyRail(titles: readonly Title[], cap = DISNEY_RAIL_CAP): Title[] {
  return titles.length > cap ? titles.slice(0, cap) : [...titles];
}

export function laneFromCategory(value: string | undefined): Lane | undefined {
  if (value === 'home' || value === 'shows' || value === 'movies' || value === 'list' || value === 'new' || value === 'kids') {
    return value;
  }
  if (value === 'series' || value === 'tv') return 'shows';
  if (value === 'originals' || value === 'sports') return 'new';
  if (value === 'watchlist' || value === 'mylist' || value === 'my-list') return 'list';
  return undefined;
}

export function toHubTitle(value: MediaItem | Title): Title {
  const next = asTitle({
    id: value.id,
    title: value.title,
    year: typeof value.year === 'number' ? value.year : 0,
    kind: value.kind === 'series' ? 'series' : 'movie',
    synopsis: value.synopsis,
    poster: value.poster,
    backdrop: value.backdrop,
    genres: [...value.genres],
    rating: value.rating,
    runtime: value.runtime,
    playable: !('playable' in value) || value.playable !== false,
    hue: value.hue,
    progress: value.progress,
  });
  return {
    ...next,
    seasons: 'seasons' in value ? value.seasons : next.seasons,
    episodeLabel: 'episodeLabel' in value ? (value.episodeLabel ?? next.episodeLabel) : next.episodeLabel,
    network: 'network' in value ? value.network : next.network,
  };
}

export function uniqueTitles(titles: readonly Title[]): Title[] {
  const seen = new Set<string>();
  const out: Title[] = [];
  for (const title of titles) {
    const key = title.id !== '' ? title.id : title.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

export function isOriginalTitle(title: Title, originalIds: ReadonlySet<string>): boolean {
  if (originalIds.has(title.id)) return true;
  return title.kind === 'series' && (title.year >= 2019 || title.year === 0);
}

export function disneyTitleMatches(title: Title, lane: Lane, originalIds: ReadonlySet<string>): boolean {
  if (lane === 'home' || lane === 'list') return true;
  if (lane === 'movies') return title.kind === 'movie';
  if (lane === 'shows') return title.kind === 'series';
  if (lane === 'kids') return title.genres.some((genre) => /family|animation|kids|children/i.test(genre));
  if (lane === 'new') return isOriginalTitle(title, originalIds);
  return true;
}

export function disneyBrandMatches(title: Title, brand: DisneyBrand): boolean {
  const name = title.title.toLowerCase();
  const genres = title.genres.map((genre) => genre.toLowerCase());
  if (brand === 'marvel') return /avengers|spider|infinity|endgame/.test(name) || (genres.includes('action') && title.kind === 'movie');
  if (brand === 'starwars') return /star wars|mandalorian/.test(name) || genres.includes('science fiction');
  if (brand === 'pixar') return genres.includes('animation');
  if (brand === 'disney') return genres.includes('animation') || genres.includes('family') || /avatar|titanic/.test(name);
  return genres.includes('history') || genres.includes('adventure') || /dune|avatar|interstellar|oppenheimer/.test(name);
}

export function pickBrandTitles(titles: readonly Title[], brand: DisneyBrand): Title[] {
  const matched = titles.filter((title) => disneyBrandMatches(title, brand));
  return matched.length > 0 ? matched : [...titles];
}

export function disneyFallbackHub(): AppHubPayload {
  const movies = TITLES.filter((title) => title.kind === 'movie');
  const shows = TITLES.filter((title) => title.kind === 'series');
  const lead = TITLES.find((title) => title.id === 'avatar') ?? TITLES[0];
  return {
    id: 'disney',
    name: 'Disney+',
    accent: '#113c8c',
    layout: 'disney',
    wordmark: 'disney+',
    logo: '',
    disclaimer: 'Not the licensed Disney+ app. Playback uses TVM Stream / Real-Debrid.',
    hero: lead === undefined ? null : toMediaItem(lead),
    continueWatching: [],
    rails: [
      { id: 'disney-series', title: 'Disney+ originals', items: shows.slice(0, 16).map(toMediaItem) },
      { id: 'disney-films', title: 'Popular films', items: movies.slice(0, 16).map(toMediaItem) },
      { id: 'disney-shows', title: 'Popular series', items: shows.slice(0, 16).map(toMediaItem) },
    ],
  };
}

export function originalIdsFrom(hub: AppHubPayload): Set<string> {
  const ids = new Set<string>();
  for (const rail of hub.rails) {
    if (!/original/i.test(rail.title)) continue;
    for (const item of rail.items) ids.add(item.id);
  }
  return ids;
}

export type DisneyRail = { id: string; title: string; titles: Title[] };

export function buildDisneyRails(
  hub: AppHubPayload,
  lane: Lane,
  extras: readonly Title[],
  brand: DisneyBrand | null,
): DisneyRail[] {
  const pool = uniqueTitles([
    ...(hub.hero !== null && hub.hero !== undefined ? [toHubTitle(hub.hero)] : []),
    ...hub.continueWatching.map(toHubTitle),
    ...hub.rails.flatMap((rail) => rail.items.map(toHubTitle)),
    ...extras,
    ...TITLES,
  ]);
  const originals = originalIdsFrom(hub);
  const scoped = brand === null ? pool : pickBrandTitles(pool, brand);
  const match = (title: Title): boolean => disneyTitleMatches(title, lane, originals);
  const rails: DisneyRail[] = [];

  if (lane === 'list') {
    const saved = extras.filter(match);
    return [{ id: 'disney-watchlist', title: 'Watchlist', titles: capDisneyRail(saved.length > 0 ? saved : scoped.filter(match)) }];
  }

  const watching = hub.continueWatching.map(toHubTitle).filter((title) => match(title) && (brand === null || disneyBrandMatches(title, brand)));
  if (watching.length > 0 && lane === 'home' && brand === null) {
    rails.push({ id: 'disney-continue', title: 'Continue Watching', titles: capDisneyRail(watching) });
  }

  if (lane === 'new') {
    const originalTitles = scoped.filter((title) => isOriginalTitle(title, originals));
    rails.push({
      id: 'disney-originals',
      title: 'Originals',
      titles: capDisneyRail(originalTitles.length > 0 ? originalTitles : scoped.filter((title) => title.kind === 'series')),
    });
  } else {
    for (const rail of hub.rails) {
      const titles = rail.items.map(toHubTitle).filter((title) => match(title) && (brand === null || disneyBrandMatches(title, brand)));
      if (titles.length === 0) continue;
      rails.push({ id: rail.id, title: rail.title, titles: capDisneyRail(titles) });
    }
  }

  if (brand !== null && rails.length === 0) {
    rails.push({
      id: `disney-${brand}`,
      title: DISNEY_BRANDS.find((entry) => entry.id === brand)?.label ?? 'Collection',
      titles: capDisneyRail(scoped),
    });
  }

  if (rails.length > 0) return rails;
  const fallback = scoped.filter(match);
  return [{ id: 'disney-browse', title: 'Browse', titles: capDisneyRail(fallback.length > 0 ? fallback : scoped) }];
}

export function disneyPlayLabel(title: Title): string {
  return title.progress !== undefined ? 'Resume' : playLabel('disney');
}

export function disneyRuntime(title: Title): string {
  if (title.episodeLabel !== undefined && title.episodeLabel !== '') return title.episodeLabel;
  if (title.kind === 'series') {
    if (title.seasons === 1) return '1 Season';
    if (title.seasons !== undefined && title.seasons > 0) return `${title.seasons} Seasons`;
    return 'Series';
  }
  return title.runtime ?? '';
}

export function disneyHeroBadge(lane: Lane, brand: DisneyBrand | null): string {
  if (brand !== null) return DISNEY_BRANDS.find((entry) => entry.id === brand)?.label ?? 'Collection';
  if (lane === 'new') return 'Disney+ Original';
  return 'Now Streaming';
}

const DisneyWordmark = memo(function DisneyWordmark(): React.JSX.Element {
  return (
    <svg className="dplus-mark" viewBox="0 0 228 46" role="img" aria-label="Disney+">
      <title>Disney+</title>
      <text
        x="2"
        y="33"
        fill="currentColor"
        fontFamily="Segoe Script, 'Brush Script MT', 'Lucida Handwriting', 'Apple Chancery', cursive"
        fontSize="30"
        fontStyle="italic"
        fontWeight="700"
      >
        disney
      </text>
      <path d="M196 13.5v19M186.5 23h19" fill="none" stroke="currentColor" strokeWidth="3.15" strokeLinecap="round" />
    </svg>
  );
});

const DisneyTabIcon = memo(function DisneyTabIcon({ id }: { id: Lane | 'search' }): React.JSX.Element {
  if (id === 'home') {
    return (
      <svg className="dplus-tab__glyph" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M6.8 15.1 16 7.2l9.2 7.9V25a1.7 1.7 0 0 1-1.7 1.7h-5.1v-6.4h-4.8V26.7H8.5A1.7 1.7 0 0 1 6.8 25Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.05"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (id === 'search') {
    return (
      <svg className="dplus-tab__glyph" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="14.1" cy="14.1" r="6.35" fill="none" stroke="currentColor" strokeWidth="2.15" />
        <path d="m18.8 18.8 6.4 6.4" fill="none" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === 'list') {
    return (
      <svg className="dplus-tab__glyph" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 8.2v15.6M8.2 16h15.6" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === 'movies') {
    return (
      <svg className="dplus-tab__glyph" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="5.2" y="8.2" width="21.6" height="15.6" rx="2.3" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M9.2 8.2v15.6M22.8 8.2v15.6M5.2 12.2h4M5.2 20.2h4M22.8 12.2h4M22.8 20.2h4" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  if (id === 'shows') {
    return (
      <svg className="dplus-tab__glyph" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="6.2" y="7.6" width="19.6" height="13.2" rx="2.1" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12.2 25.4h7.6M16 20.8v4.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="dplus-tab__glyph" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 7.1 18.2 13h6.6l-5.3 3.8 2 6.3L16 19.4l-5.5 3.7 2-6.3L7.2 13h6.6z" fill="currentColor" />
    </svg>
  );
});

const DisneyPlayMark = memo(function DisneyPlayMark(): React.JSX.Element {
  return (
    <svg className="dplus-play__icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6.2 4.05v11.9L16.85 10 6.2 4.05z" fill="currentColor" />
    </svg>
  );
});

const BrandArt = memo(function BrandArt({ brand }: { brand: DisneyBrand }): React.JSX.Element {
  if (brand === 'pixar') {
    return (
      <svg className="dplus-brand__art" viewBox="0 0 160 90" aria-hidden="true">
        <defs>
          <linearGradient id="dplus-pixar-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fd6ff" />
            <stop offset="1" stopColor="#1a5f92" />
          </linearGradient>
        </defs>
        <rect width="160" height="90" fill="url(#dplus-pixar-sky)" />
        <ellipse cx="80" cy="86" rx="70" ry="10" fill="#0d3a58" opacity="0.35" />
        <path d="M46 78h28c2 0 3-1.4 3-3.2V70H43v4.8c0 1.8 1 3.2 3 3.2z" fill="#1b2a38" />
        <path d="M58 70c0-10 8-16 10-26 1.2-6.2-2-10-2-10l12 3s-1.4 6.2.2 12c2.2 8.2 12 14 12 26" fill="none" stroke="#1b2a38" strokeWidth="5.2" strokeLinecap="round" />
        <circle cx="78" cy="32" r="9" fill="#f4fbff" />
        <circle cx="78" cy="32" r="5.2" fill="#1b2a38" />
        <circle cx="104" cy="74" r="7.2" fill="#f2c14b" />
        <circle cx="104" cy="74" r="2.4" fill="#c48a1a" />
      </svg>
    );
  }
  if (brand === 'marvel') {
    return (
      <svg className="dplus-brand__art" viewBox="0 0 160 90" aria-hidden="true">
        <defs>
          <linearGradient id="dplus-marvel-red" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e11d2e" />
            <stop offset="1" stopColor="#7a0d16" />
          </linearGradient>
        </defs>
        <rect width="160" height="90" fill="url(#dplus-marvel-red)" />
        <path
          fill="#f4e9d4"
          d="M18 64V26h12l8 22 8-22h12v38h-10V38l-7 26h-6L31 38v26H18zm56 0V26h28c10 0 16 6 16 15s-6 15-16 15H84v8H74zm10-16h16c4.4 0 7-2.4 7-7s-2.6-7-7-7H84v14zm50 16V26h10l14 22V26h10v38h-10L134 42v22h-10z"
        />
      </svg>
    );
  }
  if (brand === 'starwars') {
    return (
      <svg className="dplus-brand__art" viewBox="0 0 160 90" aria-hidden="true">
        <rect width="160" height="90" fill="#05060a" />
        <g fill="#fff">
          <circle cx="18" cy="16" r="0.8" />
          <circle cx="42" cy="10" r="0.6" />
          <circle cx="70" cy="20" r="0.7" />
          <circle cx="96" cy="12" r="0.9" />
          <circle cx="128" cy="18" r="0.6" />
          <circle cx="146" cy="28" r="0.7" />
          <circle cx="24" cy="40" r="0.5" />
          <circle cx="58" cy="36" r="0.6" />
          <circle cx="112" cy="42" r="0.5" />
          <circle cx="138" cy="50" r="0.6" />
        </g>
        <path d="M18 78 80 58l62 20" fill="none" stroke="#f3d56b" strokeWidth="1.1" opacity="0.55" />
        <path
          fill="none"
          stroke="#f3d56b"
          strokeWidth="2.1"
          d="M28 38h104M36 50h88"
        />
        <path
          fill="#f3d56b"
          d="M42 30h10l4 8 4-8h10l-9 14v10h-10V44l-9-14zm36 0h28v8H88v4h16v7H88v5h18v8H78V30zm48 0 8 24h-9l-1.4-4h-9.2L113 54h-9l8-24h16zm-4.2 13h-5.6l2.8-8 2.8 8z"
        />
      </svg>
    );
  }
  if (brand === 'natgeo') {
    return (
      <svg className="dplus-brand__art" viewBox="0 0 160 90" aria-hidden="true">
        <rect width="160" height="90" fill="#161616" />
        <rect x="48" y="16" width="64" height="58" fill="none" stroke="#f3c14b" strokeWidth="6" />
        <path d="M56 62 72 42l10 12 8-8 14 16H56z" fill="#3d3d3d" />
        <circle cx="96" cy="34" r="5" fill="#f3c14b" />
      </svg>
    );
  }
  return (
    <svg className="dplus-brand__art" viewBox="0 0 160 90" aria-hidden="true">
      <defs>
        <linearGradient id="dplus-disney-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a78f0" />
          <stop offset="1" stopColor="#0b1d6a" />
        </linearGradient>
      </defs>
      <rect width="160" height="90" fill="url(#dplus-disney-sky)" />
      <g fill="#fff" opacity="0.85">
        <circle cx="18" cy="14" r="0.8" />
        <circle cx="36" cy="22" r="0.55" />
        <circle cx="128" cy="12" r="0.7" />
        <circle cx="146" cy="26" r="0.5" />
        <circle cx="22" cy="34" r="0.45" />
      </g>
      <path
        fill="#071233"
        d="M32 78h96v4H32zm18-4 6-10h8l4 10H50zm56 0 4-10h8l6 10H106zM68 74V42h6v-8h12v8h6v32H68zm8-20h16v6H76v-6zm-22 20V52h8v22h-8zm44 0V52h8v22h-8z"
      />
      <path fill="#d7e4ff" d="M80 18h8v8h-8zM72 26h24v4H72z" />
      <path fill="#f6c14b" d="M84 12v8h-2l6-10 6 10h-2v-8h-8z" />
    </svg>
  );
});

function bindWrap(scope: string, index: number, ids: readonly string[]) {
  return (direction: string): boolean => {
    const first = ids[0];
    const last = ids[ids.length - 1];
    if (first === undefined || last === undefined) return true;
    const next = wrapHubFocus(direction, index, ids.length, first, last);
    if (next === null) return true;
    requestFocus(`${scope}/${next}`);
    return false;
  };
}

const DisneyCard = memo(function DisneyCard({
  title,
  prefix,
  index,
  total,
  firstId,
  lastId,
  loopCopy = 1,
  onSelect,
}: {
  title: Title;
  prefix: string;
  index: number;
  total: number;
  firstId: string;
  lastId: string;
  loopCopy?: number;
  onSelect: (title: Title) => void;
}): React.JSX.Element {
  const scope = useFocusScope();
  const clone = loopCopy !== 1;
  const id = disneyCardId(prefix, title.id, loopCopy);
  const focusKey = useScopedFocusKey(id);
  const watching = title.progress !== undefined;
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    focusable: !clone,
    onArrowPress: (direction) => {
      if (clone) return true;
      const hop = wrapHubFocus(direction, index, total, firstId, lastId);
      if (hop === null) return true;
      requestFocus(`${scope}/${hop}`);
      return false;
    },
    onFocus: () => {
      const node = ref.current;
      if (node !== null) revealFocused(node);
    },
  });
  return (
    <button
      ref={ref}
      type="button"
      className={`tvm-button tvm-button--standard dplus-card${watching ? ' dplus-card--watching' : ''}`}
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      data-loop-clone={clone ? 'true' : undefined}
      data-loop-copy={String(loopCopy)}
      aria-hidden={clone || undefined}
      onClick={() => {
        if (!clone) onSelect(title);
      }}
    >
      <span className="tvm-button__label">
        <span className="dplus-card__frame">
          <Artwork title={title} kind="poster" className="dplus-card__art" decorative={clone} />
          {watching && (
            <span className="dplus-card__progress" aria-hidden="true">
              <span className="dplus-card__bar" style={{ width: `${Math.round((title.progress ?? 0) * 100)}%` }} />
            </span>
          )}
        </span>
        <span className="dplus-card__name">{title.title}</span>
      </span>
    </button>
  );
});

function mapCards(titles: readonly Title[], prefix: string, onSelect: (title: Title) => void): React.JSX.Element[] {
  const ids = disneyCardIds(prefix, titles);
  const firstId = ids[0] ?? '';
  const lastId = ids[ids.length - 1] ?? '';
  return titles.map((title, index) => (
    <DisneyCard
      key={`${prefix}-${title.id}`}
      title={title}
      prefix={prefix}
      index={index}
      total={titles.length}
      firstId={firstId}
      lastId={lastId}
      onSelect={onSelect}
    />
  ));
}

export function DisneyHub(props: ServiceHubProps): React.JSX.Element {
  const navigate = useNavigate();
  const scope = useFocusScope();
  const appId = props.appId ?? props.hub?.id ?? 'disney';
  const incoming = laneFromCategory(props.lane ?? props.category);
  const [lane, setLane] = useState<Lane>(incoming ?? 'home');
  const [loaded, setLoaded] = useState<AppHubPayload | null>(props.hub ?? (isHubPayload(props.catalog) ? props.catalog : null));
  const [failed, setFailed] = useState(false);
  const [watchlist, setWatchlist] = useState<Title[]>([]);
  const [brand, setBrand] = useState<DisneyBrand | null>(null);

  useEffect(() => {
    if (incoming !== undefined) setLane(incoming);
  }, [incoming]);

  useEffect(() => {
    if (props.hub !== undefined && props.hub !== null) {
      setLoaded(props.hub);
      setFailed(false);
      return;
    }
    if (isHubPayload(props.catalog)) {
      setLoaded(props.catalog);
      setFailed(false);
      return;
    }
    let cancelled = false;
    void fetchAppHub(appId).then((payload) => {
      if (cancelled) return;
      if (payload === null) setFailed(true);
      else setLoaded(payload);
    });
    return () => {
      cancelled = true;
    };
  }, [appId, props.catalog, props.hub]);

  useEffect(() => {
    const listed = catalogWatchlist(props.catalog);
    if (listed !== undefined) {
      setWatchlist(listed.map(toHubTitle));
      return;
    }
    let cancelled = false;
    void fetchWatchlist().then((items) => {
      if (!cancelled) setWatchlist(items.map(toHubTitle));
    });
    return () => {
      cancelled = true;
    };
  }, [props.catalog]);

  const hub = useMemo(() => {
    const base = loaded ?? (failed ? disneyFallbackHub() : null);
    if (base === null) return null;
    const extraRails = props.rails ?? catalogRails(props.catalog);
    if (extraRails === undefined || extraRails.length === 0) return base;
    return { ...base, rails: extraRails };
  }, [failed, loaded, props.catalog, props.rails]);

  const extras = useMemo(() => {
    const fromItems = (props.items ?? []).map(toHubTitle);
    const fromCatalog = catalogItems(props.catalog).map(toHubTitle);
    return uniqueTitles([...fromItems, ...fromCatalog, ...watchlist]);
  }, [props.catalog, props.items, watchlist]);

  const rails = useMemo(
    () => (hub === null ? [] : buildDisneyRails(hub, lane, extras, brand)),
    [brand, extras, hub, lane],
  );
  const heroSeed = hub?.hero !== null && hub?.hero !== undefined ? toHubTitle(hub.hero) : undefined;
  const hero = (lane === 'home' && brand === null ? heroSeed : rails[0]?.titles[0]) ?? rails[0]?.titles[0] ?? heroSeed;

  const nav = props.navigate ?? navigate;
  const goBack = useCallback((): void => {
    if (props.onBack !== undefined) props.onBack();
    else nav.home();
  }, [nav, props.onBack]);
  const playTitle = useCallback(
    (title: Title): void => {
      if (props.play !== undefined) props.play(title);
      else if (props.onPlay !== undefined) props.onPlay(title);
      else openPlayback(nav, title);
    },
    [nav, props.onPlay, props.play],
  );
  const openTitle = useCallback(
    (title: Title): void => {
      if (props.onOpen !== undefined) props.onOpen(title);
      else openDetails(nav, title);
    },
    [nav, props.onOpen],
  );
  const selectTitle = useCallback(
    (title: Title): void => {
      activateDisneyTitle(title, playTitle, openTitle);
    },
    [openTitle, playTitle],
  );
  const changeLane = useCallback(
    (next: Lane): void => {
      setBrand(null);
      setLane((current) => (current === next ? current : next));
      props.onLane?.(next);
    },
    [props.onLane],
  );

  if (hub === null) {
    return (
      <main className="service service--disney dplus-hub">
        <FocusButton id="service-back" className="dplus-back" onSelect={goBack}>
          Back
        </FocusButton>
        <Skeleton className="service-skeleton" label="Loading Disney+" />
      </main>
    );
  }

  if (failed && rails.length === 0) {
    return (
      <main className="page page--library dplus-hub">
        <EmptyState
          title="Disney+ could not load"
          body="TVM could not reach the local catalog for this service."
          actions={
            <FocusButton id="close" onSelect={goBack}>
              Back
            </FocusButton>
          }
        />
      </main>
    );
  }

  const items = disneyNavItems();
  const tabIds = items.map((item) => item.id);
  const brandIds = DISNEY_BRANDS.map((entry) => `disney-brand-${entry.id}`);
  const actionIds = ['service-play', 'service-info'];
  const cert = hero === undefined ? null : certificateLabel(hero.rating);
  const run = hero === undefined ? '' : disneyRuntime(hero);
  const heroSrc = hero === undefined ? '' : preferBackdrop(hero.id, hero.backdrop, hero.poster);

  return (
    <main className="service service--disney dplus-hub" aria-label="Disney+">
      <nav className="dplus-nav" aria-label="Disney+">
        <FocusButton id="service-back" className="dplus-back" onSelect={goBack}>
          Back
        </FocusButton>
        <div className="dplus-nav__brand">
          <DisneyWordmark />
        </div>
        <div className="dplus-nav__tabs" data-wrap="row">
          {items.map((item, index) => {
            const active = item.kind === 'tab' && lane === item.lane && brand === null;
            return (
              <FocusButton
                key={item.id}
                id={item.id}
                className={`dplus-tab${active ? ' dplus-tab--on' : ''}`}
                onSelect={() => {
                  if (item.kind === 'search') nav.pushModal('search');
                  else changeLane(item.lane);
                }}
                onArrowPress={bindWrap(scope, index, tabIds)}
              >
                <span className="dplus-tab__orb">
                  <DisneyTabIcon id={item.kind === 'search' ? 'search' : item.lane} />
                </span>
                <span className="dplus-tab__name">{item.label}</span>
              </FocusButton>
            );
          })}
        </div>
      </nav>

      {lane === 'list' && (
        <header className="dplus-listhead">
          <p className="dplus-listhead__kicker">Watchlist</p>
          <h1 className="dplus-listhead__title">Saved for later</h1>
        </header>
      )}

      {lane !== 'list' && hero !== undefined && (
        <section className="dplus-hero">
          <HeroArt src={heroSrc} hue={hero.hue} />
          <div className="dplus-hero__veil" aria-hidden="true" />
          <div className="dplus-hero__copy">
            <p className="dplus-hero__badge">{disneyHeroBadge(lane, brand)}</p>
            <h1 className="dplus-hero__title">{hero.title}</h1>
            <p className="dplus-hero__meta">
              {hero.year > 0 && <span>{hero.year}</span>}
              {cert !== null && <span className="dplus-hero__cert">{cert}</span>}
              {run !== '' && <span>{run}</span>}
              {hero.genres[0] !== undefined && <span>{hero.genres[0]}</span>}
            </p>
            {hero.synopsis !== '' && <p className="dplus-hero__syn">{hero.synopsis}</p>}
            <div className="dplus-hero__actions" data-wrap="row">
              <FocusButton
                id="service-play"
                variant="primary"
                className="dplus-play"
                onSelect={() => playTitle(hero)}
                onArrowPress={bindWrap(scope, 0, actionIds)}
              >
                <DisneyPlayMark />
                {disneyPlayLabel(hero)}
              </FocusButton>
              <FocusButton
                id="service-info"
                className="dplus-more"
                onSelect={() => openTitle(hero)}
                onArrowPress={bindWrap(scope, 1, actionIds)}
              >
                Details
              </FocusButton>
            </div>
          </div>
        </section>
      )}

      {lane === 'home' && (
        <div className="dplus-brands" aria-label="Collections" data-wrap="row">
          {DISNEY_BRANDS.map((entry, index) => (
            <FocusButton
              key={entry.id}
              id={`disney-brand-${entry.id}`}
              className={`dplus-brand dplus-brand--${entry.id}${brand === entry.id ? ' dplus-brand--on' : ''}`}
              onSelect={() => setBrand((current) => (current === entry.id ? null : entry.id))}
              onArrowPress={bindWrap(scope, index, brandIds)}
            >
              <BrandArt brand={entry.id} />
              <span className="dplus-brand__sr">{entry.label}</span>
            </FocusButton>
          ))}
        </div>
      )}

      <div className={`dplus-rails${lane === 'list' ? ' dplus-rails--list' : ''}`}>
        {rails.map((rail) => (
          <Rail key={rail.id} title={rail.title} id={rail.id}>
            {mapCards(rail.titles, rail.id, selectTitle)}
          </Rail>
        ))}
      </div>
      <p className="dplus-note">{hub.disclaimer}</p>
    </main>
  );
}
