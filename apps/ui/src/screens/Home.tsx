import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openModals, visibleScreen } from '@tvm/nav';
import { ErrorState } from '../components/ErrorState';
import { FocusButton } from '../components/FocusButton';
import { mapRailPosters } from '../components/PosterCard';
import { Rail, RailPaging } from '../components/Rail';
import { Ribbon } from '../components/Ribbon';
import { RailSkeletons } from '../components/Skeleton';
import { ART_REFERRER } from '../components/artFace';
import { BrowseAmbience } from '../components/BrowseAmbience';
import { preferBackdrop } from '../data/artwork';
import {
  fetchExtrasUpcomingHome,
  formatEpisodeCode,
  formatUpcomingShort,
  type ExtrasUpcomingHomeItem,
} from '../data/extras';
import { apiFetch, asTitle, fetchHome, peekHome, toMediaItem, type CatalogRail, type MediaItem } from '../data/media';
import { filterItemsByAge } from '../data/parental';
import { PREFS_CHANGED_EVENT, readPrefs } from '../data/prefs';
import { effectiveProfileMaxAge, fetchProfiles, peekActiveProfile, subscribeProfiles } from '../data/profiles';
import { fetchActiveEvents, type ActiveEvent } from '../data/events';
import { usePagedRails } from '../data/usePagedRails';
import { requestFocus } from '../nav/focusEngine';
import { focusKeyFor } from '../nav/railNav';
import { applyPlanClass, fetchPlan } from '../data/plan';
import { enterTvmStream } from '../data/profiles';
import { launchTitle } from '../data/launchTitle';
import { type Title } from '../data/catalog';
import { useNavigate, useViewStack } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import { heroScrollFade } from './heroFade';
import { Spotlight } from './Spotlight';
import { extraEnabled } from '../data/polishPrefs';
import { currentAppVersion } from '../data/changelog';
import { updateRequired, useReleaseConfig } from '../data/releaseConfig';
import { openDetails, openPlayback } from '../data/openDetails';
import { prefersReducedMotion, subscribeMotionPreference } from '../theme/motion';

type Shelf = { id: string; title: string; more?: boolean; titles: Title[]; loop?: boolean; numbered?: boolean };
const HomeShelves = memo(function HomeShelves({ shelves, loading, openTitle, onLoadMore }: {
  shelves: Shelf[]; loading: boolean; openTitle: (title: Title) => void; onLoadMore: (id: string) => void;
}): React.JSX.Element {
  return <div className="home__shelf">
    {shelves.map((rail) => <RailPaging key={rail.id} railId={rail.id} hasMore={rail.more === true} onNearEnd={() => onLoadMore(rail.id)}>
      <Rail title={rail.title} loop={rail.loop} className={rail.numbered ? 'rail--numbered' : undefined}>
        {mapRailPosters(rail.titles, rail.id, openTitle, ['continue', 'featured'].includes(rail.id) ? { layout: 'landscape' } : undefined)}
      </Rail>
    </RailPaging>)}
    {loading && !shelves.length && <Rail bare id="for-you-1"><RailSkeletons count={8} label="Loading TVM Stream" /></Rail>}
  </div>;
});

