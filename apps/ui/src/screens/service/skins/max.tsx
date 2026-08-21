import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Artwork } from '../../../components/Artwork';
import { EmptyState } from '../../../components/EmptyState';
import { FocusButton } from '../../../components/FocusButton';
import { HeroArt } from '../../../components/HeroArt';
import { IconPlay, IconSearch } from '../../../components/Icons';
import { Rail } from '../../../components/Rail';
import { Skeleton } from '../../../components/Skeleton';
import { preferBackdrop } from '../../../data/artwork';
import { fetchAppHub, type AppHubPayload } from '../../../data/apps';
import { TITLES, type Title } from '../../../data/catalog';
import { asTitle, fetchWatchlist, toMediaItem, type MediaItem } from '../../../data/media';
import { openDetails, openPlayback } from '../../../data/openDetails';
import { certificateLabel } from '../../../data/playId';
import { requestFocus } from '../../../nav/focusEngine';
import { revealFocused, scrollAxis, shouldNudgePageY } from '../../../nav/revealFocused';
import { useFocusScope, useNavigate, useScopedFocusKey, type Navigate } from '../../../nav/ViewStackContext';
import { wrapFocusId } from '../../../nav/wrapFocus';
import { moreLabel, playLabel, type Lane } from '../layouts';
import './max.css';

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

export type MaxHubProps = ServiceHubProps;

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

export const MAX_TABS: Array<{ id: Lane; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'shows', label: 'Series' },
  { id: 'movies', label: 'Movies' },
  { id: 'new', label: 'Sports' },
  { id: 'list', label: 'My Stuff' },
];

const SPORTS_RE = /sport|smackdown|wwe|nfl|nba|mlb|ufc|racing|wrestl|fight night/i;

export function wrapHubFocus(
  direction: string,
  index: number,
  total: number,
  firstId: string,
  lastId: string,
): string | null {
  return wrapFocusId(direction, index, total, firstId, lastId);
}

/** Real tiles keep a stable id; conveyor copies use `--0` / `--2` so they stay out of the focus map. */
export function maxCardId(prefix: string, titleId: string, loopCopy = 1): string {
  return loopCopy !== 1 ? `${prefix}-${titleId}--${loopCopy}` : `${prefix}-${titleId}`;
}

export function maxCardIds(prefix: string, titles: readonly { id: string }[]): string[] {
  return titles.map((title) => maxCardId(prefix, title.id));
}

/** Living-room down camera: lock the focused rail just under the Max nav. */
export function maxRowCameraTop(scrollTop: number, railTop: number, viewTop: number, navHeight: number): number {
  return Math.max(0, scrollTop + (railTop - viewTop) - navHeight);
}

function pinMaxRowCamera(card: HTMLElement): void {
  const hub = card.closest<HTMLElement>('.max-hub');
  const rail = card.closest<HTMLElement>('.rail');
  if (hub === null || rail === null) return;
  const nav = hub.querySelector<HTMLElement>('.max-nav');
  const view = hub.getBoundingClientRect();
  const box = rail.getBoundingClientRect();
  const navHeight = nav?.getBoundingClientRect().height ?? 66;
  const target = maxRowCameraTop(hub.scrollTop, box.top, view.top, navHeight);
  if (shouldNudgePageY(hub.scrollTop, target)) scrollAxis(hub, 'y', target);
}

/** Films start TVM Stream; series open details first (same contract as openPlayback). */
export function activateMaxTitle(
  title: Title,
  playFn: (title: Title) => void,
  openFn: (title: Title) => void,
): 'player' | 'details' {
  if (title.kind === 'series') {
    openFn(title);
    return 'details';
  }
  playFn(title);
  return 'player';
}

export function maxNavIds(): string[] {
  return ['service-back', ...MAX_TABS.map((tab) => `service-tab-${tab.id}`), 'service-search'];
}

export function maxActionIds(): string[] {
  return ['service-play', 'service-info'];
}

