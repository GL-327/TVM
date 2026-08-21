import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useMemo, useState } from 'react';
import { Artwork } from '../../../components/Artwork';
import { BrandMark, hasBrandMark } from '../../../components/BrandMark';
import { EmptyState } from '../../../components/EmptyState';
import { FocusButton } from '../../../components/FocusButton';
import { HeroArt } from '../../../components/HeroArt';
import { IconChevronLeft, IconPlay, IconSearch } from '../../../components/Icons';
import { Rail } from '../../../components/Rail';
import { Skeleton } from '../../../components/Skeleton';
import { fetchAppHub, type AppHubPayload } from '../../../data/apps';
import { preferBackdrop } from '../../../data/artwork';
import { APPS, MORE_APPS, TITLES, type Title } from '../../../data/catalog';
import { asTitle, fetchHome, fetchWatchlist, toMediaItem, type MediaItem } from '../../../data/media';
import { openDetails, openPlayback } from '../../../data/openDetails';
import { certificateLabel } from '../../../data/playId';
import { requestFocus } from '../../../nav/focusEngine';
import { revealFocused, rowCameraTop, scrollAxis, shouldNudgePageY } from '../../../nav/revealFocused';
import { useFocusScope, useNavigate, useScopedFocusKey, type Navigate } from '../../../nav/ViewStackContext';
import { wrapFocusId } from '../../../nav/wrapFocus';
import { laneMatches, type Lane } from '../layouts';
import type { HubCatalog, ServiceSkinProps } from './types';
import './legacy.css';

const RAIL_LIMIT = 16;
const DEFAULT_ACCENT = '#6ea8ff';

export const LEGACY_TABS: Array<{ id: Lane; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'shows', label: 'Series' },
  { id: 'movies', label: 'Movies' },
  { id: 'list', label: 'My List' },
];

export type LegacyHubProps = ServiceSkinProps & {
  onOpenTitle?: (title: Title) => void;
  navigate?: Navigate;
};

export function laneFromCategory(value: string | undefined): Lane | undefined {
  if (value === undefined) return undefined;
  const key = value.trim().toLowerCase();
  if (key === 'home' || key === 'shows' || key === 'movies' || key === 'list' || key === 'new' || key === 'kids') {
    return key;
  }
  if (key === 'series' || key === 'tv' || key === 'tv shows' || key === 'tvshows') return 'shows';
  if (key === 'mylist' || key === 'my-list' || key === 'my list' || key === 'watchlist' || key === 'stuff') return 'list';
  return undefined;
}

