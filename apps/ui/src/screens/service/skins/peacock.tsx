import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { memo, startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { Artwork } from '../../../components/Artwork';
import { EmptyState } from '../../../components/EmptyState';
import { FocusButton } from '../../../components/FocusButton';
import { HeroArt } from '../../../components/HeroArt';
import { IconSearch } from '../../../components/Icons';
import { Rail } from '../../../components/Rail';
import { Skeleton } from '../../../components/Skeleton';
import { fetchAppHub, type AppHubPayload } from '../../../data/apps';
import { preferBackdrop } from '../../../data/artwork';
import { TITLES, type Title } from '../../../data/catalog';
import { asTitle, fetchHome, fetchWatchlist, type MediaItem } from '../../../data/media';
import { openDetails, openPlayback } from '../../../data/openDetails';
import { certificateLabel } from '../../../data/playId';
import { requestFocus } from '../../../nav/focusEngine';
import { revealFocused } from '../../../nav/revealFocused';
import { useFocusScope, useNavigate, useScopedFocusKey, type Navigate } from '../../../nav/ViewStackContext';
import { wrapFocusId } from '../../../nav/wrapFocus';
import { laneMatches, moreLabel, navTabs, playLabel, type Lane } from '../layouts';
import './peacock.css';

const PEACOCK_RAIL_CAP = 18;

export type HubCatalogBag = {
  rails?: AppHubPayload['rails'];
  continueWatching?: AppHubPayload['continueWatching'];
  watchlist?: Array<MediaItem | Title>;
  hero?: AppHubPayload['hero'];
  items?: Array<MediaItem | Title>;
};

/** Props the Service dispatcher passes through (hub, catalog, navigate, play). */
export interface PeacockHubProps {
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

export function laneFromCategory(value: string | undefined): Lane | undefined {
  if (value === undefined) return undefined;
  const key = value.trim().toLowerCase();
  if (key === 'home' || key === 'shows' || key === 'movies' || key === 'list' || key === 'new' || key === 'kids') {
    return key;
  }
  if (key === 'series' || key === 'tv' || key === 'tv shows') return 'shows';
  if (key === 'my stuff' || key === 'stuff') return 'list';
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

/** Side rail wraps on the Y axis; hero actions wrap on X. Up from Back stays open for the TVM pill. */
export function wrapHubFocus(
  direction: string,
  index: number,
  ids: readonly string[],
  axis: 'x' | 'y' = 'x',
): string | null {
  const first = ids[0];
  const last = ids[ids.length - 1];
  if (first === undefined || last === undefined || ids.length < 2) return null;
  if (axis === 'y') {
    if (direction === 'down' && index === ids.length - 1) return first;
    return null;
  }
  return wrapFocusId(direction, index, ids.length, first, last);
}

export function peacockNavIds(tabs: readonly { id: string }[]): string[] {
  return ['service-back', ...tabs.map((tab) => `service-tab-${tab.id}`), 'service-search'];
}

export function peacockHeroActionIds(): string[] {
  return ['service-play', 'service-info'];
}

export function peacockCardIds(prefix: string, titles: readonly Title[]): string[] {
  return titles.map((title) => `${prefix}-${title.id}`);
}

export function peacockRailTitle(id: string, fallback: string): string {
  if (id.endsWith('-continue') || id.includes('continue')) return 'Keep Watching';
  if (id.endsWith('-series') || /original/i.test(fallback)) return 'Peacock Originals';
  if (id.endsWith('-films') || /film|movie/i.test(fallback)) return 'Popular Movies';
  if (id.endsWith('-shows')) return 'Popular TV Shows';
  if (id.endsWith('-trending')) return 'Trending Now';
  if (id.endsWith('-because')) return 'Because You Watched';
  if (id.endsWith('-liked') || id.includes('watchlist') || id.includes('stuff')) return 'My Stuff';
  return fallback;
}

/** Films start TVM Stream; series open details first. */
export function peacockPlayTarget(title: Title): 'player' | 'details' {
  return title.kind === 'series' ? 'details' : 'player';
}

/** Every rail plays through TVM — never a Peacock deep link. */
export function peacockRailAction(_railId: string): 'play' {
  return 'play';
}

export function activatePeacockTitle(
  title: Title,
  playFn: (title: Title) => void,
  openFn: (title: Title) => void,
): 'player' | 'details' {
  const target = peacockPlayTarget(title);
  if (target === 'player') playFn(title);
  else openFn(title);
  return target;
}

export function pickLaneHero(lane: Lane, candidates: readonly Title[]): Title | undefined {
  if (lane === 'list') return undefined;
  const matched = candidates.filter((title) => laneMatches(title, lane));
  return (
    matched.find((title) => title.backdrop !== '') ??
    matched[0] ??
    candidates.find((title) => title.backdrop !== '') ??
    candidates[0]
  );
}

export function buildPeacockRails(input: {
  lane: Lane;
  watching: readonly Title[];
  watchlist: readonly Title[];
  hubRails: ReadonlyArray<{ id: string; title: string; titles: readonly Title[] }>;
  catalog: readonly Title[];
}): Array<{ id: string; title: string; titles: Title[] }> {
  const rows: Array<{ id: string; title: string; titles: Title[] }> = [];
  const take = (titles: readonly Title[]): Title[] =>
    uniqueHubTitles(titles.filter((title) => (input.lane === 'list' ? true : laneMatches(title, input.lane)))).slice(
      0,
      PEACOCK_RAIL_CAP,
    );
  const push = (id: string, title: string, titles: readonly Title[]): void => {
    const next = take(titles);
    if (next.length === 0 || rows.some((row) => row.id === id)) return;
    rows.push({ id, title, titles: next });
  };

  if (input.lane === 'list') {
    push(
      'peacock-stuff',
      'My Stuff',
      input.watchlist.length > 0 ? input.watchlist : [...input.watching, ...input.hubRails.flatMap((rail) => rail.titles)],
    );
    return rows;
  }

  if (input.lane !== 'movies') push('peacock-continue', 'Keep Watching', input.watching);
  for (const rail of input.hubRails) {
    push(rail.id, peacockRailTitle(rail.id, rail.title), rail.titles);
  }
  const films = input.catalog.filter((title) => title.kind === 'movie');
  const shows = input.catalog.filter((title) => title.kind === 'series');
  if (input.lane === 'home' || input.lane === 'movies') push('peacock-movies', 'Popular Movies', films);
  if (input.lane === 'home' || input.lane === 'shows') push('peacock-shows', 'Popular TV Shows', shows);
  return rows;
}

function titlesFromCatalog(catalog: PeacockHubProps['catalog'], items?: PeacockHubProps['items']): Title[] {
  if (Array.isArray(catalog)) return uniqueHubTitles(catalog.map(toHubTitle));
  if (catalog !== undefined && 'items' in catalog && catalog.items !== undefined) {
    return uniqueHubTitles(catalog.items.map(toHubTitle));
  }
  if (items !== undefined) return uniqueHubTitles(items.map(toHubTitle));
  return [...TITLES];
}

function bindWrap(scope: string, index: number, ids: readonly string[], axis: 'x' | 'y') {
  return (direction: string): boolean => {
    const next = wrapHubFocus(direction, index, ids, axis);
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

function PeacockWordmark(): React.JSX.Element {
  return (
    <span className="peacock-hub__brand" aria-hidden="true">
      <svg className="peacock-hub__fan" viewBox="0 0 40 28">
        <path d="M20 14.2c-1.1-4.2.2-8.2 2.4-10.4 1.4 2.6 1.6 6.2.2 10.4z" fill="#f7c51c" />
        <path d="M18.4 15.2c-3.4-2.8-5.2-6.6-4.6-9.8 3.1 1.2 5.4 4.4 6.2 8.6z" fill="#f47b20" />
        <path d="M16.8 17.2c-4.4-.6-7.6-3.2-8.6-6.4 3.6.2 7 2.6 9.2 6.2z" fill="#e31c3d" />
        <path d="M16.6 19.6c-4.2 1.4-6.4 4.6-6.2 7.8 2.8-1.6 5.4-4.2 7.2-7.6z" fill="#6b4ce0" />
        <path d="M19.6 20.4c-1.2 4.2.6 8 3.2 9.6.6-3.2-.2-6.8-2.2-9.8z" fill="#1a9de0" />
        <path d="M22.2 18.2c2.8 3.4 6.6 5.2 9.8 4.6-1.1-3.1-4.2-5.5-8.4-6.4z" fill="#12a85b" />
        <circle cx="20.2" cy="16.6" r="3.05" fill="#111" />
        <circle cx="20.2" cy="16.6" r="1.35" fill="#fff" />
      </svg>
      <span className="peacock-hub__word">peacock</span>
    </span>
  );
}

function PeacockTabIcon({ id }: { id: string }): React.JSX.Element {
  if (id === 'movies') {
    return (
      <svg className="peacock-hub__tab-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.4" y="6.2" width="17.2" height="11.6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M10 9.6v4.8L14.6 12z" fill="currentColor" />
      </svg>
    );
  }
  if (id === 'shows') {
    return (
      <svg className="peacock-hub__tab-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.2" y="5.4" width="17.6" height="11.2" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8.2 19h7.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === 'list') {
    return (
      <svg className="peacock-hub__tab-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 7h10M7 12h10M7 17h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="peacock-hub__tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4.8 11.2 12 5.4l7.2 5.8V19a1.3 1.3 0 0 1-1.3 1.3h-3.6v-5H9.7v5H6.1A1.3 1.3 0 0 1 4.8 19z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PeacockPlayMark(): React.JSX.Element {
  return (
    <svg className="peacock-hub__play-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 4.1v11.8L16.6 10 6 4.1z" fill="currentColor" />
    </svg>
  );
}

const PeacockCard = memo(function PeacockCard({
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
  onSelect: () => void;
}): React.JSX.Element {
  const scope = useFocusScope();
  const clone = loopCopy !== 1;
  const id = clone ? `${prefix}-${title.id}--${loopCopy}` : `${prefix}-${title.id}`;
  const focusKey = useScopedFocusKey(id);
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    focusable: !clone,
    onArrowPress: (direction) => {
      if (clone) return true;
      const hop = wrapFocusId(direction, index, total, firstId, lastId);
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
      className="poster poster--landscape peacock-card"
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      data-loop-clone={clone ? 'true' : undefined}
      data-loop-copy={String(loopCopy)}
      onClick={onSelect}
    >
      <Artwork title={title} kind="backdrop" className="poster__art peacock-card__art" decorative={clone} />
      {title.progress !== undefined && (
        <span className="poster__progress peacock-card__progress" aria-hidden="true">
          <span className="poster__progress-bar" style={{ width: `${Math.round(title.progress * 100)}%` }} />
        </span>
      )}
      <span className="poster__meta peacock-card__meta">
        <span className="poster__title">{title.title}</span>
        <span className="poster__year">{title.episodeLabel ?? (title.year > 0 ? title.year : '')}</span>
      </span>
    </button>
  );
});

function mapPeacockCards(titles: readonly Title[], prefix: string, onSelect: (title: Title) => void): React.JSX.Element[] {
  const ids = peacockCardIds(prefix, titles);
  const firstId = ids[0] ?? '';
  const lastId = ids[ids.length - 1] ?? '';
  return titles.map((title, index) => (
    <PeacockCard
      key={`${prefix}-${title.id}`}
      title={title}
      prefix={prefix}
      index={index}
      total={titles.length}
      firstId={firstId}
      lastId={lastId}
      onSelect={() => onSelect(title)}
    />
  ));
}

const PeacockRail = memo(function PeacockRail({
  id,
  title,
  titles,
  onChoose,
}: {
  id: string;
  title: string;
  titles: readonly Title[];
  onChoose: (railId: string, title: Title) => void;
}): React.JSX.Element {
  return (
    <Rail id={id} title={title}>
      {mapPeacockCards(titles, id, (item) => onChoose(id, item))}
    </Rail>
  );
});

export function PeacockHub({
  appId = 'peacock',
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
}: PeacockHubProps): React.JSX.Element {
  const stackNavigate = useNavigate();
  const navigate = navigateProp ?? stackNavigate;
  const scope = useFocusScope();
  const tabs = useMemo(() => navTabs('peacock'), []);
  const navIds = useMemo(() => peacockNavIds(tabs), [tabs]);
  const actionIds = useMemo(() => peacockHeroActionIds(), []);
  const catalog = useMemo(() => titlesFromCatalog(catalogProp, items), [catalogProp, items]);
  const incoming = laneFromCategory(laneProp ?? category);

  const [laneState, setLaneState] = useState<Lane>(incoming ?? 'home');
  const lane = incoming ?? laneState;
  const [fetchedHub, setFetchedHub] = useState<AppHubPayload | null | undefined>(hubProp);
  const [watching, setWatching] = useState<Title[]>([]);
  const [watchlist, setWatchlist] = useState<Title[]>([]);
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
    return [];
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
  const hero = useMemo(
    () =>
      pickLaneHero(lane, [
        ...(hubHero !== undefined ? [hubHero] : []),
        ...mergedWatching,
        ...hubRails.flatMap((rail) => rail.titles),
        ...catalog,
      ]),
    [catalog, hubHero, hubRails, lane, mergedWatching],
  );

  const rows = useMemo(
    () =>
      buildPeacockRails({
        lane,
        watching: mergedWatching,
        watchlist: mergedWatchlist,
        hubRails,
        catalog,
      }),
    [catalog, hubRails, lane, mergedWatching, mergedWatchlist],
  );

  const navWraps = useMemo(
    () => navIds.map((_, index) => bindWrap(scope, index, navIds, 'y')),
    [navIds, scope],
  );
  const actionWraps = useMemo(
    () => actionIds.map((_, index) => bindWrap(scope, index, actionIds, 'x')),
    [actionIds, scope],
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
    (_railId: string, title: Title): void => {
      activatePeacockTitle(title, playTitle, openTitle);
    },
    [openTitle, playTitle],
  );

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
      startTransition(() => {
        if (incoming === undefined) setLaneState(next);
        onLane?.(next);
      });
      requestFocus(`${scope}/service-tab-${next}`);
    },
    [incoming, lane, onLane, scope],
  );

  const loading = hub === undefined && hero === undefined && rows.length === 0;
  const cert = hero === undefined ? null : certificateLabel(hero.rating);
  const run = hero === undefined ? '' : runtimeLabel(hero);
  const playText = hero?.progress !== undefined ? 'Resume' : playLabel('peacock');

  return (
    <main
      className={`service service--peacock peacock-hub${lane === 'list' ? ' peacock-hub--list' : ''}`}
      aria-label="Peacock"
    >
      <nav className="peacock-hub__nav" aria-label="Peacock">
        <div className="peacock-hub__stripe" aria-hidden="true" />
        <PeacockWordmark />
        <div className="peacock-hub__lanes">
          <FocusButton
            id="service-back"
            className="peacock-hub__back"
            onSelect={goBack}
            onArrowPress={navWraps[0]}
          >
            Back
          </FocusButton>
          {tabs.map((tab, index) => (
            <FocusButton
              key={tab.id}
              id={`service-tab-${tab.id}`}
              className={`peacock-hub__tab${lane === tab.id ? ' peacock-hub__tab--on' : ''}`}
              onSelect={() => changeLane(tab.id)}
              onArrowPress={navWraps[index + 1]}
            >
              <PeacockTabIcon id={tab.id} />
              {tab.label}
            </FocusButton>
          ))}
          <FocusButton
            id="service-search"
            className="peacock-hub__search"
            onSelect={() => navigate.pushModal('search')}
            onArrowPress={navWraps[navIds.length - 1]}
          >
            <IconSearch className="peacock-hub__glyph" />
            Search
          </FocusButton>
        </div>
      </nav>

      <div className="peacock-hub__stage">
        {loading && <Skeleton className="peacock-hub__skeleton" label="Loading Peacock" />}

        {failed && hero === undefined && rows.length === 0 && (
          <EmptyState
            eyebrow="Peacock"
            title="This app could not load"
            body="TVM could not reach the local catalog for Peacock."
            actions={
              <FocusButton id="close" onSelect={goBack}>
                Back
              </FocusButton>
            }
          />
        )}

        {hero !== undefined && lane !== 'list' && (
          <section className="peacock-hub__hero">
            <HeroArt src={preferBackdrop(hero.id, hero.backdrop, hero.poster)} hue={hero.hue} />
            <div className="peacock-hub__veil" aria-hidden="true" />
            <div className="peacock-hub__copy">
              <p className="peacock-hub__kicker">Streaming on Peacock</p>
              <h1 className="peacock-hub__title">{hero.title}</h1>
              <p className="peacock-hub__meta">
                {hero.year > 0 && <span>{hero.year}</span>}
                {cert !== null && <span className="peacock-hub__chip">{cert}</span>}
                {run !== '' && <span>{run}</span>}
                <span>{hero.kind === 'series' ? 'TV Show' : 'Movie'}</span>
                {hero.genres[0] !== undefined && <span>{hero.genres[0]}</span>}
              </p>
              {hero.synopsis !== '' && <p className="peacock-hub__syn">{hero.synopsis}</p>}
              <div className="peacock-hub__actions" data-wrap="row">
                <FocusButton
                  id="service-play"
                  variant="primary"
                  className="peacock-hub__play"
                  onSelect={() => playTitle(hero)}
                  onArrowPress={actionWraps[0]}
                >
                  <PeacockPlayMark />
                  {playText}
                </FocusButton>
                <FocusButton
                  id="service-info"
                  className="peacock-hub__more"
                  onSelect={() => openTitle(hero)}
                  onArrowPress={actionWraps[1]}
                >
                  {moreLabel('peacock')}
                </FocusButton>
              </div>
            </div>
          </section>
        )}

        {lane === 'list' && (
          <header className="peacock-hub__list-head">
            <h1 className="peacock-hub__list-title">My Stuff</h1>
            <p className="peacock-hub__list-lede">Titles you save stay here for later.</p>
          </header>
        )}

        <div className="peacock-hub__rails" key={lane}>
          {rows.map((rail) => (
            <PeacockRail key={rail.id} id={rail.id} title={rail.title} titles={rail.titles} onChoose={chooseCard} />
          ))}
          {rows.length === 0 && !loading && (
            <p className="peacock-hub__empty">Nothing in this category yet. Titles still play through TVM Stream.</p>
          )}
        </div>
        {hub?.disclaimer !== undefined && hub.disclaimer !== '' && <p className="peacock-hub__note">{hub.disclaimer}</p>}
      </div>
    </main>
  );
}