export function laneFromCategory(value: string | undefined): Lane | undefined {
  if (value === 'home' || value === 'shows' || value === 'movies' || value === 'list' || value === 'new' || value === 'kids') {
    return value;
  }
  if (value === 'series' || value === 'tv') return 'shows';
  if (value === 'sports' || value === 'originals') return 'new';
  if (value === 'mystuff' || value === 'my-stuff' || value === 'mylist' || value === 'my-list') return 'list';
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

export function isSportsTitle(title: Title): boolean {
  return SPORTS_RE.test(`${title.title} ${title.genres.join(' ')} ${title.network ?? ''}`);
}

export function maxTitleMatches(title: Title, lane: Lane): boolean {
  if (lane === 'home' || lane === 'list') return true;
  if (lane === 'shows') return title.kind === 'series';
  if (lane === 'movies') return title.kind === 'movie';
  if (lane === 'kids') return title.genres.some((genre) => /family|animation|kids|children/i.test(genre));
  if (lane === 'new') {
    if (isSportsTitle(title)) return true;
    return title.genres.some((genre) => /action|documentary|adventure|sports/i.test(genre)) || title.year >= 2020;
  }
  return true;
}

export function maxFallbackHub(): AppHubPayload {
  const movies = TITLES.filter((title) => title.kind === 'movie');
  const shows = TITLES.filter((title) => title.kind === 'series');
  const lead = TITLES[0];
  return {
    id: 'max',
    name: 'Max',
    accent: '#002be7',
    layout: 'max',
    wordmark: 'max',
    logo: '',
    disclaimer: 'Not the licensed Max app. Playback uses TVM Stream / Real-Debrid.',
    hero: lead === undefined ? null : toMediaItem(lead),
    continueWatching: [],
    rails: [
      { id: 'max-series', title: 'Max originals', items: shows.slice(0, 16).map(toMediaItem) },
      { id: 'max-films', title: 'Popular films', items: movies.slice(0, 16).map(toMediaItem) },
      { id: 'max-shows', title: 'Popular series', items: shows.slice(0, 16).map(toMediaItem) },
    ],
  };
}

export function collectMaxTitles(hub: AppHubPayload, extras: readonly Title[]): Title[] {
  const fromHub = [
    ...(hub.hero !== null && hub.hero !== undefined ? [toHubTitle(hub.hero)] : []),
    ...hub.continueWatching.map(toHubTitle),
    ...hub.rails.flatMap((rail) => rail.items.map(toHubTitle)),
  ];
  return uniqueTitles([...fromHub, ...extras, ...TITLES]);
}

export type MaxRail = { id: string; title: string; titles: Title[] };

export function buildMaxRails(hub: AppHubPayload, lane: Lane, extras: readonly Title[]): MaxRail[] {
  const pool = collectMaxTitles(hub, extras);
  if (lane === 'list') {
    const saved = extras.filter((title) => maxTitleMatches(title, 'list'));
    const titles = saved.length > 0 ? saved : pool.slice(0, 18);
    return [{ id: 'max-mystuff', title: 'My Stuff', titles: titles.length > 0 ? titles : pool }];
  }

  const watching = hub.continueWatching.map(toHubTitle).filter((title) => maxTitleMatches(title, lane === 'shows' ? 'shows' : 'home'));
  const rails: MaxRail[] = [];

  if (watching.length > 0 && lane !== 'movies') {
    rails.push({ id: 'max-continue', title: 'Continue Watching', titles: watching });
  }

  if (lane === 'new') {
    const sports = uniqueTitles([...pool.filter(isSportsTitle), ...TITLES.filter(isSportsTitle)]);
    const more = pool.filter((title) => maxTitleMatches(title, 'new') && !isSportsTitle(title));
    if (sports.length > 0) rails.push({ id: 'max-sports', title: 'Live & Sports', titles: sports });
    if (more.length > 0) rails.push({ id: 'max-ringside', title: 'Action & Ringside', titles: more });
  } else {
    for (const rail of hub.rails) {
      const titles = rail.items.map(toHubTitle).filter((title) => maxTitleMatches(title, lane));
      if (titles.length === 0) continue;
      rails.push({ id: rail.id, title: rail.title, titles });
    }
    if (lane === 'home') {
      const originals = pool.filter((title) => title.kind === 'series').slice(0, 16);
      if (originals.length > 0 && !rails.some((rail) => /original/i.test(rail.title))) {
        rails.unshift({ id: 'max-exclusive', title: 'Max Originals', titles: originals });
      }
    }
  }

  if (rails.length > 0) return rails;
  const fallback = pool.filter((title) => maxTitleMatches(title, lane));
  return [{ id: 'max-browse', title: lane === 'new' ? 'Sports' : 'Browse Max', titles: fallback.length > 0 ? fallback : pool }];
}

export function maxHeroKicker(title: Title): string {
  if (isSportsTitle(title)) return 'Sports';
  if (title.kind === 'series') return 'HBO Original';
  return 'Max Original';
}

export function maxPlayLabel(title: Title): string {
  return title.progress !== undefined ? 'Resume' : playLabel('max');
}

export function maxMoreLabel(title: Title): string {
  return title.kind === 'series' ? moreLabel('max') : 'More Info';
}

export function maxRuntime(title: Title): string {
  if (title.episodeLabel !== undefined && title.episodeLabel !== '') return title.episodeLabel;
  if (title.kind === 'series') {
    if (title.seasons === 1) return '1 Season';
    if (title.seasons !== undefined && title.seasons > 0) return `${title.seasons} Seasons`;
    return 'Series';
  }
  return title.runtime ?? '';
}

function MaxWordmark(): React.JSX.Element {
  return (
    <svg className="max-mark" viewBox="0 0 156 40" role="img" aria-label="Max">
      <title>Max</title>
      <path
        d="M5 32 V8.4 L24.8 28.6 44.6 8.4 V32"
        fill="none"
        stroke="currentColor"
        strokeWidth="5.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="80.5" cy="20.2" r="12.1" fill="none" stroke="currentColor" strokeWidth="5.2" />
      <circle cx="80.5" cy="20.2" r="4.05" fill="currentColor" />
      <path d="M108.4 8.6 147.2 31.6M147.2 8.6 108.4 31.6" fill="none" stroke="currentColor" strokeWidth="5.2" strokeLinecap="round" />
    </svg>
  );
}

function MaxSpark(): React.JSX.Element {
  return (
    <svg className="max-hero__spark" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.1" fill="none" stroke="currentColor" strokeWidth="2.1" />
      <circle cx="10" cy="10" r="2.55" fill="currentColor" />
    </svg>
  );
}

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

const MaxCard = memo(function MaxCard({
  title,
  prefix,
  index,
  total,
  firstId,
  lastId,
  loopCopy = 1,
  onActivate,
}: {
  title: Title;
  prefix: string;
  index: number;
  total: number;
  firstId: string;
  lastId: string;
  loopCopy?: number;
  onActivate: (title: Title) => void;
}): React.JSX.Element {
  const scope = useFocusScope();
  const clone = loopCopy !== 1;
  const id = maxCardId(prefix, title.id, loopCopy);
  const focusKey = useScopedFocusKey(id);
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
      if (node === null) return;
      revealFocused(node);
      requestAnimationFrame(() => pinMaxRowCamera(node));
    },
  });
  const watching = title.progress !== undefined;
  return (
    <button
      ref={ref}
      type="button"
      className={`max-card${watching ? ' max-card--watching' : ''}`}
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      data-loop-clone={clone ? 'true' : undefined}
      data-loop-copy={String(loopCopy)}
      aria-hidden={clone || undefined}
      onClick={() => {
        if (!clone) onActivate(title);
      }}
    >
      <span className="max-card__frame">
        <Artwork title={title} kind="backdrop" className="max-card__art" decorative={clone} />
        {watching && (
          <span className="max-card__progress" aria-hidden="true">
            <span className="max-card__bar" style={{ width: `${Math.round((title.progress ?? 0) * 100)}%` }} />
          </span>
        )}
      </span>
      <span className="max-card__meta">
        <span className="max-card__name">{title.title}</span>
        <span className="max-card__year">{title.episodeLabel ?? (title.year > 0 ? String(title.year) : '')}</span>
      </span>
    </button>
  );
});