export function toHubTitle(value: MediaItem | Title): Title {
  return asTitle({
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

export function legacyNavIds(tabs: readonly { id: string }[]): string[] {
  return ['service-back', ...tabs.map((tab) => `service-tab-${tab.id}`), 'service-search'];
}

export function legacyHeroActionIds(): string[] {
  return ['service-play', 'service-info'];
}

/** Conveyor clones use `--0` / `--2`. The focusable copy has no suffix. */
export function legacyCardId(prefix: string, titleId: string, loopCopy = 1): string {
  return loopCopy !== 1 ? `${prefix}-${titleId}--${loopCopy}` : `${prefix}-${titleId}`;
}

export function legacyCardIds(prefix: string, titles: readonly { id: string }[]): string[] {
  return titles.map((title) => legacyCardId(prefix, title.id));
}

export function legacyPlayLabel(title: Title | undefined): string {
  return title?.progress !== undefined ? 'Resume' : 'Play';
}

/** Pin the focused rail under the sticky nav so Down moves the page camera. */
export function legacyDownCameraY(
  scrollTop: number,
  railTop: number,
  viewTop: number,
  navHeight: number,
): number {
  return rowCameraTop(scrollTop, railTop, viewTop, navHeight);
}

function revealLegacyCard(card: HTMLElement): void {
  revealFocused(card);
  const hub = card.closest<HTMLElement>('.legacy-hub');
  const rail = card.closest<HTMLElement>('.rail');
  if (hub === null || rail === null) return;
  requestAnimationFrame(() => {
    const nav = hub.querySelector<HTMLElement>('.legacy-hub__nav');
    const pad = nav?.getBoundingClientRect().height ?? 16;
    const hubBox = hub.getBoundingClientRect();
    const railBox = rail.getBoundingClientRect();
    const target = legacyDownCameraY(hub.scrollTop, railBox.top, hubBox.top, pad);
    if (!shouldNudgePageY(hub.scrollTop, target)) return;
    scrollAxis(hub, 'y', target);
  });
}

/** Continue Watching resumes in TVM Stream; other rails open details. */
export function legacyRailAction(railId: string): 'play' | 'details' {
  return /continue|up-next|upnext/.test(railId) ? 'play' : 'details';
}

export function usableAccent(hex: string | undefined): string {
  const raw = (hex ?? '').trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return DEFAULT_ACCENT;
  const full =
    raw.length === 4 && raw[1] !== undefined && raw[2] !== undefined && raw[3] !== undefined
      ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
      : raw;
  const r = Number.parseInt(full.slice(1, 3), 16);
  const g = Number.parseInt(full.slice(3, 5), 16);
  const b = Number.parseInt(full.slice(5, 7), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum < 0.16 || lum > 0.88) return DEFAULT_ACCENT;
  return full;
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

export function legacyAppMeta(appId: string): { name: string; accent: string; wordmark: string; logo: string } {
  const tile = [...APPS, ...MORE_APPS].find((entry) => entry.id === appId);
  return {
    name: tile?.name ?? 'App',
    accent: tile?.accent ?? DEFAULT_ACCENT,
    wordmark: tile?.wordmark ?? tile?.name ?? 'App',
    logo: tile?.icon ?? '',
  };
}

export function legacyFallbackHub(appId: string): AppHubPayload {
  const meta = legacyAppMeta(appId);
  const films = TITLES.filter((title) => title.kind === 'movie').slice(0, RAIL_LIMIT);
  const shows = TITLES.filter((title) => title.kind === 'series').slice(0, RAIL_LIMIT);
  const lead = TITLES[0];
  return {
    id: appId,
    name: meta.name,
    accent: meta.accent,
    layout: appId,
    wordmark: meta.wordmark,
    logo: meta.logo,
    disclaimer: 'Not the licensed app. Playback uses TVM Stream / Real-Debrid.',
    hero: lead === undefined ? null : toMediaItem(lead),
    continueWatching: [],
    rails: [
      { id: `${appId}-films`, title: 'Movies', items: films.map(toMediaItem) },
      { id: `${appId}-shows`, title: 'Series', items: shows.map(toMediaItem) },
      { id: `${appId}-trending`, title: 'Trending now', items: TITLES.slice(0, RAIL_LIMIT).map(toMediaItem) },
    ],
  };
}

export function buildLegacyRails(input: {
  appId: string;
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
      RAIL_LIMIT,
    );
  const push = (id: string, title: string, titles: readonly Title[]): void => {
    const next = take(titles);
    if (next.length === 0 || rows.some((row) => row.id === id)) return;
    rows.push({ id, title, titles: next });
  };

  if (input.lane === 'list') {
    const mine = input.watchlist.length > 0 ? input.watchlist : input.watching;
    push(`${input.appId}-list`, 'My List', mine);
    return rows;
  }

  if (input.lane !== 'movies') push(`${input.appId}-continue`, 'Continue Watching', input.watching);
  if (input.lane === 'home' && input.watchlist.length > 0) {
    push(`${input.appId}-watchlist`, 'My List', input.watchlist);
  }
  for (const rail of input.hubRails) {
    push(rail.id, rail.title, rail.titles);
  }
  const films = input.catalog.filter((title) => title.kind === 'movie');
  const shows = input.catalog.filter((title) => title.kind === 'series');
  if (input.lane === 'home' || input.lane === 'movies') push(`${input.appId}-movies`, 'Movies', films);
  if (input.lane === 'home' || input.lane === 'shows') push(`${input.appId}-shows`, 'Series', shows);
  return rows;
}

function isCatalogBag(value: unknown): value is AppHubPayload | HubCatalog {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function titlesFromCatalog(catalog: LegacyHubProps['catalog'], items?: LegacyHubProps['items']): Title[] {
  const extra = (items ?? []).map(toHubTitle);
  if (Array.isArray(catalog)) return uniqueHubTitles([...catalog.map(toHubTitle), ...extra]);
  if (isCatalogBag(catalog)) {
    const fromHero = catalog.hero !== null && catalog.hero !== undefined ? [asTitle(catalog.hero)] : [];
    const fromWatching = (catalog.continueWatching ?? []).map(asTitle);
    const fromRails = (catalog.rails ?? []).flatMap((rail) => rail.items.map(asTitle));
    const fromItems = ('items' in catalog && catalog.items !== undefined ? catalog.items : []).map(toHubTitle);
    const fromList = ('watchlist' in catalog && catalog.watchlist !== undefined ? catalog.watchlist : []).map(toHubTitle);
    const merged = uniqueHubTitles([...fromHero, ...fromWatching, ...fromRails, ...fromItems, ...fromList, ...extra]);
    return merged.length > 0 ? merged : uniqueHubTitles([...TITLES, ...extra]);
  }
  if (extra.length > 0) return uniqueHubTitles(extra);
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

function LegacyCard({
  title,
  prefix,
  index,
  total,
  firstId,
  lastId,
  selected,
  loopCopy = 1,
  onSelect,
  onPreview,
}: {
  title: Title;
  prefix: string;
  index: number;
  total: number;
  firstId: string;
  lastId: string;
  selected: boolean;
  loopCopy?: number;
  onSelect: () => void;
  onPreview: (title: Title) => void;
}): React.JSX.Element {
  const scope = useFocusScope();
  const clone = loopCopy !== 1;
  const id = legacyCardId(prefix, title.id, loopCopy);
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
      if (node !== null) requestAnimationFrame(() => revealLegacyCard(node));
      if (!clone) onPreview(title);
    },
  });

  return (
    <button
      ref={ref}
      type="button"
      className={`poster poster--landscape legacy-card${selected ? ' legacy-card--on' : ''}`}
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-loop-clone={clone ? 'true' : undefined}
      data-loop-copy={String(loopCopy)}
      onClick={onSelect}
    >
      <Artwork title={title} kind="backdrop" className="poster__art legacy-card__art" decorative={clone} />
      {title.progress !== undefined && (
        <span className="poster__progress" aria-hidden="true">
          <span className="poster__progress-bar" style={{ width: `${Math.round(title.progress * 100)}%` }} />
        </span>
      )}
      <span className="poster__meta legacy-card__meta">
        <span className="poster__title">{title.title}</span>
        <span className="poster__year">{title.episodeLabel ?? (title.year > 0 ? title.year : '')}</span>
      </span>
    </button>
  );
}

function mapLegacyCards(
  titles: readonly Title[],
  prefix: string,
  selectedId: string | undefined,
  onSelect: (title: Title) => void,
  onPreview: (title: Title) => void,
): React.JSX.Element[] {
  const ids = legacyCardIds(prefix, titles);
  const firstId = ids[0] ?? '';
  const lastId = ids[ids.length - 1] ?? '';
  return titles.map((title, index) => (
    <LegacyCard
      key={`${prefix}-${title.id}`}
      title={title}
      prefix={prefix}
      index={index}
      total={titles.length}
      firstId={firstId}
      lastId={lastId}
      selected={selectedId === title.id}
      onSelect={() => onSelect(title)}
      onPreview={onPreview}
    />
  ));
}

export function LegacyHub(props: LegacyHubProps): React.JSX.Element {
  const {
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
  } = props;
  const stackNavigate = useNavigate();
  const navigate = navigateProp ?? stackNavigate;
  const scope = useFocusScope();
  const appId = props.appId ?? hubProp?.id ?? 'app';
  const tabs = LEGACY_TABS;
  const navIds = legacyNavIds(tabs);
  const actionIds = legacyHeroActionIds();
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

  const fallback = useMemo(() => legacyFallbackHub(appId), [appId]);
  const resolved = hubProp === undefined ? fetchedHub : hubProp;
  const hub = resolved ?? fallback;
  const hubWatching = useMemo(() => (hub.continueWatching ?? []).map(asTitle), [hub]);
  const catalogWatching =
    catalogProp !== undefined && !Array.isArray(catalogProp) && 'continueWatching' in catalogProp
      ? (catalogProp.continueWatching ?? []).map(asTitle)
      : [];
  const hubRails = useMemo(() => {
    const fromCatalog =
      catalogProp !== undefined && !Array.isArray(catalogProp) && 'rails' in catalogProp ? catalogProp.rails : undefined;
    const source = railsProp ?? fromCatalog ?? hub.rails ?? [];
    return source.map((rail) => ({
      id: rail.id,
      title: rail.title,
      titles: rail.items.map(asTitle),
    }));
  }, [catalogProp, hub, railsProp]);

  const mergedWatching = uniqueHubTitles([...hubWatching, ...catalogWatching, ...watching]);
  const mergedWatchlist = uniqueHubTitles(watchlist);
  const hubHero = hub.hero !== null && hub.hero !== undefined ? asTitle(hub.hero) : undefined;
  const featured = pickLaneHero(lane, [
    ...(hubHero !== undefined ? [hubHero] : []),
    ...mergedWatching,
    ...hubRails.flatMap((rail) => rail.titles),
    ...catalog,
  ]);
  const hero = preview !== undefined && (lane === 'list' || laneMatches(preview, lane)) ? preview : featured;

  const rows = useMemo(
    () =>
      buildLegacyRails({
        appId,
        lane,
        watching: mergedWatching,
        watchlist: mergedWatchlist,
        hubRails,
        catalog,
      }),
    [appId, catalog, hubRails, lane, mergedWatching, mergedWatchlist],
  );

  const playTitle = (title: Title): void => {
    if (play !== undefined) {
      play(title);
      return;
    }
    if (onPlay !== undefined) {
      onPlay(title);
      return;
    }
    openPlayback(navigate, title);
  };

  const openTitle = (title: Title): void => {
    if (onOpen !== undefined) {
      onOpen(title);
      return;
    }
    if (onOpenTitle !== undefined) {
      onOpenTitle(title);
      return;
    }
    openDetails(navigate, title);
  };

  const chooseCard = (railId: string, title: Title): void => {
    if (legacyRailAction(railId) === 'play') {
      playTitle(title);
      return;
    }
    openTitle(title);
  };

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
    if (incoming === undefined) setLaneState(next);
    onLane?.(next);
    window.setTimeout(() => requestFocus(`${scope}/service-tab-${next}`), 0);
  };

  const loading = resolved === undefined && featured === undefined && rows.length === 0;
  const empty = failed && featured === undefined && rows.length === 0;
  const accent = usableAccent(hub.accent);
  const cert = hero === undefined ? null : certificateLabel(hero.rating);
  const run = hero === undefined ? '' : runtimeLabel(hero);
  const playText = legacyPlayLabel(hero);
  const brandName = hub.wordmark || hub.name;

  return (
    <main
      className={`service service--legacy legacy-hub${lane === 'list' ? ' legacy-hub--list' : ''}`}
      aria-label={hub.name}
      style={{ ['--legacy-accent' as string]: accent }}
    >
      <nav className="service-nav legacy-hub__nav" aria-label={hub.name} data-wrap="row">
        <FocusButton
          id="service-back"
          className="legacy-hub__back"
          onSelect={goBack}
          onArrowPress={bindWrap(scope, 0, navIds)}
        >
          <IconChevronLeft className="legacy-hub__glyph" />
          <span className="legacy-hub__vh">Back</span>
        </FocusButton>
        <div className="legacy-hub__brand">
          {hasBrandMark(hub.id) ? <BrandMark id={hub.id} /> : <span className="legacy-hub__word">{brandName}</span>}
        </div>
        <div className="legacy-hub__strip">
          {tabs.map((tab, index) => (
            <FocusButton
              key={tab.id}
              id={`service-tab-${tab.id}`}
              className={`legacy-hub__tab${lane === tab.id ? ' legacy-hub__tab--on' : ''}`}
              onSelect={() => changeLane(tab.id)}
              onArrowPress={bindWrap(scope, index + 1, navIds)}
            >
              {tab.label}
            </FocusButton>
          ))}
        </div>
        <FocusButton
          id="service-search"
          className="legacy-hub__search"
          onSelect={() => navigate.pushModal('search')}
          onArrowPress={bindWrap(scope, navIds.length - 1, navIds)}
        >
          <IconSearch className="legacy-hub__glyph" />
          Search
        </FocusButton>
      </nav>

      {loading && <Skeleton className="legacy-hub__skeleton" label={`Loading ${hub.name}`} />}

      {empty && (
        <EmptyState
          eyebrow={hub.name}
          title="This app could not load"
          body="TVM could not reach the local catalog for this service."
          actions={
            <FocusButton id="close" onSelect={goBack}>
              Back
            </FocusButton>
          }
        />
      )}

      {hero !== undefined && lane !== 'list' && (
        <section className="legacy-hub__hero">
          <HeroArt src={preferBackdrop(hero.id, hero.backdrop, hero.poster)} hue={hero.hue} />
          <div className="legacy-hub__veil" aria-hidden="true" />
          <div className="legacy-hub__copy">
            <p className="legacy-hub__kicker">Now on {hub.name}</p>
            <h1 className="legacy-hub__title">{hero.title}</h1>
            <p className="legacy-hub__meta">
              {hero.year > 0 && <span>{hero.year}</span>}
              {cert !== null && <span className="legacy-hub__chip">{cert}</span>}
              {run !== '' && <span>{run}</span>}
              <span>{hero.kind === 'series' ? 'Series' : 'Movie'}</span>
              {hero.genres[0] !== undefined && <span>{hero.genres[0]}</span>}
            </p>
            {hero.synopsis !== '' && <p className="legacy-hub__syn">{hero.synopsis}</p>}
            <div className="service-hero__actions legacy-hub__actions" data-wrap="row">
              <FocusButton
                id="service-play"
                variant="primary"
                className="legacy-hub__play"
                onSelect={() => playTitle(hero)}
                onArrowPress={bindWrap(scope, 0, actionIds)}
              >
                <IconPlay className="legacy-hub__play-icon" />
                {playText}
              </FocusButton>
              <FocusButton
                id="service-info"
                className="legacy-hub__more"
                onSelect={() => openTitle(hero)}
                onArrowPress={bindWrap(scope, 1, actionIds)}
              >
                More Info
              </FocusButton>
            </div>
          </div>
        </section>
      )}

      {lane === 'list' && (
        <header className="legacy-hub__list-head">
          <h1 className="legacy-hub__list-title">My List</h1>
          <p className="legacy-hub__list-lede">
            {mergedWatchlist.length > 0
              ? 'Titles you save stay on this device.'
              : 'Save a title from More Info. Rows below still play through TVM Stream.'}
          </p>
        </header>
      )}

      <div className="legacy-hub__rails" key={lane}>
        {rows.map((rail) => (
          <Rail key={rail.id} id={rail.id} title={rail.title}>
            {mapLegacyCards(rail.titles, rail.id, hero?.id, (title) => chooseCard(rail.id, title), setPreview)}
          </Rail>
        ))}
        {rows.length === 0 && !loading && !empty && (
          <p className="legacy-hub__empty">Nothing in this category yet. Titles still play through TVM Stream.</p>
        )}
      </div>
      {hub.disclaimer !== '' && <p className="legacy-hub__note">{hub.disclaimer}</p>}
    </main>
  );
}