export function Home(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const stack = useViewStack();
  const homeActive = visibleScreen(stack).name === 'home' && openModals(stack).length === 0;
  const pageRef = useRef<HTMLElement>(null);
  const cached = peekHome();
  const [loading, setLoading] = useState(cached === null);
  const [failed, setFailed] = useState(false);
  const [watching, setWatching] = useState<Title[]>(() => (cached?.continueWatching ?? []).map(asTitle));
  const [watchlist, setWatchlist] = useState<Title[]>(() => (cached?.watchlist ?? []).map(asTitle));
  const [rails, setRails] = useState<CatalogRail[]>(cached?.rails ?? []);
  const [activeEvents, setActiveEvents] = useState<ActiveEvent[]>([]);
  const [upcomingHome, setUpcomingHome] = useState<ExtrasUpcomingHomeItem[]>([]);
  const [maxAge, setMaxAge] = useState(() => effectiveProfileMaxAge(peekActiveProfile()));
  const { rails: pagedRails, loadMore: loadMoreRail } = usePagedRails(rails);
  const [featured, setFeatured] = useState<Title | null>(() =>
    cached?.featured !== null && cached?.featured !== undefined ? asTitle(cached.featured) : null,
  );
  const [slide, setSlide] = useState(0);
  const [tick, setTick] = useState(0);
  const [prefs, setPrefs] = useState(readPrefs);
  const config = useReleaseConfig();
  const [surprise, setSurprise] = useState<MediaItem | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => prefersReducedMotion());
  const [heroScrolledOut, setHeroScrolledOut] = useState(false);
  const [docHidden, setDocHidden] = useState(() => (typeof document !== 'undefined' ? document.hidden : false));

  useEffect(() => {
    void fetchPlan().then((status) => {
      applyPlanClass(status);
    });
    void fetchProfiles().then(() => setMaxAge(effectiveProfileMaxAge(peekActiveProfile())));
    const unsubProfiles = subscribeProfiles(() => {
      setMaxAge(effectiveProfileMaxAge(peekActiveProfile()));
      void fetchExtrasUpcomingHome().then((items) => {
        if (items !== null) setUpcomingHome(items);
      });
    });
    const unsubMotion = subscribeMotionPreference(() => setReducedMotion(prefersReducedMotion()));
    const onPrefs = (): void => setPrefs(readPrefs());
    const onVisibility = (): void => setDocHidden(document.hidden);
    window.addEventListener(PREFS_CHANGED_EVENT, onPrefs);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubProfiles();
      unsubMotion();
      window.removeEventListener(PREFS_CHANGED_EVENT, onPrefs);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async (silent: boolean): Promise<void> => {
      const payload = await fetchHome();
      if (cancelled) return;
      if (payload === null) {
        if (!silent) {
          setFailed(true);
          setLoading(false);
        }
        return;
      }
      setFailed(false);
      setWatchlist((payload.watchlist ?? []).map(asTitle));
      setWatching((payload.continueWatching ?? []).map(asTitle));
      setRails(payload.rails ?? []);
      setFeatured(payload.featured !== null && payload.featured !== undefined ? asTitle(payload.featured) : null);
      setLoading(false);
    };

    void load(peekHome() !== null);
    void fetchActiveEvents().then((events) => {
      if (!cancelled) setActiveEvents(events);
    });
    void fetchExtrasUpcomingHome().then((items) => {
      if (!cancelled && items !== null) setUpcomingHome(items);
    });
    const timer = window.setInterval(() => void load(true), 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [navigate, tick]);

  const heroes = useMemo(() => {
    const fromRails = rails.filter(rail => rail.id !== 'anime-adapted').flatMap((rail) => rail.items.map(asTitle)).filter((title) => title.backdrop !== '');
    const merged = [...(featured !== null ? [featured] : []), ...watching, ...fromRails];
    const seen = new Set<string>();
    const allowed = new Set(filterItemsByAge(merged.map(toMediaItem), maxAge).map((item) => item.id));
    return merged.filter((title) => {
      if (!allowed.has(title.id)) return false;
      if (seen.has(title.id) || seen.has(title.title)) return false;
      seen.add(title.id);
      seen.add(title.title);
      return true;
    }).slice(0, 4);
  }, [featured, maxAge, rails, watching]);

  const displayHero = heroes[slide % Math.max(heroes.length, 1)];
  const catalogRails = useMemo(
    () =>
      pagedRails
        .filter((rail) => rail.id !== 'anime-adapted')
        .map((rail) => ({ ...rail, titles: filterItemsByAge(rail.items, maxAge).map(asTitle) }))
        .filter((rail) => rail.titles.length > 0),
    [maxAge, pagedRails],
  );

  /*
   * Warm the backdrops the rotation is going to ask for.
   *
   * The slide index drives the title and the picture together, but only the
   * title is already in memory: the picture has to be fetched and decoded
   * before it can start its dissolve. So the hero showed one film's name over
   * another film's artwork for the better part of a second, every eight
   * seconds — the single most visible thing on the first screen, and it looked
   * like a bug because it is one.
   *
   * Fetching them after first paint costs nothing that was not going to be
   * spent within the next half minute anyway, and it is deliberately late so
   * it cannot compete with the picture actually on screen.
   */
  useEffect(() => {
    if (heroes.length < 2) return;
    const timer = window.setTimeout(() => {
      for (const item of heroes) {
        const src = preferBackdrop(item.id, item.backdrop, item.poster, true);
        if (src === '') continue;
        const warm = new Image();
        warm.decoding = 'async';
        warm.referrerPolicy = ART_REFERRER;
        warm.src = src;
      }
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [heroes]);

  /*
   * Manual stepping. The Android app's touch layer turns a sideways swipe on
   * the hero into a `tvm:hero-step` event (detail +1 / -1; 0 when a swipe
   * starts). Each one restarts the rotation timer below, so the banner never
   * changes under a finger and waits a full interval after a swipe. Nothing
   * else sends it.
   */
  useEffect(() => {
    if (heroes.length < 2) return;
    const step = (event: Event): void => {
      const by = Number((event as CustomEvent<number>).detail) || 0;
      if (by !== 0) setSlide((value) => (((value + by) % heroes.length) + heroes.length) % heroes.length);
    };
    window.addEventListener('tvm:hero-step', step);
    return () => window.removeEventListener('tvm:hero-step', step);
  }, [heroes.length]);

  useEffect(() => {
    const page = pageRef.current;
    if (page === null) return;
    const stage = page.querySelector<HTMLElement>('.stage');
    if (stage === null) return;
    let raf = 0;
    const apply = (): void => {
      raf = 0;
      const height = stage.offsetHeight;
      // Once the hero is fully past the top its look cannot change; stop restyling it on every scroll frame.
      const pastHero = height > 0 && page.scrollTop >= height;
      if (!pastHero || stage.style.getPropertyValue('--spotlight-scroll') !== '1') {
        stage.style.setProperty('--hero-fade', String(heroScrollFade(page.scrollTop, height)));
        stage.style.setProperty('--spotlight-scroll', String(Math.min(1, page.scrollTop / Math.max(1, height))));
      }
      const scrolledOut = height > 0 && page.scrollTop > height * 0.35;
      setHeroScrolledOut((prev) => (prev === scrolledOut ? prev : scrolledOut));
    };
    const onScroll = (): void => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(apply);
    };
    apply();
    page.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      page.removeEventListener('scroll', onScroll);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [loading, failed]);

  const openStream = useCallback((): void => {
    void enterTvmStream(navigate);
  }, [navigate]);

  const openTitle = useCallback(
    (title: Title): void => {
      void launchTitle(navigate, title, true);
    },
    [navigate],
  );

  const liveEvent = prefs.spotlightEvents && maxAge >= 18 ? activeEvents[0] ?? null : null;
  const eventSpotlight = useMemo<Title | undefined>(() => {
    if (liveEvent === null) return undefined;
    const raw = liveEvent.spotlight ?? liveEvent.items.find((item) => item.backdrop !== '') ?? liveEvent.items[0];
    if (raw !== undefined) {
      const converted = asTitle(raw);
      return converted.title !== '' ? converted : { ...converted, title: liveEvent.title };
    }
    return {
      id: liveEvent.imdbId,
      title: liveEvent.title,
      year: 0,
      kind: 'movie',
      synopsis: liveEvent.line,
      poster: '',
      backdrop: '',
      genres: [],
      rating: '',
      hue: 28,
    };
  }, [liveEvent]);

  const eventRail = useMemo(() => {
    if (liveEvent === null) return null;
    const titles = liveEvent.items.map(asTitle).filter((title, index, all) => all.findIndex((item) => item.id === title.id) === index);
    if (titles.length === 0) return null;
    // Story order is finite and numbered, so it does not loop.
    return { id: liveEvent.rail.id, title: liveEvent.rail.title, titles, loop: false, numbered: true };
  }, [liveEvent]);

  const upcomingTitles = useMemo<Title[]>(() => {
    const allowedIds = new Set(filterItemsByAge(upcomingHome.map((entry) => entry.item), maxAge).map((item) => item.id));
    return upcomingHome
      .filter((entry) => allowedIds.has(entry.item.id))
      .map((entry) => {
        const base = asTitle(entry.item);
        const code = formatEpisodeCode(entry.next.season, entry.next.episode);
        const when = formatUpcomingShort(entry.next.airstamp);
        return {
          ...base,
          kind: 'series',
          episodeLabel: when !== null ? `${code} · ${when}` : code,
        };
      });
  }, [maxAge, upcomingHome]);

  const hero = liveEvent !== null ? eventSpotlight : displayHero;
  useEffect(() => {
    setSurprise(null);
    if (!extraEnabled('surpriseMe', prefs) || !homeActive) return;
    const controller = new AbortController();
    void apiFetch('/api/extras/surprise', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const { item } = await response.json() as { item?: MediaItem };
      if (item && !controller.signal.aborted && filterItemsByAge([item], maxAge).length) setSurprise(item);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [prefs, config, maxAge, homeActive]);

  const openEventRail = useCallback((): void => {
    if (liveEvent === null) return;
    const railEl = pageRef.current?.querySelector<HTMLElement>(`[data-rail="${liveEvent.rail.id}"]`);
    if (railEl === null || railEl === undefined) {
      if (eventSpotlight !== undefined) openTitle(eventSpotlight);
      return;
    }
    railEl.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    const firstCard = railEl.querySelector<HTMLElement>('[data-focus-id]:not([data-loop-clone="true"])');
    const key = firstCard !== null ? focusKeyFor(firstCard) : null;
    if (key !== null) requestFocus(key);
  }, [eventSpotlight, liveEvent, openTitle]);

  const featuredTitles = [...new Map([...(featured ? [featured] : []), ...catalogRails.flatMap((rail) => rail.titles)]
    .filter((title) => title.backdrop !== '' && filterItemsByAge([toMediaItem(title)], maxAge).length > 0)
    .map((title) => [title.id, title])).values()].slice(0, 8);
  const shelves: Shelf[] = [
    { id: 'continue', title: 'Continue watching', titles: filterItemsByAge(watching.map(toMediaItem), maxAge).map(asTitle), loop: false },
    { id: 'featured', title: 'Featured', titles: featuredTitles, loop: false },
    ...(eventRail ? [eventRail] : []),
    ...(extraEnabled('comingUp', prefs) ? [{ id: 'upcoming', title: 'New episodes this week', titles: upcomingTitles, loop: false }] : []),
    { id: 'my-list', title: 'My List', titles: filterItemsByAge(watchlist.map(toMediaItem), maxAge).map(asTitle), loop: false },
    ...catalogRails,
  ];
  const sections = new Map(prefs.homeSections.map((section, index) => [section.id, { ...section, index }]));
  const autoOrder = sections.get('automatic');
  const priority = (id: string): number => sections.get(id)?.index ?? (id.startsWith('auto-') ? autoOrder?.index : undefined) ?? 1000;
  const visibleShelves = shelves.filter(({ id, titles }) => titles.length > 0 && sections.get(id)?.visible !== false &&
    (!id.startsWith('auto-') || extraEnabled('autoCollections', prefs) && autoOrder?.visible !== false))
    .sort((a, b) => priority(a.id) - priority(b.id));

  const minUpdateNeeded = updateRequired(currentAppVersion(), config?.minVersion);
  const maintenance = config?.maintenance;

  return (
    <main className="home polish-home cinematic-browse" ref={pageRef}>
      <BrowseAmbience page={pageRef} />
      <Ribbon active="home" />
      <Spotlight hero={hero} event={liveEvent} enabled={prefs.heroPreviews}
        reduced={reducedMotion} active={homeActive && !docHidden && !heroScrolledOut}
        announcement={extraEnabled('announcements', prefs) ? config?.announcement : null}
        rating={extraEnabled('ratings', prefs)}
        onPlay={liveEvent ? openEventRail : () => hero ? openPlayback(navigate, hero) : openStream()}
        onDetails={() => { if (hero) void openDetails(navigate, hero); }}
        onSurprise={surprise ? () => openTitle(asTitle(surprise)) : undefined} />
      {maintenance?.on && (
        <aside className="spotlight__announcement spotlight__announcement--warning" role="status" style={{ marginInline: 'var(--tvm-gutter)', marginBlockEnd: 16 }}>
          <span>{maintenance.message || 'TVM is undergoing maintenance. Playback remains available.'}</span>
        </aside>
      )}
      {minUpdateNeeded && (
        <aside className="spotlight__announcement spotlight__announcement--critical" role="alert" style={{ marginInline: 'var(--tvm-gutter)', marginBlockEnd: 16 }}>
          <span>Update required — a newer TVM build ({config?.minVersion}) is needed to keep playing.</span>
          <FocusButton id="home-update-required" variant="quiet" onSelect={() => navigate.push('updates')}>
            Open updates
          </FocusButton>
        </aside>
      )}
      {failed && !hero && <ErrorState title="Home could not load" body="Check that the local TVM service is running."
        onRetry={() => { setLoading(true); setFailed(false); setTick((value) => value + 1); }} />}
      <HomeShelves shelves={visibleShelves} loading={loading} openTitle={openTitle} onLoadMore={loadMoreRail} />
    </main>
  );
}
