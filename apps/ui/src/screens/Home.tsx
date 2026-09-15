import { AnimeControls } from '../theme/anime/AnimeControls';
import { useAnimeScene } from '../theme/anime/catalog';
import { useThemeId } from '../theme/useThemeId';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorState } from '../components/ErrorState';
import { FocusButton } from '../components/FocusButton';
import { mapRailPosters } from '../components/PosterCard';
import { Rail } from '../components/Rail';
import { Ribbon } from '../components/Ribbon';
import { RailSkeletons } from '../components/Skeleton';
import { BrandLockup } from '../components/BrandLockup';
import { IconApps, IconLive, IconStream, IconWatchlist } from '../components/Icons';
import { HeroArt } from '../components/HeroArt';
import { PageScene } from '../components/PageScene';
import { preferBackdrop } from '../data/artwork';
import { asTitle, fetchHome, peekHome, type CatalogRail } from '../data/media';
import { applyPlanClass, fetchPlan } from '../data/plan';
import { enterTvmStream } from '../data/profiles';
import { launchTitle } from '../data/launchTitle';
import { type Title } from '../data/catalog';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import { heroScrollFade } from './heroFade';
import { prefersReducedMotion } from '../theme/motion';

const CLOCK_TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const CLOCK_DATE = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/** Launcher clock. Ticks once a minute; nothing else on Home re-renders for it. */
function HomeClock(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = (): void => setNow(new Date());
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <p className="home__clock" aria-live="off">
      <span className="home__clock-time">{CLOCK_TIME.format(now)}</span>
      <span className="home__clock-date">{CLOCK_DATE.format(now)}</span>
    </p>
  );
}

/** Rails on Home are TVM Stream's; say so on every shelf so Home never reads as TVM Stream. */
function shelfTitle(title: string): string {
  return `TVM Stream · ${title}`;
}

