import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { LoopClone } from '../../../components/LoopClone';
import { Artwork } from '../../../components/Artwork';
import { EmptyState } from '../../../components/EmptyState';
import { FocusButton } from '../../../components/FocusButton';
import { HeroArt } from '../../../components/HeroArt';
import { IconSearch } from '../../../components/Icons';
import { Rail } from '../../../components/Rail';
import { Skeleton } from '../../../components/Skeleton';
import { fetchAppHub, type AppHubPayload } from '../../../data/apps';
import { TITLES, type Title } from '../../../data/catalog';
import { preferBackdrop } from '../../../data/artwork';
import {
  addWatchlist,
  asTitle,
  fetchHome,
  fetchWatchlist,
  removeWatchlist,
  toMediaItem,
  type MediaItem,
} from '../../../data/media';
import { openDetails, openPlayback } from '../../../data/openDetails';
import { certificateLabel, imdbScore } from '../../../data/playId';
import { requestFocus } from '../../../nav/focusEngine';
import { revealFocused, rowCameraTop, scrollAxis, shouldNudgePageY } from '../../../nav/revealFocused';
import { wrapFocusId } from '../../../nav/wrapFocus';
import { useFocusScope, useNavigate, useScopedFocusKey, type Navigate } from '../../../nav/ViewStackContext';
import { laneMatches, moreLabel, navTabs, playLabel, type Lane } from '../layouts';
import './prime.css';

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

export type PrimeHubProps = ServiceHubProps;

export type PrimeRail = { id: string; title: string; titles: Title[] };

/** Own hub root — must be the camera, not a nested page inside `.service--prime` grid chrome. */
export const PRIME_HUB_CLASS = 'service service--prime prime-hub';

const SPORTS_RE = /sport|smackdown|wwe|nfl|nba|mlb|ufc|racing|wrestl|fight/i;

export function primeTabs(): Array<{ id: Lane; label: string }> {
  return navTabs('prime').map((tab) => (tab.id === 'new' ? { ...tab, label: 'Sports' } : tab));
}

export function laneFromCategory(value: string | undefined): Lane | undefined {
  if (value === 'home' || value === 'shows' || value === 'movies' || value === 'list' || value === 'new' || value === 'kids') {
    return value;
  }
  if (value === 'series' || value === 'tv') return 'shows';
  if (value === 'sports') return 'new';
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

function isHubPayload(value: unknown): value is AppHubPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'layout' in value && 'rails' in value;
}

export function uniquePrimeTitles(titles: readonly Title[]): Title[] {
  const seen = new Set<string>();
  const out: Title[] = [];
  for (const title of titles) {
    const idKey = title.id.trim().toLowerCase();
    const nameKey = title.title.trim().toLowerCase();
    if (idKey !== '' && seen.has(idKey)) continue;
    if (nameKey !== '' && seen.has(nameKey)) continue;
    if (idKey !== '') seen.add(idKey);
    if (nameKey !== '') seen.add(nameKey);
    out.push(title);
  }
  return out;
}

export function inPrimeLane(title: Title, lane: Lane): boolean {
  if (lane === 'new' && isPrimeSports(title)) return true;
  return laneMatches(title, lane);
}

export function isPrimeStudio(title: Title): boolean {
  return /prime|amazon/i.test(title.network ?? '');
}

export function isPrimeSports(title: Title): boolean {
  return SPORTS_RE.test(`${title.title} ${title.genres.join(' ')} ${title.network ?? ''}`);
}

export function pickPrimeHero(lane: Lane, candidates: readonly Title[]): Title | undefined {
  const matched = candidates.filter((title) => inPrimeLane(title, lane));
  return (
    matched.find((title) => title.backdrop !== '') ??
    matched[0] ??
    candidates.find((title) => title.backdrop !== '') ??
    candidates[0]
  );
}

