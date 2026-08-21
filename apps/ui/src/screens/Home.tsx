import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorState } from '../components/ErrorState';
import { FocusButton } from '../components/FocusButton';
import { mapRailPosters } from '../components/PosterCard';
import { Rail } from '../components/Rail';
import { Ribbon } from '../components/Ribbon';
import { RailSkeletons } from '../components/Skeleton';
import { BrandLockup } from '../components/BrandLockup';
import { HeroArt } from '../components/HeroArt';
import { PageScene } from '../components/PageScene';
import { preferBackdrop } from '../data/artwork';
import { asTitle, fetchHome, peekHome, type CatalogRail } from '../data/media';
import { applyPlanClass, fetchPlan } from '../data/plan';
import { enterTvmStream } from '../data/profiles';
import { type Title } from '../data/catalog';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import { heroScrollFade } from './heroFade';

const HomeShelves = memo(function HomeShelves({
  watching,
  watchlist,
  catalogRails,
  loading,
  openStream,
}: {
  watching: Title[];
  watchlist: Title[];
  catalogRails: Array<{ id: string; title: string; titles: Title[] }>;
  loading: boolean;
  openStream: () => void;
}): React.JSX.Element {
  return (
    <div className="home__shelf">
      {watching.length > 0 && (
        <Rail title="Continue watching">{mapRailPosters(watching, 'continue', openStream)}</Rail>
      )}

      {watchlist.length > 0 && (
        <Rail title="Watchlist">{mapRailPosters(watchlist, 'watchlist', openStream)}</Rail>
      )}

      {catalogRails.length > 0 ? (
        catalogRails.map((rail) => (
          <Rail key={rail.id} title={rail.title}>
            {mapRailPosters(rail.titles, rail.id, openStream)}
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
    const fromRails = rails.flatMap((rail) => rail.items.map(asTitle)).filter((title) => title.backdrop !== '');
    const merged = [...(featured !== null ? [featured] : []), ...watching, ...fromRails];
    const seen = new Set<string>();
    return merged.filter((title) => {
      if (seen.has(title.id) || seen.has(title.title)) return false;
      seen.add(title.id);
      seen.add(title.title);
      return true;
    }).slice(0, 4);
  }, [featured, rails, watching]);

  const displayHero = heroes[slide];
  const catalogRails = useMemo(
    () => rails.map((rail) => ({ ...rail, titles: rail.items.map(asTitle) })).filter((rail) => rail.titles.length > 0),
    [rails],
  );

  useEffect(() => {
    if (heroes.length < 2) return;
    const timer = window.setInterval(() => {
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

  if (failed && loading === false && displayHero === undefined && catalogRails.length === 0) {
    return (
      <main className="home" ref={pageRef}>
        <PageScene />
        <Ribbon active="home" />
        <section className="stage" />
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
    <main className="home" ref={pageRef}>
      <PageScene />
      <Ribbon active="home" />
      <section className="stage">
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
        <div className="stage__copy">
          {hero !== undefined ? (
            <h1 className={`stage__title${hero.wordmark === 'ember' ? ' stage__title--ember' : ''}`}>{hero.title}</h1>
          ) : (
            <h1 className="stage__title">TVM Stream</h1>
          )}
          <p className="stage__watchline">
            <FocusButton id="hero-play" className="stage__watchnow" onSelect={openStream}>
              TVM Stream
            </FocusButton>
            <span className="stage__watchline-rule" aria-hidden="true">
              |
            </span>
            <BrandLockup focusId="hero-mark" />
          </p>
          <FocusButton id="hero-info" className="tvm-button--glass stage__learn" onSelect={openStream}>
            Browse
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

      <HomeShelves
        watching={watching}
        watchlist={watchlist}
        catalogRails={catalogRails}
        loading={loading}
        openStream={openStream}
      />
    </main>
  );
}