const HomeShelves = memo(function HomeShelves({
  watching,
  watchlist,
  catalogRails,
  loading,
  openTitle,
}: {
  watching: Title[];
  watchlist: Title[];
  catalogRails: Array<{ id: string; title: string; titles: Title[] }>;
  loading: boolean;
  openTitle: (title: Title) => void;
}): React.JSX.Element {
  const theme = useThemeId();
  const scene = useAnimeScene();
  const [swapped, setSwapped] = useState(false);
  useEffect(() => {
    if (theme !== 'anime' || scene.id !== 'todo-yuji') return;
    const timer = setInterval(() => {
      if (document.hidden || prefersReducedMotion() || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const shelf = document.querySelector('[data-anime-brothers]');
      if (!shelf || shelf.querySelector('[data-focused="true"], :focus') || document.querySelector('[data-screen="player"]')) return;
      setSwapped(value => !value);
    }, 12000);
    return () => clearInterval(timer);
  }, [theme, scene.id]);
  const brothers = catalogRails.filter(rail => rail.id !== 'anime-adapted').flatMap(rail => rail.titles).slice(0, 2);
  const watchingLabel = theme === 'anime' && scene.id === 'night-train' ? 'Next station · continue watching' : theme === 'anime' && scene.id === 'straw-hat-map' ? 'Your next voyage' : 'Continue watching';
  return (
    <div className="home__shelf">
      {theme === 'anime' && scene.id === 'todo-yuji' && brothers.length === 2 && <div data-anime-brothers=""><Rail title="Brothers in arms · two stories, one evening">{mapRailPosters(swapped ? [...brothers].reverse() : brothers, 'anime-brothers', openTitle)}</Rail></div>}
      {watching.length > 0 && (
        <Rail title={shelfTitle(watchingLabel)}>{mapRailPosters(watching, 'continue', openTitle)}</Rail>
      )}

      {watchlist.length > 0 && (
        <Rail title={shelfTitle(theme === 'anime' && scene.id === 'wanted-posters' ? 'Bounties · your saved stories' : 'Watchlist')}>{mapRailPosters(watchlist, 'watchlist', openTitle)}</Rail>
      )}

      {catalogRails.length > 0 ? (
        catalogRails.map((rail) => (
          <Rail key={rail.id} title={shelfTitle(rail.title)}>
            {mapRailPosters(rail.titles, rail.id, openTitle)}
          </Rail>
        ))
      ) : loading ? (
        <Rail bare id="for-you-1">
          <RailSkeletons count={8} label="Loading TVM Stream" />
        </Rail>
      ) : null}
    </div>
  );
});

export function Home(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const theme = useThemeId();
  const animeScene = useAnimeScene();
  const pageRef = useRef<HTMLElement>(null);
  const cached = peekHome();
  const [loading, setLoading] = useState(cached === null);
  const [failed, setFailed] = useState(false);
  const [watching, setWatching] = useState<Title[]>(() => (cached?.continueWatching ?? []).map(asTitle));
  const [watchlist, setWatchlist] = useState<Title[]>(() => (cached?.watchlist ?? []).map(asTitle));
  const [rails, setRails] = useState<CatalogRail[]>(cached?.rails ?? []);
  const [featured, setFeatured] = useState<Title | null>(() =>
    cached?.featured !== null && cached?.featured !== undefined ? asTitle(cached.featured) : null,
  );
  const [slide, setSlide] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void fetchPlan().then((status) => {
      applyPlanClass(status);
    });
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
    return merged.filter((title) => {
      if (seen.has(title.id) || seen.has(title.title)) return false;
      seen.add(title.id);
      seen.add(title.title);
      return true;
    }).slice(0, 4);
  }, [featured, rails, watching]);

  const displayHero = heroes[slide % Math.max(heroes.length, 1)];
  const catalogRails = useMemo(
    () => rails.filter(rail => rail.id !== 'anime-adapted' || (theme === 'anime' && animeScene.id === 'mahoraga')).map((rail) => ({ ...rail, titles: rail.items.map(asTitle) })).filter((rail) => rail.titles.length > 0),
    [rails, theme, animeScene.id],
  );

  useEffect(() => {
    if (heroes.length < 2) return;
    const timer = window.setInterval(() => {
      if (document.hidden || prefersReducedMotion()) return;
      const page = pageRef.current;
      if (page === null || page.scrollTop > page.clientHeight * 0.35) return;
      const activeScreen = document.activeElement?.closest('[data-screen]');
      if (activeScreen !== null && activeScreen !== undefined && activeScreen.getAttribute('data-screen') !== 'home') return;
      setSlide((value) => (value + 1) % heroes.length);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [heroes.length]);

  useEffect(() => {
    const page = pageRef.current;
    if (page === null) return;
    const stage = page.querySelector<HTMLElement>('.stage');
    if (stage === null) return;
    let raf = 0;
    const apply = (): void => {
      raf = 0;
      stage.style.setProperty('--hero-fade', String(heroScrollFade(page.scrollTop, stage.offsetHeight)));
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
      void launchTitle(navigate, title);
    },
    [navigate],
  );

  const launcher = (
    <div className="home__destinations">
      <p className="home__launcher-kicker">Where to</p>
      <nav className="home__launcher" aria-label="Where to">
        <FocusButton id="launch-stream" className="launch-tile launch-tile--stream" onSelect={openStream}>
          <span className="launch-tile__mark launch-tile__mark--stream">
            <IconStream className="launch-tile__glyph" />
          </span>
          <strong>TVM Stream</strong>
          <span>Films and series</span>
        </FocusButton>
        <FocusButton id="launch-live" className="launch-tile" onSelect={() => navigate.push('live')}>
          <span className="launch-tile__mark launch-tile__mark--live">
            <IconLive className="launch-tile__glyph" />
          </span>
          <strong>Live TV</strong>
          <span>Channels and guide</span>
        </FocusButton>
        <FocusButton id="launch-watchlist" className="launch-tile" onSelect={() => navigate.push('watchlist')}>
          <span className="launch-tile__mark launch-tile__mark--list">
            <IconWatchlist className="launch-tile__glyph" />
          </span>
          <strong>Watchlist</strong>
          <span>Saved for later</span>
        </FocusButton>
        <FocusButton id="launch-apps" className="launch-tile" onSelect={() => navigate.push('apps')}>
          <span className="launch-tile__mark launch-tile__mark--apps">
            <IconApps className="launch-tile__glyph" />
          </span>
          <strong>Apps</strong>
          <span>Studios and services</span>
        </FocusButton>
      </nav>
    </div>
  );

  if (failed && loading === false && displayHero === undefined && catalogRails.length === 0) {
    return (
      <main className="home home--launcher" ref={pageRef}>
        <PageScene />
        <Ribbon active="home" />
        <section className="stage stage--home">
          <HomeClock />
          <div className="stage__copy">
            <p className="stage__kicker home__kicker">
              <span className="home__kicker-home">Home</span>
            </p>
            <h1 className="stage__title">Welcome</h1>
          </div>
        </section>
        <AnimeControls />
        {launcher}
        <div className="home__shelf">
          <ErrorState
            title="Home could not load"
            body="TVM could not reach the local core. Check that the app is running, then retry."
            onRetry={() => {
              setLoading(true);
              setFailed(false);
              setTick((value) => value + 1);
            }}
          />
        </div>
      </main>
    );
  }

  const hero = displayHero;
  const heroSrc = hero === undefined ? '' : preferBackdrop(hero.id, hero.backdrop, hero.poster);

  return (
    <main className="home home--launcher" ref={pageRef}>
      <PageScene />
      <Ribbon active="home" />
      <section className="stage stage--home">
        {hero !== undefined ? (
          <HeroArt src={heroSrc} hue={hero.hue} />
        ) : loading ? (
          <div className="stage__pictures" aria-hidden="true">
            <div className="stage__art stage__art--pending art--pending">
              <span className="skeleton skeleton--art" />
            </div>
          </div>
        ) : null}
        <div className="stage__vignette" aria-hidden="true" />
        <HomeClock />
        <div className="stage__copy">
          <p className="stage__kicker home__kicker">
            <span className="home__kicker-home">Home</span>
            {hero !== undefined ? <span className="home__kicker-source">Featured on TVM Stream</span> : null}
          </p>
          {hero !== undefined ? (
            <h1 className={`stage__title${hero.wordmark === 'ember' ? ' stage__title--ember' : ''}`}>{hero.title}</h1>
          ) : (
            <h1 className="stage__title">Welcome</h1>
          )}
          <p className="stage__watchline">
            <FocusButton
              id="hero-play"
              className="stage__watchnow"
              onSelect={() => (hero !== undefined ? openTitle(hero) : openStream())}
            >
              {hero !== undefined ? 'Watch' : 'TVM Stream'}
            </FocusButton>
            <span className="stage__watchline-rule" aria-hidden="true">
              |
            </span>
            <BrandLockup focusId="hero-mark" />
          </p>
          <FocusButton id="hero-info" className="tvm-button--glass stage__learn" onSelect={openStream}>
            Browse TVM Stream
          </FocusButton>
          {heroes.length > 1 && (
            <div className="stage__dots" aria-hidden="true">
              {heroes.map((item, index) => (
                <span key={item.id} className={`stage__dot${index === slide ? ' stage__dot--on' : ''}`} />
              ))}
            </div>
          )}
        </div>
      </section>

      <AnimeControls />
      {launcher}

      <HomeShelves
        watching={watching}
        watchlist={watchlist}
        catalogRails={catalogRails}
        loading={loading}
        openTitle={openTitle}
      />
    </main>
  );
}