export function wrapPrimeFocus(direction: string, index: number, ids: readonly string[]): string | null {
  const first = ids[0];
  const last = ids[ids.length - 1];
  if (first === undefined || last === undefined) return null;
  return wrapFocusId(direction, index, ids.length, first, last);
}

export function primeNavIds(tabs: readonly { id: string }[]): string[] {
  return ['service-back', ...tabs.map((tab) => `service-tab-${tab.id}`), 'service-search', 'service-profile'];
}

export function primeHeroActionIds(): string[] {
  return ['service-play', 'service-info', 'service-watchlist'];
}

export function primeCardId(prefix: string, titleId: string, loopCopy = 1): string {
  return loopCopy !== 1 ? `${prefix}-${titleId}--${loopCopy}` : `${prefix}-${titleId}`;
}

export function primeCardIds(prefix: string, titles: readonly Title[]): string[] {
  return titles.map((title) => primeCardId(prefix, title.id));
}

/** Pin a focused row under the sticky Prime nav so Down actually moves the camera. */
export function primeRailCameraTop(scrollTop: number, railTop: number, viewTop: number, navHeight: number): number {
  return rowCameraTop(scrollTop, railTop, viewTop, navHeight);
}

export function pinPrimeCamera(node: HTMLElement): void {
  const hub = node.closest<HTMLElement>('.prime-hub');
  if (hub === null) return;
  revealFocused(node);
  const rail = node.closest<HTMLElement>('.rail');
  if (rail === null) {
    if (shouldNudgePageY(hub.scrollTop, 0)) scrollAxis(hub, 'y', 0);
    return;
  }
  const view = hub.getBoundingClientRect();
  const box = rail.getBoundingClientRect();
  const nav = hub.querySelector<HTMLElement>('.prime-hub__nav');
  const ribbon = nav === null ? 68 : nav.getBoundingClientRect().height;
  const target = primeRailCameraTop(hub.scrollTop, box.top, view.top, ribbon);
  if (!shouldNudgePageY(hub.scrollTop, target)) return;
  requestAnimationFrame(() => scrollAxis(hub, 'y', target));
}

export function primeHeroPlayLabel(title: Title): string {
  return title.progress !== undefined ? 'Resume' : playLabel('prime');
}

export function primeDetailsLabel(): string {
  const label = moreLabel('prime');
  return label === 'More Info' ? 'More details' : label;
}

export function primeRuntimeLabel(title: Title): string {
  if (title.kind === 'series') {
    if (title.seasons === 1) return '1 season';
    if (title.seasons !== undefined && title.seasons > 1) return `${title.seasons} seasons`;
    return '';
  }
  return title.runtime ?? '';
}

export function primeHeroBadges(title: Title): readonly string[] {
  return title.kind === 'movie' ? ['UHD', 'HDR'] : ['HD'];
}

/** Films open TVM Stream; series open details so an episode can be chosen. */
export function primePlayTarget(title: Title): 'player' | 'details' {
  return title.kind === 'series' ? 'details' : 'player';
}

/** Every rail plays through TVM — never an Amazon deep link. */
export function primeRailAction(_railId: string): 'play' {
  return 'play';
}

export function activatePrimeTitle(
  title: Title,
  playFn: (title: Title) => void,
  openFn: (title: Title) => void,
): 'player' | 'details' {
  const target = primePlayTarget(title);
  if (target === 'player') playFn(title);
  else openFn(title);
  return target;
}

