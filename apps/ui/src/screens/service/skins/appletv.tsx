import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { Artwork } from '../../../components/Artwork';
import { EmptyState } from '../../../components/EmptyState';
import { FocusButton } from '../../../components/FocusButton';
import { HeroArt } from '../../../components/HeroArt';
import { Rail } from '../../../components/Rail';
import { Skeleton } from '../../../components/Skeleton';
import { fetchAppHub, type AppHubPayload } from '../../../data/apps';
import { preferBackdrop } from '../../../data/artwork';
import { TITLES, type Title } from '../../../data/catalog';
import { asTitle, fetchHome, fetchWatchlist, type MediaItem } from '../../../data/media';
import { openDetails, openPlayback } from '../../../data/openDetails';
import { certificateLabel } from '../../../data/playId';
import { requestFocus } from '../../../nav/focusEngine';
import { shouldLoopRail } from '../../../nav/loopingRail';
import { revealFocused, rowCameraTop, scrollAxis, shouldNudgePageY } from '../../../nav/revealFocused';
import { useFocusScope, useNavigate, useScopedFocusKey, type Navigate } from '../../../nav/ViewStackContext';
import { wrapFocusId } from '../../../nav/wrapFocus';
import { laneMatches, moreLabel, navTabs, playLabel, type Lane } from '../layouts';
import './appletv.css';

const EMPTY_TITLES: Title[] = [];

export type HubCatalogBag = {
  rails?: AppHubPayload['rails'];
  continueWatching?: AppHubPayload['continueWatching'];
  watchlist?: Array<MediaItem | Title>;
  hero?: AppHubPayload['hero'];
  items?: Array<MediaItem | Title>;
};

/** Props the Service dispatcher passes through (hub, catalog, navigate, play). */
export interface AppleTvHubProps {
  appId?: string;
  hub?: AppHubPayload | null;
  catalog?: readonly Title[] | AppHubPayload | HubCatalogBag;
  items?: readonly Title[] | Array<MediaItem | Title>;
  rails?: AppHubPayload['rails'];
  navigate?: Navigate;
  play?: (title: Title) => void;
  onPlay?: (title: Title) => void;
  onOpen?: (title: Title) => void;
  onOpenTitle?: (title: Title) => void;
  onBack?: () => void;
  lane?: Lane;
  category?: Lane | string;
  onLane?: (lane: Lane) => void;
}

export type AppleTvRail = { id: string; title: string; titles: Title[] };

export function laneFromCategory(value: string | undefined): Lane | undefined {
  if (value === undefined) return undefined;
  const key = value.trim().toLowerCase();
  if (key === 'home' || key === 'shows' || key === 'movies' || key === 'list' || key === 'new' || key === 'kids') {
    return key;
  }
  if (key === 'series' || key === 'tv' || key === 'tv shows') return 'shows';
  if (key === 'watch now') return 'home';
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
  };
}