function mapCards(titles: readonly Title[], prefix: string, onActivate: (title: Title) => void): React.JSX.Element[] {
  const ids = maxCardIds(prefix, titles);
  const firstId = ids[0] ?? '';
  const lastId = ids[ids.length - 1] ?? '';
  return titles.map((title, index) => (
    <MaxCard
      key={`${prefix}-${title.id}`}
      title={title}
      prefix={prefix}
      index={index}
      total={titles.length}
      firstId={firstId}
      lastId={lastId}
      onActivate={onActivate}
    />
  ));
}

export function MaxHub(props: ServiceHubProps): React.JSX.Element {
  const navigate = useNavigate();
  const scope = useFocusScope();
  const appId = props.appId ?? props.hub?.id ?? 'max';
  const incoming = laneFromCategory(props.lane ?? props.category);
  const [lane, setLane] = useState<Lane>(incoming ?? 'home');
  const [loaded, setLoaded] = useState<AppHubPayload | null>(props.hub ?? (isHubPayload(props.catalog) ? props.catalog : null));
  const [failed, setFailed] = useState(false);
  const [watchlist, setWatchlist] = useState<Title[]>([]);

  useEffect(() => {
    if (incoming !== undefined && incoming !== lane) setLane(incoming);
  }, [incoming, lane]);

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
    const base = loaded ?? (failed ? maxFallbackHub() : null);
    if (base === null) return null;
    const catalog = props.catalog;
    const extraRails = props.rails ?? catalogRails(catalog);
    if (extraRails === undefined || extraRails.length === 0) return base;
    return { ...base, rails: extraRails.length > 0 ? extraRails : base.rails };
  }, [failed, loaded, props.catalog, props.rails]);

  const extras = useMemo(() => {
    const fromItems = (props.items ?? []).map(toHubTitle);
    const fromCatalog = catalogItems(props.catalog).map(toHubTitle);
    return uniqueTitles([...fromItems, ...fromCatalog, ...watchlist]);
  }, [props.catalog, props.items, watchlist]);

  const rails = useMemo(() => (hub === null ? [] : buildMaxRails(hub, lane, extras)), [extras, hub, lane]);
  const heroSeed = hub?.hero !== null && hub?.hero !== undefined ? toHubTitle(hub.hero) : undefined;
  const hero = (lane === 'home' ? heroSeed : rails[0]?.titles[0]) ?? rails[0]?.titles[0] ?? heroSeed;

  const nav = props.navigate ?? navigate;
  const goBack = (): void => {
    if (props.onBack !== undefined) props.onBack();
    else nav.home();
  };
  const playTitle = useCallback(
    (title: Title): void => {
      if (props.onPlay !== undefined) props.onPlay(title);
      else if (props.play !== undefined) props.play(title);
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
  const activateCard = useCallback(
    (title: Title): void => {
      activateMaxTitle(title, playTitle, openTitle);
    },
    [openTitle, playTitle],
  );
  const changeLane = (next: Lane): void => {
    setLane(next);
    props.onLane?.(next);
    window.setTimeout(() => requestFocus(`${scope}/service-tab-${next}`), 0);
  };

  if (hub === null) {
    return (
      <main className="service service--max max-hub">
        <FocusButton id="service-back" className="max-back" onSelect={goBack}>
          Back
        </FocusButton>
        <Skeleton className="service-skeleton" label="Loading Max" />
      </main>
    );
  }

  if (failed && rails.length === 0) {
    return (
      <main className="page page--library max-hub">
        <EmptyState
          title="Max could not load"
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

  const navIds = maxNavIds();
  const actionIds = maxActionIds();
  const cert = hero === undefined ? null : certificateLabel(hero.rating);
  const run = hero === undefined ? '' : maxRuntime(hero);
  const heroSrc = hero === undefined ? '' : preferBackdrop(hero.id, hero.backdrop, hero.poster);

  return (
    <main className="service service--max max-hub" aria-label="Max">
      <nav className="max-nav" aria-label="Max" data-wrap="true">
        <FocusButton id="service-back" className="max-back" onSelect={goBack} onArrowPress={bindWrap(scope, 0, navIds)}>
          Back
        </FocusButton>
        <div className="max-nav__brand">
          <MaxWordmark />
        </div>
        <div className="max-nav__tabs">
          {MAX_TABS.map((tab, index) => (
            <FocusButton
              key={tab.id}
              id={`service-tab-${tab.id}`}
              className={`max-tab${lane === tab.id ? ' max-tab--on' : ''}`}
              onSelect={() => changeLane(tab.id)}
              onArrowPress={bindWrap(scope, index + 1, navIds)}
            >
              {tab.label}
            </FocusButton>
          ))}
        </div>
        <FocusButton
          id="service-search"
          className="max-search"
          onSelect={() => nav.pushModal('search')}
          onArrowPress={bindWrap(scope, navIds.length - 1, navIds)}
        >
          <IconSearch className="max-search__icon" />
          Search
        </FocusButton>
      </nav>

      {lane === 'list' && (
        <header className="max-listhead">
          <p className="max-listhead__kicker">My Stuff</p>
          <h1 className="max-listhead__title">Keep watching</h1>
        </header>
      )}

      {lane !== 'list' && hero !== undefined && (
        <section className="max-hero">
          <HeroArt src={heroSrc} hue={hero.hue} />
          <div className="max-hero__veil" aria-hidden="true" />
          <div className="max-hero__copy">
            <p className="max-hero__kicker">
              <MaxSpark />
              {maxHeroKicker(hero)}
            </p>
            <h1 className="max-hero__title">{hero.title}</h1>
            <p className="max-hero__meta">
              {hero.year > 0 && <span>{hero.year}</span>}
              {cert !== null && <span className="max-hero__cert">{cert}</span>}
              {run !== '' && <span>{run}</span>}
              {hero.genres[0] !== undefined && <span>{hero.genres[0]}</span>}
              <span className="max-hero__badge">HD</span>
            </p>
            {hero.synopsis !== '' && <p className="max-hero__syn">{hero.synopsis}</p>}
            <div className="max-hero__actions" data-wrap="true">
              <FocusButton
                id="service-play"
                variant="primary"
                className="max-play"
                onSelect={() => playTitle(hero)}
                onArrowPress={bindWrap(scope, 0, actionIds)}
              >
                <IconPlay className="max-play__icon" />
                {maxPlayLabel(hero)}
              </FocusButton>
              <FocusButton
                id="service-info"
                className="max-more"
                onSelect={() => openTitle(hero)}
                onArrowPress={bindWrap(scope, 1, actionIds)}
              >
                {maxMoreLabel(hero)}
              </FocusButton>
            </div>
          </div>
        </section>
      )}

      <div className={`max-rails${lane === 'list' ? ' max-rails--list' : ''}`}>
        {rails.map((rail) => (
          <Rail key={rail.id} title={rail.title} id={rail.id}>
            {mapCards(rail.titles, rail.id, activateCard)}
          </Rail>
        ))}
      </div>
      <p className="max-note">{hub.disclaimer}</p>
    </main>
  );
}