export function buildPrimeRails(input: {
  lane: Lane;
  watching: readonly Title[];
  watchlist: readonly Title[];
  hubRails: ReadonlyArray<{ id: string; title: string; titles: readonly Title[] }>;
  catalog: readonly Title[];
}): PrimeRail[] {
  const { lane, watching, watchlist, hubRails, catalog } = input;
  const rows: PrimeRail[] = [];
  const take = (titles: readonly Title[]): Title[] => uniquePrimeTitles(titles.filter((title) => inPrimeLane(title, lane)));
  const push = (id: string, title: string, titles: readonly Title[]): void => {
    const next = take(titles);
    if (next.length === 0 || rows.some((row) => row.id === id)) return;
    rows.push({ id, title, titles: next });
  };

  push('prime-continue', 'Continue watching', watching);
  push('prime-watchlist', 'Watchlist', watchlist);
  for (const rail of hubRails) {
    push(rail.id, rail.title, rail.titles);
  }

  const originals = catalog.filter(isPrimeStudio);
  const sports = catalog.filter(isPrimeSports);
  const films = catalog.filter((title) => title.kind === 'movie');
  const shows = catalog.filter((title) => title.kind === 'series');
  const fresh = catalog.filter((title) => title.year >= 2020 || title.year === 0);

  if (lane === 'home') {
    push('prime-originals', 'Prime originals', originals);
    push('prime-sports', 'Sports', sports);
    push('prime-movies', 'Top movies', films);
    push('prime-shows', 'Top TV', shows);
    push('prime-new', 'New on Prime', fresh);
  } else if (lane === 'movies') {
    push('prime-movies', 'Top movies', films);
    push('prime-new-movies', 'New movies', fresh.filter((title) => title.kind === 'movie'));
  } else if (lane === 'shows') {
    push('prime-shows', 'Top TV', shows);
    push('prime-originals', 'Prime originals', originals.filter((title) => title.kind === 'series'));
  } else if (lane === 'new') {
    push('prime-sports', 'Sports', sports);
    push('prime-new', 'New on Prime', fresh);
  }

  return rows;
}

