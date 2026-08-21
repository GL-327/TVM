import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
import { revealFocused } from '../../../nav/revealFocused';
import { useFocusScope, useNavigate, useScopedFocusKey, type Navigate } from '../../../nav/ViewStackContext';
import { wrapFocusId } from '../../../nav/wrapFocus';
import { laneMatches, moreLabel, navTabs, playLabel, type Lane } from '../layouts';
import './hulu.css';

const HULU_RAIL_CAP = 18;

export type HubCatalogBag = {
  rails?: AppHubPayload['rails'];
  continueWatching?: AppHubPayload['continueWatching'];
  watchlist?: Array<MediaItem | Title>;
  hero?: AppHubPayload['hero'];
  items?: Array<MediaItem | Title>;
};

/** Props the Service dispatcher passes through (hub, catalog, navigate, play). */
export interface HuluHubProps {
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
  if (key === 'for you') return 'home';
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

export function wrapHubFocus(direction: string, index: number, ids: readonly string[]): string | null {
  const first = ids[0];
  const last = ids[ids.length - 1];
  if (first === undefined || last === undefined) return null;
  return wrapFocusId(direction, index, ids.length, first, last);
}

/** Left rail is a column: map up/down onto the existing left/right wrap. Content rows do not wrap on Down so the page camera can move. */
export function wrapHubNavFocus(direction: string, index: number, ids: readonly string[]): string | null {
  const mapped = direction === 'up' ? 'left' : direction === 'down' ? 'right' : direction;
  return wrapHubFocus(mapped, index, ids);
}

export function huluNavIds(tabs: readonly { id: string }[]): string[] {
  return ['service-back', ...tabs.map((tab) => `service-tab-${tab.id}`), 'service-search'];
}

export function huluHeroActionIds(): string[] {
  return ['service-play', 'service-info'];
}

/** Real tiles keep a stable id; conveyor copies use `--0` / `--2` so they stay out of the focus map. */
export function huluCardId(prefix: string, titleId: string, loopCopy = 1): string {
  return loopCopy !== 1 ? `${prefix}-${titleId}--${loopCopy}` : `${prefix}-${titleId}`;
}

export function huluCardIds(prefix: string, titles: readonly Title[]): string[] {
  return titles.map((title) => huluCardId(prefix, title.id));
}

export function huluRailTitle(id: string, fallback: string): string {
  if (id.endsWith('-continue') || id.includes('continue')) return 'Continue Watching';
  if (id.endsWith('-series') || /original/i.test(fallback)) return 'Hulu Originals';
  if (id.endsWith('-films') || /film|movie/i.test(fallback)) return 'Popular Movies';
  if (id.endsWith('-shows')) return 'Popular Series';
  if (id.endsWith('-trending')) return 'Trending on Hulu';
  if (id.endsWith('-because')) return 'Because You Watched';
  if (id.endsWith('-liked') || id.includes('watchlist') || id.includes('stuff')) return 'My Stuff';
  return fallback;
}

/** Continue Watching resumes in TVM Stream; other rails open details. */
export function huluRailAction(railId: string): 'play' | 'details' {
  return railId.includes('continue') ? 'play' : 'details';
}

export function huluHeroKicker(title: Title): string {
  if (title.progress !== undefined) return 'Continue Watching';
  if (/hulu/i.test(title.network ?? '')) return 'Hulu Original';
  return title.kind === 'series' ? 'Hulu Original' : 'Featured on Hulu';
}

export function huluPlayLabel(title: Title): string {
  return title.progress !== undefined ? 'Resume' : playLabel('hulu');
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

export function buildHuluRails(input: {
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
      HULU_RAIL_CAP,
    );
  const push = (id: string, title: string, titles: readonly Title[]): void => {
    const next = take(titles);
    if (next.length === 0 || rows.some((row) => row.id === id)) return;
    rows.push({ id, title, titles: next });
  };

  if (input.lane === 'list') {
    push('hulu-stuff', 'My Stuff', input.watchlist.length > 0 ? input.watchlist : [...input.watching, ...input.hubRails.flatMap((rail) => rail.titles)]);
    return rows;
  }

  if (input.lane !== 'movies') push('hulu-continue', 'Continue Watching', input.watching);
  for (const rail of input.hubRails) {
    push(rail.id, huluRailTitle(rail.id, rail.title), rail.titles);
  }
  const films = input.catalog.filter((title) => title.kind === 'movie');
  const shows = input.catalog.filter((title) => title.kind === 'series');
  if (input.lane === 'home' || input.lane === 'movies') push('hulu-movies', 'Popular Movies', films);
  if (input.lane === 'home' || input.lane === 'shows') push('hulu-shows', 'Popular Series', shows);
  return rows;
}

function titlesFromCatalog(catalog: HuluHubProps['catalog'], items?: HuluHubProps['items']): Title[] {
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

function bindNavWrap(scope: string, index: number, ids: readonly string[]) {
  return (direction: string): boolean => {
    const next = wrapHubNavFocus(direction, index, ids);
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

const HULU_TABS = navTabs('hulu');
const HULU_NAV_IDS = huluNavIds(HULU_TABS);
const HULU_ACTION_IDS = huluHeroActionIds();

function HuluWordmark(): React.JSX.Element {
  return (
    <span className="hulu-hub__brand" aria-hidden="true">
      <svg className="hulu-hub__mark" viewBox="0 0 92 28">
        <g fill="currentColor">
          <rect x="0" y="6" width="5.2" height="16.8" rx="2.4" />
          <rect x="12.4" y="6" width="5.2" height="16.8" rx="2.4" />
          <rect x="0" y="11.8" width="17.6" height="5.2" rx="2.4" />
          <path d="M25.6 6h5.2v10.6c0 2.7 1.35 4.05 3.7 4.05s3.7-1.35 3.7-4.05V6h5.2v10.85c0 5.7-3.2 8.35-8.9 8.35s-8.9-2.65-8.9-8.35V6z" />
          <rect x="50.6" y="2" width="5.2" height="20.8" rx="2.4" />
          <path d="M63.2 6h5.2v10.6c0 2.7 1.35 4.05 3.7 4.05s3.7-1.35 3.7-4.05V6h5.2v10.85c0 5.7-3.2 8.35-8.9 8.35s-8.9-2.65-8.9-8.35V6z" />
        </g>
      </svg>
    </span>
  );
}

function HuluTabIcon({ id }: { id: string }): React.JSX.Element {
  if (id === 'movies') {
    return (
      <svg className="hulu-hub__tab-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.2" y="5.6" width="17.6" height="12.8" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M10 9.4v5.2L15.1 12z" fill="currentColor" />
      </svg>
    );
  }
  if (id === 'shows') {
    return (
      <svg className="hulu-hub__tab-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.4" y="4.8" width="17.2" height="11.2" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8.2 19.2h7.6M12 16v3.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === 'list') {
    return (
      <svg className="hulu-hub__tab-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M7.1 4.6h9.8v14.4l-4.9-3.2-4.9 3.2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg className="hulu-hub__tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4.7 11.1 12 5l7.3 6.1V18.8A1.5 1.5 0 0 1 17.8 20.3h-3.5v-5.1H9.7v5.1H6.2A1.5 1.5 0 0 1 4.7 18.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HuluPlayMark(): React.JSX.Element {
  return (
    <svg className="hulu-hub__play-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6.2 4.2v11.6L16.4 10 6.2 4.2z" fill="currentColor" />
    </svg>
  );
}

function HuluSearchMark(): React.JSX.Element {
  return (
    <svg className="hulu-hub__glyph" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.6" cy="10.6" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m14.6 14.6 4.6 4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const HuluCard = memo(function HuluCard({
  title,
  prefix,
  loopCopy = 1,
  onSelect,
}: {
  title: Title;
  prefix: string;
  loopCopy?: number;
  onSelect: () => void;
}): React.JSX.Element {
  const clone = loopCopy !== 1;
  const id = huluCardId(prefix, title.id, loopCopy);
  const focusKey = useScopedFocusKey(id);
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    focusable: !clone,
    onArrowPress: () => true,
    onFocus: () => {
      const node = ref.current;
      if (node !== null) revealFocused(node);
    },
  });

  return (
    <button
      ref={ref}
      type="button"
      className="poster poster--landscape hulu-card"
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
      <span className="hulu-card__frame">
        <Artwork title={title} kind="backdrop" className="poster__art hulu-card__art" decorative={clone} />
        {title.progress !== undefined && (
          <span className="poster__progress hulu-card__progress" aria-hidden="true">
            <span className="poster__progress-bar" style={{ width: `${Math.round(title.progress * 100)}%` }} />
          </span>
        )}
        <span className="poster__meta hulu-card__meta">
          <span className="poster__title">{title.title}</span>
          <span className="poster__year">{title.episodeLabel ?? (title.year > 0 ? title.year : '')}</span>
        </span>
      </span>
    </button>
  );
});

function mapHuluCards(titles: readonly Title[], prefix: string, onSelect: (title: Title) => void): React.JSX.Element[] {
  return titles.map((title) => (
    <HuluCard key={`${prefix}-${title.id}`} title={title} prefix={prefix} onSelect={() => onSelect(title)} />
  ));
}

export function HuluHub({
  appId = 'hulu',
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
}: HuluHubProps): React.JSX.Element {
  const stackNavigate = useNavigate();
  const navigate = navigateProp ?? stackNavigate;
  const scope = useFocusScope();
  const incoming = laneFromCategory(laneProp ?? category);
  const catalog = useMemo(() => titlesFromCatalog(catalogProp, items), [catalogProp, items]);

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
    if (catalogProp === undefined || Array.isArray(catalogProp) || !('continueWatching' in catalogProp)) return [];
    return (catalogProp.continueWatching ?? []).map(asTitle);
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
  const hubHero = hub?.hero !== null && hub?.hero !== undefined ? asTitle(hub.hero) : undefined;
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
      buildHuluRails({
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
      if (huluRailAction(railId) === 'play') {
        playTitle(title);
        return;
      }
      openTitle(title);
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
      if (incoming === undefined) setLaneState(next);
      onLane?.(next);
      window.setTimeout(() => requestFocus(`${scope}/service-tab-${next}`), 0);
    },
    [incoming, lane, onLane, scope],
  );

  const loading = hub === undefined && hero === undefined && rows.length === 0;
  const cert = hero === undefined ? null : certificateLabel(hero.rating);
  const run = hero === undefined ? '' : runtimeLabel(hero);
  const playText = hero === undefined ? playLabel('hulu') : huluPlayLabel(hero);
  const heroSrc = hero === undefined ? '' : preferBackdrop(hero.id, hero.backdrop, hero.poster);

  return (
    <main className={`service service--hulu hulu-hub${lane === 'list' ? ' hulu-hub--list' : ''}`} aria-label="Hulu">
      <nav className="hulu-hub__nav" aria-label="Hulu" data-wrap="col">
        <HuluWordmark />
        <FocusButton
          id="service-back"
          className="hulu-hub__back"
          onSelect={goBack}
          onArrowPress={bindNavWrap(scope, 0, HULU_NAV_IDS)}
        >
          Back
        </FocusButton>
        <div className="hulu-hub__tabs">
          {HULU_TABS.map((tab, index) => (
            <FocusButton
              key={tab.id}
              id={`service-tab-${tab.id}`}
              className={`hulu-hub__tab${lane === tab.id ? ' hulu-hub__tab--on' : ''}`}
              onSelect={() => changeLane(tab.id)}
              onArrowPress={bindNavWrap(scope, index + 1, HULU_NAV_IDS)}
            >
              <HuluTabIcon id={tab.id} />
              {tab.label}
            </FocusButton>
          ))}
        </div>
        <FocusButton
          id="service-search"
          className="hulu-hub__search"
          onSelect={() => navigate.pushModal('search')}
          onArrowPress={bindNavWrap(scope, HULU_NAV_IDS.length - 1, HULU_NAV_IDS)}
        >
          <HuluSearchMark />
          Search
        </FocusButton>
      </nav>

      <div className="hulu-hub__stage">
        {loading && <Skeleton className="hulu-hub__skeleton" label="Loading Hulu" />}

        {failed && hero === undefined && rows.length === 0 && (
          <EmptyState
            eyebrow="Hulu"
            title="This app could not load"
            body="TVM could not reach the local catalog for Hulu."
            actions={
              <FocusButton id="close" onSelect={goBack}>
                Back
              </FocusButton>
            }
          />
        )}

        {hero !== undefined && lane !== 'list' && (
          <section className="hulu-hub__hero">
            <HeroArt src={heroSrc} hue={hero.hue} />
            <div className="hulu-hub__veil" aria-hidden="true" />
            <div className="hulu-hub__copy">
              <p className="hulu-hub__kicker">{huluHeroKicker(hero)}</p>
              <h1 className="hulu-hub__title">{hero.title}</h1>
              <p className="hulu-hub__meta">
                {hero.year > 0 && <span>{hero.year}</span>}
                {cert !== null && <span className="hulu-hub__chip">{cert}</span>}
                {run !== '' && <span>{run}</span>}
                <span>{hero.kind === 'series' ? 'TV' : 'Movie'}</span>
                {hero.genres[0] !== undefined && <span>{hero.genres[0]}</span>}
              </p>
              {hero.synopsis !== '' && <p className="hulu-hub__syn">{hero.synopsis}</p>}
              <div className="hulu-hub__actions" data-wrap="row">
                <FocusButton
                  id="service-play"
                  variant="primary"
                  className="hulu-hub__play"
                  onSelect={() => playTitle(hero)}
                  onArrowPress={bindWrap(scope, 0, HULU_ACTION_IDS)}
                >
                  <HuluPlayMark />
                  {playText}
                </FocusButton>
                <FocusButton
                  id="service-info"
                  className="hulu-hub__more"
                  onSelect={() => openTitle(hero)}
                  onArrowPress={bindWrap(scope, 1, HULU_ACTION_IDS)}
                >
                  {moreLabel('hulu')}
                </FocusButton>
              </div>
            </div>
          </section>
        )}

        {lane === 'list' && (
          <header className="hulu-hub__list-head">
            <h1 className="hulu-hub__list-title">My Stuff</h1>
            <p className="hulu-hub__list-lede">Shows and movies you save stay on this device.</p>
          </header>
        )}

        <div className="hulu-hub__rails">
          {rows.map((rail) => (
            <Rail key={rail.id} id={rail.id} title={rail.title}>
              {mapHuluCards(rail.titles, rail.id, (title) => chooseCard(rail.id, title))}
            </Rail>
          ))}
          {rows.length === 0 && !loading && (
            <p className="hulu-hub__empty">Nothing in this category yet. Titles still play through TVM Stream.</p>
          )}
        </div>
        {hub?.disclaimer !== undefined && hub.disclaimer !== '' && <p className="hulu-hub__note">{hub.disclaimer}</p>}
      </div>
    </main>
  );
}