export function uniqueHubTitles(titles: readonly Title[]): Title[] {
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

export function wrapHubFocus(direction: string, index: number, ids: readonly string[]): string | null {
  const first = ids[0];
  const last = ids[ids.length - 1];
  if (first === undefined || last === undefined) return null;
  return wrapFocusId(direction, index, ids.length, first, last);
}

export function appleTvNavIds(tabs: readonly { id: string }[]): string[] {
  return ['service-back', ...tabs.map((tab) => `service-tab-${tab.id}`), 'service-search'];
}

export function appleTvHeroActionIds(): string[] {
  return ['service-play', 'service-info'];
}

export function appleTvCardId(prefix: string, titleId: string, loopCopy = 1): string {
  return loopCopy !== 1 ? `${prefix}-${titleId}--${loopCopy}` : `${prefix}-${titleId}`;
}

export function appleTvCardIds(prefix: string, titles: readonly { id: string }[]): string[] {
  return titles.map((title) => appleTvCardId(prefix, title.id));
}

/** Hero resets to the top; a focused rail locks just under the sticky nav. */
export function appleTvCameraY(
  kind: 'hero' | 'rail',
  scrollTop: number,
  railTop: number,
  viewTop: number,
  navHeight: number,
): number {
  if (kind === 'hero') return 0;
  return rowCameraTop(scrollTop, railTop, viewTop, navHeight);
}

export function appleTvShouldLoop(count: number): boolean {
  return shouldLoopRail(count);
}

export function panAppleTvCamera(node: HTMLElement): void {
  const scroller = node.closest<HTMLElement>('.appletv-hub');
  if (scroller === null) return;
  const chrome = node.closest('.appletv-hub__hero, .appletv-hub__nav') !== null;
  if (chrome) {
    const target = appleTvCameraY('hero', scroller.scrollTop, 0, 0, 0);
    if (shouldNudgePageY(scroller.scrollTop, target)) scrollAxis(scroller, 'y', target);
    return;
  }
  const rail = node.closest<HTMLElement>('.rail');
  if (rail === null) return;
  const view = scroller.getBoundingClientRect();
  const railBox = rail.getBoundingClientRect();
  const nav = scroller.querySelector<HTMLElement>('.appletv-hub__nav');
  const navHeight = nav?.getBoundingClientRect().height ?? 52;
  const target = appleTvCameraY('rail', scroller.scrollTop, railBox.top, view.top, navHeight);
  if (shouldNudgePageY(scroller.scrollTop, target)) scrollAxis(scroller, 'y', target);
}

export function nextAppleTvPreview(current: Title | undefined, next: Title): Title {
  return current?.id === next.id ? current : next;
}

export function appleTvRailTitle(id: string, fallback: string): string {
  if (id.endsWith('-continue') || id.includes('continue')) return 'Up Next';
  if (id.endsWith('-series') || /original/i.test(fallback)) return 'Latest Originals';
  if (id.endsWith('-films') || /film|movie/i.test(fallback)) return 'Popular Movies';
  if (id.endsWith('-shows')) return 'Must-See TV Shows';
  if (id.endsWith('-trending')) return 'What to Watch';
  if (id.endsWith('-because')) return 'Because You Watched';
  if (id.endsWith('-liked') || id.includes('watchlist')) return 'Watchlist';
  return fallback;
}

/** Up Next resumes in TVM Stream; other rails open the title page. */
export function appleTvRailAction(railId: string): 'play' | 'details' {
  return railId.includes('continue') ? 'play' : 'details';
}

export function pickLaneHero(lane: Lane, candidates: readonly Title[]): Title | undefined {
  const matched = candidates.filter((title) => laneMatches(title, lane));
  return (
    matched.find((title) => title.backdrop !== '') ??
    matched[0] ??
    candidates.find((title) => title.backdrop !== '') ??
    candidates[0]
  );
}

export function buildAppleTvRails(input: {
  lane: Lane;
  watching: readonly Title[];
  watchlist: readonly Title[];
  hubRails: ReadonlyArray<{ id: string; title: string; titles: readonly Title[] }>;
  catalog: readonly Title[];
}): AppleTvRail[] {
  const rows: AppleTvRail[] = [];
  const take = (titles: readonly Title[]): Title[] => uniqueHubTitles(titles.filter((title) => laneMatches(title, input.lane)));
  const push = (id: string, title: string, titles: readonly Title[]): void => {
    const next = take(titles);
    if (next.length === 0 || rows.some((row) => row.id === id)) return;
    rows.push({ id, title, titles: next });
  };

  push('appletv-continue', 'Up Next', input.watching);
  push('appletv-watchlist', 'Watchlist', input.watchlist);
  for (const rail of input.hubRails) {
    push(rail.id, appleTvRailTitle(rail.id, rail.title), rail.titles);
  }
  const films = input.catalog.filter((title) => title.kind === 'movie');
  const shows = input.catalog.filter((title) => title.kind === 'series');
  if (input.lane === 'home' || input.lane === 'movies') push('appletv-movies', 'Popular Movies', films);
  if (input.lane === 'home' || input.lane === 'shows') push('appletv-shows', 'Must-See TV Shows', shows);
  return rows;
}

function titlesFromCatalog(catalog: AppleTvHubProps['catalog'], items?: AppleTvHubProps['items']): Title[] {
  if (Array.isArray(catalog)) return uniqueHubTitles(catalog.map(toHubTitle));
  if (catalog !== undefined && 'items' in catalog && catalog.items !== undefined) {
    return uniqueHubTitles(catalog.items.map(toHubTitle));
  }
  if (items !== undefined) return uniqueHubTitles(items.map(toHubTitle));
  return [...TITLES];
}

function bindWrap(scope: string, index: number, ids: readonly string[]) {
  return (direction: string): boolean => {
    const next = wrapHubFocus(direction, index, ids);
    if (next === null) return true;
    requestFocus(`${scope}/${next}`);
    return false;
  };
}

function runtimeLabel(title: Title): string {
  if (title.kind === 'series') {
    if (title.seasons === 1) return '1 Season';
    if (title.seasons !== undefined && title.seasons > 0) return `${title.seasons} Seasons`;
    return '';
  }
  return title.runtime ?? '';
}

function AppleTvWordmark(): React.JSX.Element {
  return (
    <span className="appletv-hub__brand" aria-hidden="true">
      <svg className="appletv-hub__fruit" viewBox="0 0 18 22">
        <path
          fill="currentColor"
          d="M12.85 4.55c.62-.82 1.62-1.38 2.55-1.45-.12 1.18-.62 2.2-1.42 2.92-.78.7-1.82 1.18-2.82 1.1.08-1.12.62-2.08 1.69-2.57z"
        />
        <path
          fill="currentColor"
          d="M9.05 6.15c.95 0 1.78.48 2.35.48s1.62-.58 2.82-.55c.12 0 1.85.12 2.72 1.32-2.28 1.25-1.92 4.55.28 5.82-.38.85-.85 1.58-1.38 2.2-.75.85-1.52 1.38-2.35 1.38-.88 0-1.18-.52-2.28-.52s-1.45.52-2.28.52c-.88 0-1.65-.58-2.35-1.42C5.18 13.65 4.4 11.2 5.28 9.1c.58-1.35 1.72-2.25 3.08-2.25.28 0 .52.1.69.3z"
        />
      </svg>
      <span className="appletv-hub__tv">tv</span>
      <span className="appletv-hub__plus">+</span>
    </span>
  );
}

function AppleTvPlayMark(): React.JSX.Element {
  return (
    <svg className="appletv-hub__play-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6.2 3.8v12.4L16.6 10 6.2 3.8z" fill="currentColor" />
    </svg>
  );
}

function AppleTvSearchMark(): React.JSX.Element {
  return (
    <svg className="appletv-hub__glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="m15.6 15.6 4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AppleTvInfoMark(): React.JSX.Element {
  return (
    <svg className="appletv-hub__info-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 8.7v5.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="10" cy="6.35" r="0.85" fill="currentColor" />
    </svg>
  );
}

const AppleTvCard = memo(function AppleTvCard({
  title,
  prefix,
  loopCopy = 1,
  onSelect,
  onPreview,
}: {
  title: Title;
  prefix: string;
  loopCopy?: number;
  onSelect: () => void;
  onPreview: (title: Title) => void;
}): React.JSX.Element {
  const clone = loopCopy !== 1;
  const id = appleTvCardId(prefix, title.id, loopCopy);
  const focusKey = useScopedFocusKey(id);
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    focusable: !clone,
    onArrowPress: () => true,
    onFocus: () => {
      const node = ref.current;
      if (node === null) return;
      revealFocused(node);
      requestAnimationFrame(() => panAppleTvCamera(node));
      if (!clone) onPreview(title);
    },
  });

  return (
    <button
      ref={ref}
      type="button"
      className="poster poster--landscape appletv-card"
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      data-loop-clone={clone ? 'true' : undefined}
      data-loop-copy={String(loopCopy)}
      aria-hidden={clone || undefined}
      onClick={() => {
        if (!clone) onSelect();
      }}
    >
      <Artwork title={title} kind="backdrop" className="poster__art appletv-card__art" decorative={clone} />
      {title.progress !== undefined && (
        <span className="poster__progress" aria-hidden="true">
          <span className="poster__progress-bar" style={{ width: `${Math.round(title.progress * 100)}%` }} />
        </span>
      )}
      <span className="poster__meta appletv-card__meta">
        <span className="poster__title">{title.title}</span>
        <span className="poster__year">{title.episodeLabel ?? (title.year > 0 ? title.year : '')}</span>
      </span>
    </button>
  );
});

function mapAppleTvCards(
  titles: readonly Title[],
  prefix: string,
  onSelect: (title: Title) => void,
  onPreview: (title: Title) => void,
): React.JSX.Element[] {
  return titles.map((title) => (
    <AppleTvCard
      key={`${prefix}-${title.id}`}
      title={title}
      prefix={prefix}
      onSelect={() => onSelect(title)}
      onPreview={onPreview}
    />
  ));
}

const AppleTvRailRow = memo(function AppleTvRailRow({
  rail,
  onSelect,
  onPreview,
}: {
  rail: AppleTvRail;
  onSelect: (railId: string, title: Title) => void;
  onPreview: (title: Title) => void;
}): React.JSX.Element {
  return (
    <Rail id={rail.id} title={rail.title}>
      {mapAppleTvCards(rail.titles, rail.id, (title) => onSelect(rail.id, title), onPreview)}
    </Rail>
  );
});

const AppleTvHero = memo(function AppleTvHero({
  hero,
  scope,
  onPlay,
  onInfo,
}: {
  hero: Title;
  scope: string;
  onPlay: (title: Title) => void;
  onInfo: (title: Title) => void;
}): React.JSX.Element {
  const actionIds = appleTvHeroActionIds();
  const cert = certificateLabel(hero.rating);
  const run = runtimeLabel(hero);
  const playText = hero.progress !== undefined ? 'Resume' : playLabel('appletv');

  return (
    <section className="appletv-hub__hero">
      <HeroArt src={preferBackdrop(hero.id, hero.backdrop, hero.poster)} hue={hero.hue} />
      <div className="appletv-hub__veil" aria-hidden="true" />
      <div className="appletv-hub__copy" key={hero.id}>
        <p className="appletv-hub__kicker">
          <AppleTvWordmark />
          Original
        </p>
        <h1 className="appletv-hub__title">{hero.title}</h1>
        <p className="appletv-hub__meta">
          {hero.year > 0 && <span>{hero.year}</span>}
          {cert !== null && <span className="appletv-hub__chip">{cert}</span>}
          {run !== '' && <span>{run}</span>}
          <span>{hero.kind === 'series' ? 'TV Show' : 'Movie'}</span>
          {hero.genres[0] !== undefined && <span>{hero.genres[0]}</span>}
          <span className="appletv-hub__chip">4K</span>
          <span className="appletv-hub__chip appletv-hub__chip--wide">Dolby Vision</span>
          <span className="appletv-hub__chip appletv-hub__chip--wide">Atmos</span>
        </p>
        {hero.synopsis !== '' && <p className="appletv-hub__syn">{hero.synopsis}</p>}
        <div className="hero__actions appletv-hub__actions" data-wrap="row">
          <FocusButton
            id="service-play"
            variant="primary"
            className="appletv-hub__play"
            onSelect={() => onPlay(hero)}
            onArrowPress={bindWrap(scope, 0, actionIds)}
          >
            <AppleTvPlayMark />
            {playText}
          </FocusButton>
          <FocusButton
            id="service-info"
            className="appletv-hub__more"
            onSelect={() => onInfo(hero)}
            onArrowPress={bindWrap(scope, 1, actionIds)}
          >
            <AppleTvInfoMark />
            {moreLabel('appletv')}
          </FocusButton>
        </div>
      </div>
    </section>
  );
});

const AppleTvNav = memo(function AppleTvNav({
  lane,
  scope,
  onBack,
  onLane,
  onSearch,
}: {
  lane: Lane;
  scope: string;
  onBack: () => void;
  onLane: (lane: Lane) => void;
  onSearch: () => void;
}): React.JSX.Element {
  const tabs = navTabs('appletv');
  const navIds = appleTvNavIds(tabs);

  return (
    <nav className="service-nav appletv-hub__nav" aria-label="Apple TV" data-wrap="row">
      <FocusButton id="service-back" className="appletv-hub__back" onSelect={onBack} onArrowPress={bindWrap(scope, 0, navIds)}>
        Back
      </FocusButton>
      <AppleTvWordmark />
      <div className="appletv-hub__tabs" data-wrap="row">
        {tabs.map((tab, index) => (
          <FocusButton
            key={tab.id}
            id={`service-tab-${tab.id}`}
            className={`appletv-hub__tab${lane === tab.id ? ' appletv-hub__tab--on' : ''}`}
            onSelect={() => onLane(tab.id)}
            onArrowPress={bindWrap(scope, index + 1, navIds)}
          >
            {tab.label}
          </FocusButton>
        ))}
      </div>
      <FocusButton
        id="service-search"
        className="appletv-hub__search"
        onSelect={onSearch}
        onArrowPress={bindWrap(scope, navIds.length - 1, navIds)}
      >
        <AppleTvSearchMark />
        Search
      </FocusButton>
    </nav>
  );
});

export function AppleTvHub({
  appId = 'appletv',
  hub: hubProp,
  catalog: catalogProp,
  items,
  rails: railsProp,
  navigate: navigateProp,
  play,
  onPlay,
  onOpen,
  onOpenTitle,
  onBack,
  lane: laneProp,
  category,
  onLane,
}: AppleTvHubProps): React.JSX.Element {
  const stackNavigate = useNavigate();
  const navigate = navigateProp ?? stackNavigate;
  const scope = useFocusScope();
  const rootRef = useRef<HTMLElement>(null);
  const catalog = useMemo(() => titlesFromCatalog(catalogProp, items), [catalogProp, items]);
  const incoming = laneFromCategory(laneProp ?? category);

  const [laneState, setLaneState] = useState<Lane>(incoming ?? 'home');
  const lane = incoming ?? laneState;
  const [fetchedHub, setFetchedHub] = useState<AppHubPayload | null | undefined>(hubProp);
  const [watching, setWatching] = useState<Title[]>([]);
  const [watchlist, setWatchlist] = useState<Title[]>([]);
  const [preview, setPreview] = useState<Title | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (incoming !== undefined) setLaneState(incoming);
  }, [incoming]);

  useEffect(() => {
    if (hubProp !== undefined) setFetchedHub(hubProp);
  }, [hubProp]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const tasks: Array<Promise<void>> = [];
      if (hubProp === undefined) {
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
  }, [appId, hubProp]);

  const hub = hubProp === undefined ? fetchedHub : hubProp;
  const hubWatching = useMemo(() => (hub?.continueWatching ?? []).map(asTitle), [hub]);
  const catalogWatching = useMemo(() => {
    if (catalogProp !== undefined && !Array.isArray(catalogProp) && 'continueWatching' in catalogProp) {
      return (catalogProp.continueWatching ?? []).map(asTitle);
    }
    return EMPTY_TITLES;
  }, [catalogProp]);
  const hubRails = useMemo(() => {
    const fromCatalog =
      catalogProp !== undefined && !Array.isArray(catalogProp) && 'rails' in catalogProp ? catalogProp.rails : undefined;
    const source = railsProp ?? fromCatalog ?? hub?.rails ?? [];
    return source.map((rail) => ({
      id: rail.id,
      title: rail.title,
      titles: rail.items.map(asTitle),
    }));
  }, [catalogProp, hub, railsProp]);

  const mergedWatching = useMemo(
    () => uniqueHubTitles([...hubWatching, ...catalogWatching, ...watching]),
    [catalogWatching, hubWatching, watching],
  );
  const mergedWatchlist = useMemo(() => uniqueHubTitles(watchlist), [watchlist]);
  const hubHero = useMemo(
    () => (hub?.hero !== null && hub?.hero !== undefined ? asTitle(hub.hero) : undefined),
    [hub],
  );
  const featured = useMemo(
    () =>
      pickLaneHero(lane, [
        ...(hubHero !== undefined ? [hubHero] : []),
        ...mergedWatching,
        ...hubRails.flatMap((rail) => rail.titles),
        ...catalog,
      ]),
    [catalog, hubHero, hubRails, lane, mergedWatching],
  );
  const hero = preview !== undefined && laneMatches(preview, lane) ? preview : featured;

  const rows = useMemo(
    () =>
      buildAppleTvRails({
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
      if (onOpenTitle !== undefined) {
        onOpenTitle(title);
        return;
      }
      openDetails(navigate, title);
    },
    [navigate, onOpen, onOpenTitle],
  );

  const chooseCard = useCallback(
    (railId: string, title: Title): void => {
      if (appleTvRailAction(railId) === 'play') {
        playTitle(title);
        return;
      }
      openTitle(title);
    },
    [openTitle, playTitle],
  );

  const previewTitle = useCallback((title: Title): void => {
    startTransition(() => {
      setPreview((current) => nextAppleTvPreview(current, title));
    });
  }, []);

  const goBack = useCallback((): void => {
    if (onBack !== undefined) {
      onBack();
      return;
    }
    navigate.home();
  }, [navigate, onBack]);

  const changeLane = useCallback(
    (next: Lane): void => {
      if (next === lane) return;
      setPreview(undefined);
      if (incoming === undefined) setLaneState(next);
      onLane?.(next);
      const hubNode = rootRef.current;
      if (hubNode !== null && shouldNudgePageY(hubNode.scrollTop, 0)) scrollAxis(hubNode, 'y', 0);
      window.setTimeout(() => requestFocus(`${scope}/service-tab-${next}`), 0);
    },
    [incoming, lane, onLane, scope],
  );

  const openSearch = useCallback((): void => {
    navigate.pushModal('search');
  }, [navigate]);

  const onHubFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    const node = event.target;
    if (node instanceof HTMLElement) {
      requestAnimationFrame(() => panAppleTvCamera(node));
    }
  }, []);

  const loading = hub === undefined && featured === undefined;

  return (
    <main
      ref={rootRef}
      className="service service--appletv appletv-hub"
      aria-label="Apple TV"
      onFocus={onHubFocus}
    >
      <AppleTvNav lane={lane} scope={scope} onBack={goBack} onLane={changeLane} onSearch={openSearch} />

      {loading && <Skeleton className="appletv-hub__skeleton" label="Loading Apple TV" />}

      {failed && featured === undefined && (
        <EmptyState
          eyebrow="Apple TV"
          title="This app could not load"
          body="TVM could not reach the local catalog for Apple TV."
          actions={
            <FocusButton id="close" onSelect={goBack}>
              Back
            </FocusButton>
          }
        />
      )}

      {hero !== undefined && <AppleTvHero hero={hero} scope={scope} onPlay={playTitle} onInfo={openTitle} />}

      <div className="appletv-hub__rails">
        {rows.map((rail) => (
          <AppleTvRailRow key={rail.id} rail={rail} onSelect={chooseCard} onPreview={previewTitle} />
        ))}
        {rows.length === 0 && !loading && (
          <p className="appletv-hub__empty">Nothing in this category yet. Titles still play through TVM Stream.</p>
        )}
      </div>
      {hub?.disclaimer !== undefined && hub.disclaimer !== '' && <p className="appletv-hub__note">{hub.disclaimer}</p>}
    </main>
  );
}