function PrimeSmile({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 168 20" aria-hidden="true">
      <path
        d="M8 7.2c26 11.6 126 11.6 148-.4"
        fill="none"
        stroke="#00A8E1"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M144.2 5.4 161 8.1l-11.2 8.4"
        fill="none"
        stroke="#00A8E1"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PrimeChevron(): React.JSX.Element {
  return (
    <svg className="prime-hub__chevron" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14.8 5.2 8.2 12l6.6 6.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PrimePlus(): React.JSX.Element {
  return (
    <svg className="prime-hub__glyph" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3.4v13.2M3.4 10h13.2" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

function PrimeCheck(): React.JSX.Element {
  return (
    <svg className="prime-hub__glyph" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.2 10.4 8.1 14.2 15.8 5.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PrimePlayMark(): React.JSX.Element {
  return (
    <svg className="prime-hub__play-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 4.2v11.6L16.8 10 6 4.2z" fill="currentColor" />
    </svg>
  );
}

function PrimeWordmark(): React.JSX.Element {
  return (
    <span className="prime-hub__brand" aria-hidden="true">
      <span className="prime-hub__word">prime video</span>
      <PrimeSmile className="prime-hub__smile" />
    </span>
  );
}

function PrimeAvatar(): React.JSX.Element {
  return (
    <svg className="prime-hub__avatar" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#1b2a36" />
      <circle cx="16" cy="12.6" r="5.05" fill="#8ea3b3" />
      <path d="M5.8 27.6c2.8-6.4 17.6-6.4 20.4 0" fill="#8ea3b3" />
    </svg>
  );
}

function bindWrap(scope: string, index: number, ids: readonly string[]) {
  return (direction: string): boolean => {
    const next = wrapPrimeFocus(direction, index, ids);
    if (next === null) return true;
    requestFocus(`${scope}/${next}`);
    return false;
  };
}

function catalogWatchlist(catalog: ServiceHubProps['catalog']): Array<MediaItem | Title> | undefined {
  if (catalog === undefined || Array.isArray(catalog) || !('watchlist' in catalog)) return undefined;
  return catalog.watchlist;
}

export function resolvePrimeTitles(
  catalog: ServiceHubProps['catalog'],
  items?: Array<MediaItem | Title>,
): Title[] {
  const extra = (items ?? []).map(toHubTitle);
  if (Array.isArray(catalog)) return uniquePrimeTitles([...catalog.map(toHubTitle), ...extra, ...TITLES]);
  if (catalog !== undefined) {
    const bag = catalog as HubCatalog;
    const fromHero = bag.hero !== null && bag.hero !== undefined ? [asTitle(bag.hero)] : [];
    const fromWatching = (bag.continueWatching ?? []).map(asTitle);
    const fromRails = (bag.rails ?? []).flatMap((rail) => rail.items.map(asTitle));
    const fromItems = (bag.items ?? []).map(toHubTitle);
    return uniquePrimeTitles([...fromHero, ...fromWatching, ...fromRails, ...fromItems, ...extra, ...TITLES]);
  }
  return uniquePrimeTitles([...extra, ...TITLES]);
}

const PrimeCard = memo(function PrimeCard(props: {
  title: Title;
  prefix: string;
  loopCopy?: number;
  onActivate: (title: Title) => void;
  onPreview: (title: Title) => void;
}): React.JSX.Element {
  if ((props.loopCopy ?? 1) !== 1) return <PrimeCardClone {...props} />;
  return <PrimeCardLive {...props} />;
});

function PrimeCardFace({ title, clone = false }: { title: Title; clone?: boolean }): React.JSX.Element {
  return (
    <span className="prime-card__frame">
      <Artwork title={title} kind="backdrop" className="poster__art prime-card__art" decorative={clone} />
      {isPrimeStudio(title) && (
        <span className="prime-card__mark" aria-hidden="true">
          <PrimeSmile className="prime-card__mark-smile" />
        </span>
      )}
      {title.episodeLabel !== undefined && title.episodeLabel !== '' && (
        <span className="poster__episode">{title.episodeLabel}</span>
      )}
      {title.progress !== undefined && (
        <span className="poster__progress" aria-hidden="true">
          <span className="poster__progress-bar" style={{ width: `${Math.round(title.progress * 100)}%` }} />
        </span>
      )}
      <span className="poster__meta prime-card__meta">
        <span className="poster__title">{title.title}</span>
        <span className="poster__year">{title.episodeLabel ?? (title.year > 0 ? title.year : '')}</span>
      </span>
    </span>
  );
}

function PrimeCardClone({
  title,
  prefix,
  loopCopy = 0,
  onActivate,
}: {
  title: Title;
  prefix: string;
  loopCopy?: number;
  onActivate: (title: Title) => void;
  onPreview: (title: Title) => void;
}): React.JSX.Element {
  const id = primeCardId(prefix, title.id, loopCopy);
  return (
    <LoopClone
      className={`poster poster--landscape prime-card${title.progress !== undefined ? ' prime-card--watching' : ''}`}
      focusId={id}
      loopCopy={loopCopy}
      onClick={() => onActivate(title)}
    >
      <PrimeCardFace title={title} clone />
    </LoopClone>
  );
}

const PrimeCardLive = memo(function PrimeCardLive({
  title,
  prefix,
  onActivate,
  onPreview,
}: {
  title: Title;
  prefix: string;
  loopCopy?: number;
  onActivate: (title: Title) => void;
  onPreview: (title: Title) => void;
}): React.JSX.Element {
  const id = primeCardId(prefix, title.id, 1);
  const focusKey = useScopedFocusKey(id);
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    onArrowPress: () => true,
    onFocus: () => {
      const node = ref.current;
      if (node !== null) pinPrimeCamera(node);
      onPreview(title);
    },
  });

  return (
    <button
      ref={ref}
      type="button"
      className={`poster poster--landscape prime-card${title.progress !== undefined ? ' prime-card--watching' : ''}`}
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      data-loop-copy="1"
      onClick={() => onActivate(title)}
    >
      <PrimeCardFace title={title} />
    </button>
  );
});

function mapPrimeCards(
  titles: readonly Title[],
  prefix: string,
  onActivate: (title: Title) => void,
  onPreview: (title: Title) => void,
): React.JSX.Element[] {
  return titles.map((title) => (
    <PrimeCard
      key={primeCardId(prefix, title.id)}
      title={title}
      prefix={prefix}
      onActivate={onActivate}
      onPreview={onPreview}
    />
  ));
}

const PrimeRailRow = memo(function PrimeRailRow({
  rail,
  onActivate,
  onPreview,
}: {
  rail: PrimeRail;
  onActivate: (title: Title) => void;
  onPreview: (title: Title) => void;
}): React.JSX.Element {
  return (
    <Rail id={rail.id} title={rail.title}>
      {mapPrimeCards(rail.titles, rail.id, onActivate, onPreview)}
    </Rail>
  );
});

export function PrimeHub({
  appId = 'prime',
  hub: hubProp,
  catalog: catalogProp,
  items,
  rails: railsProp,
  navigate: navigateProp,
  play,
  onPlay,
  onOpen,
  onBack,
  lane: laneProp,
  category,
  onLane,
}: PrimeHubProps): React.JSX.Element {
  const stackNavigate = useNavigate();
  const navigate = navigateProp ?? stackNavigate;
  const scope = useFocusScope();
  const tabs = useMemo(() => primeTabs(), []);
  const navIds = useMemo(() => primeNavIds(tabs), [tabs]);
  const actionIds = useMemo(() => primeHeroActionIds(), []);
  const catalog = useMemo(() => resolvePrimeTitles(catalogProp, items), [catalogProp, items]);
  const catalogHub = isHubPayload(catalogProp) ? catalogProp : undefined;

  const [laneState, setLaneState] = useState<Lane>(laneProp ?? laneFromCategory(category) ?? 'home');
  const lane = laneProp ?? laneFromCategory(category) ?? laneState;
  const [fetchedHub, setFetchedHub] = useState<AppHubPayload | null | undefined>(hubProp ?? catalogHub);
  const [watching, setWatching] = useState<Title[]>([]);
  const [watchlist, setWatchlist] = useState<Title[]>([]);
  const [preview, setPreview] = useState<Title | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const next = laneProp ?? laneFromCategory(category);
    if (next !== undefined) setLaneState(next);
  }, [category, laneProp]);

  useEffect(() => {
    if (hubProp !== undefined) setFetchedHub(hubProp);
    else if (catalogHub !== undefined) setFetchedHub(catalogHub);
  }, [catalogHub, hubProp]);

  useEffect(() => {
    const saved = catalogWatchlist(catalogProp);
    if (saved === undefined) return;
    setWatchlist(saved.map(toHubTitle));
  }, [catalogProp]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const tasks: Array<Promise<void>> = [];
      if (hubProp === undefined && catalogHub === undefined) {
        tasks.push(
          fetchAppHub(appId).then((payload) => {
            if (cancelled) return;
            setFetchedHub(payload);
            if (payload === null) setFailed(true);
          }),
        );
      }
      tasks.push(
        fetchWatchlist().then((list) => {
          if (!cancelled) setWatchlist(list.map(asTitle));
        }),
      );
      tasks.push(
        fetchHome().then((home) => {
          if (cancelled || home === null) return;
          setWatching(home.continueWatching.map(asTitle));
          if (home.watchlist.length > 0) setWatchlist(home.watchlist.map(asTitle));
        }),
      );
      await Promise.all(tasks);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [appId, catalogHub, hubProp]);

  const hub = hubProp ?? fetchedHub ?? catalogHub;
  const hubWatching = useMemo(() => (hub?.continueWatching ?? []).map(asTitle), [hub]);
  const hubRails = useMemo(() => {
    const source = railsProp ?? hub?.rails ?? [];
    return source.map((rail) => ({
      id: rail.id,
      title: rail.title,
      titles: rail.items.map(asTitle),
    }));
  }, [hub, railsProp]);

  const mergedWatching = useMemo(
    () => uniquePrimeTitles([...hubWatching, ...watching]),
    [hubWatching, watching],
  );
  const mergedWatchlist = useMemo(() => uniquePrimeTitles(watchlist), [watchlist]);
  const hubHero = useMemo(
    () => (hub?.hero !== null && hub?.hero !== undefined ? asTitle(hub.hero) : undefined),
    [hub],
  );

  const featured = useMemo(
    () =>
      pickPrimeHero(lane, [
        ...(hubHero !== undefined ? [hubHero] : []),
        ...mergedWatching,
        ...hubRails.flatMap((rail) => rail.titles),
        ...catalog.filter(isPrimeStudio),
        ...catalog,
      ]),
    [catalog, hubHero, hubRails, lane, mergedWatching],
  );
  const hero = preview !== undefined && inPrimeLane(preview, lane) ? preview : featured;

  const rows = useMemo(
    () =>
      buildPrimeRails({
        lane,
        watching: mergedWatching,
        watchlist: mergedWatchlist,
        hubRails,
        catalog,
      }),
    [catalog, hubRails, lane, mergedWatching, mergedWatchlist],
  );

  const playTitle = useCallback(
    (title: Title): void => {
      if (play !== undefined) {
        play(title);
        return;
      }
      if (onPlay !== undefined) {
        onPlay(title);
        return;
      }
      openPlayback(navigate, title);
    },
    [navigate, onPlay, play],
  );

  const openTitle = useCallback(
    (title: Title): void => {
      if (onOpen !== undefined) {
        onOpen(title);
        return;
      }
      openDetails(navigate, title);
    },
    [navigate, onOpen],
  );

  const activate = useCallback(
    (title: Title): void => {
      activatePrimeTitle(title, playTitle, openTitle);
    },
    [openTitle, playTitle],
  );

  const goBack = (): void => {
    if (onBack !== undefined) {
      onBack();
      return;
    }
    navigate.home();
  };

  const changeLane = (next: Lane): void => {
    if (next === lane) return;
    setPreview(undefined);
    if (laneProp === undefined) setLaneState(next);
    onLane?.(next);
    window.setTimeout(() => requestFocus(`${scope}/service-tab-${next}`), 0);
  };

  const saved = hero !== undefined && mergedWatchlist.some((item) => item.id === hero.id || item.title === hero.title);
  const loading = hub === undefined && featured === undefined;

  const toggleWatchlist = (): void => {
    if (hero === undefined) return;
    if (saved) {
      void removeWatchlist(hero.id).then((list) => setWatchlist(list.map(asTitle)));
      return;
    }
    void addWatchlist(toMediaItem(hero)).then((list) => setWatchlist(list.map(asTitle)));
  };

  const cert = hero === undefined ? null : certificateLabel(hero.rating);
  const score = hero === undefined ? null : imdbScore(hero.rating);
  const run = hero === undefined ? '' : primeRuntimeLabel(hero);
  const playText = hero === undefined ? playLabel('prime') : primeHeroPlayLabel(hero);
  const badges = hero === undefined ? [] : primeHeroBadges(hero);

  return (
    <main className={PRIME_HUB_CLASS} aria-label="Prime Video">
      <nav className="prime-hub__nav" aria-label="Prime Video" data-wrap="true">
        <PrimeWordmark />
        <FocusButton
          id="service-back"
          className="prime-hub__back"
          onSelect={goBack}
          onArrowPress={bindWrap(scope, 0, navIds)}
        >
          <PrimeChevron />
          <span className="prime-hub__sr">Back</span>
        </FocusButton>
        <div className="prime-hub__tabs" data-wrap="true">
          {tabs.map((tab, index) => (
            <FocusButton
              key={tab.id}
              id={`service-tab-${tab.id}`}
              className={`prime-hub__tab${lane === tab.id ? ' prime-hub__tab--on' : ''}`}
              onSelect={() => changeLane(tab.id)}
              onArrowPress={bindWrap(scope, index + 1, navIds)}
            >
              {tab.label}
            </FocusButton>
          ))}
        </div>
        <div className="prime-hub__tools">
          <FocusButton
            id="service-search"
            className="prime-hub__icon"
            onSelect={() => navigate.pushModal('search')}
            onArrowPress={bindWrap(scope, navIds.length - 2, navIds)}
          >
            <IconSearch className="prime-hub__glyph" />
            <span className="prime-hub__sr">Search</span>
          </FocusButton>
          <FocusButton
            id="service-profile"
            className="prime-hub__icon prime-hub__icon--avatar"
            onSelect={() => navigate.push('profiles')}
            onArrowPress={bindWrap(scope, navIds.length - 1, navIds)}
          >
            <PrimeAvatar />
            <span className="prime-hub__sr">Profile</span>
          </FocusButton>
        </div>
      </nav>

      {loading && <Skeleton className="prime-hub__skeleton" />}

      {failed && featured === undefined && (
        <EmptyState
          eyebrow="Prime Video"
          title="This app could not load"
          body="TVM could not reach the local catalog for Prime Video."
          actions={
            <FocusButton id="close" onSelect={goBack}>
              Back
            </FocusButton>
          }
        />
      )}

      {hero !== undefined && (
        <section className="prime-hub__hero">
          <HeroArt src={preferBackdrop(hero.id, hero.backdrop, hero.poster)} hue={hero.hue} />
          <div className="prime-hub__veil" aria-hidden="true" />
          <div className="prime-hub__copy" key={hero.id}>
            <p className="prime-hub__kicker">
              <PrimeSmile className="prime-hub__kicker-smile" />
              Included with Prime
            </p>
            <h1 className="prime-hub__title">{hero.title}</h1>
            <p className="prime-hub__meta">
              {hero.year > 0 && <span>{hero.year}</span>}
              {cert !== null && <span className="prime-hub__cert">{cert}</span>}
              {run !== '' && <span>{run}</span>}
              {hero.genres[0] !== undefined && <span>{hero.genres[0]}</span>}
              <span>{hero.kind === 'series' ? 'TV' : 'Movie'}</span>
              {badges.map((badge) => (
                <span key={badge} className="prime-hub__q">
                  {badge}
                </span>
              ))}
              {score !== null && <span className="prime-hub__score">IMDb {score}</span>}
            </p>
            {hero.synopsis !== '' && <p className="prime-hub__syn">{hero.synopsis}</p>}
            <div className="prime-hub__actions" data-wrap="true">
              <FocusButton
                id="service-play"
                variant="primary"
                className="prime-hub__play"
                onSelect={() => playTitle(hero)}
                onArrowPress={bindWrap(scope, 0, actionIds)}
              >
                <PrimePlayMark />
                {playText}
              </FocusButton>
              <FocusButton
                id="service-info"
                className="prime-hub__more"
                onSelect={() => openTitle(hero)}
                onArrowPress={bindWrap(scope, 1, actionIds)}
              >
                {primeDetailsLabel()}
              </FocusButton>
              <FocusButton
                id="service-watchlist"
                className="prime-hub__more prime-hub__more--list"
                onSelect={toggleWatchlist}
                onArrowPress={bindWrap(scope, 2, actionIds)}
              >
                {saved ? <PrimeCheck /> : <PrimePlus />}
                Watchlist
              </FocusButton>
            </div>
          </div>
        </section>
      )}

      <div className="prime-hub__rails" key={lane}>
        {rows.map((rail) => (
          <PrimeRailRow key={rail.id} rail={rail} onActivate={activate} onPreview={setPreview} />
        ))}
        {rows.length === 0 && !loading && (
          <p className="prime-hub__empty">Nothing in this category yet. Titles still play through TVM Stream.</p>
        )}
      </div>
      {hub?.disclaimer !== undefined && hub.disclaimer !== '' && <p className="prime-hub__note">{hub.disclaimer}</p>}
    </main>
  );
}
