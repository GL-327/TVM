import { useEffect, useMemo, useState } from 'react';
import { ErrorState } from '../components/ErrorState';
import { FocusButton } from '../components/FocusButton';
import { mapRailPosters } from '../components/PosterCard';
import { Rail } from '../components/Rail';
import { Ribbon } from '../components/Ribbon';
import { Skeleton } from '../components/Skeleton';
import {
  HERO_SLIDE_IDS,
  HOME_ROW_ONE_IDS,
  HOME_ROW_TWO_IDS,
  movies,
  series,
  titlesByIds,
  type Title,
} from '../data/catalog';
import { BrandLockup } from '../components/BrandLockup';
import { HeroArt } from '../components/HeroArt';
import { preferBackdrop } from '../data/artwork';
import { asTitle, fetchHome, peekHome, type CatalogRail } from '../data/media';
import { openDetails } from '../data/openDetails';
import { watchSource } from '../data/services';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function Home(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
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

  const catalogHeroes = titlesByIds(HERO_SLIDE_IDS);
  const heroes = useMemo(() => {
    const fromRails = rails.flatMap((rail) => rail.items.map(asTitle)).filter((title) => title.backdrop !== '');
    const merged = [...(featured !== null ? [featured] : []), ...watching, ...fromRails, ...catalogHeroes];
    const seen = new Set<string>();
    return merged.filter((title) => {
      if (seen.has(title.id) || seen.has(title.title)) return false;
      seen.add(title.id);
      seen.add(title.title);
      return true;
    }).slice(0, 4);
  }, [catalogHeroes, featured, rails, watching]);

  const displayHero = heroes[slide] ?? catalogHeroes[0];
  const rowOne = titlesByIds(HOME_ROW_ONE_IDS);
  const rowTwo = titlesByIds(HOME_ROW_TWO_IDS);
  const catalogRails = rails.map((rail) => ({ ...rail, titles: rail.items.map(asTitle) })).filter((rail) => rail.titles.length > 0);
  const extraFilms = movies().slice(0, 16);
  const extraShows = series().slice(0, 16);

  useEffect(() => {
    if (heroes.length < 2) return;
    const timer = window.setInterval(() => {
      setSlide((value) => (value + 1) % heroes.length);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [heroes.length]);

  const openTitle = (title: Title): void => {
    openDetails(navigate, title);
  };

  if (failed && loading === false && displayHero === undefined) {
    return (
      <main className="home">
        <section className="stage" />
        <Ribbon active="home" />
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
  const source = hero === undefined ? 'TVM' : watchSource(hero, []);
  const heroSrc = hero === undefined ? '' : preferBackdrop(hero.id, hero.backdrop, hero.poster);
  const useLockup = source.toLowerCase() === 'tvm stream' || source === 'TVM';

  return (
    <main className="home">
      <section className="stage">
        {hero !== undefined && <HeroArt src={heroSrc} hue={hero.hue} />}
        <div className="stage__vignette" aria-hidden="true" />
        {hero !== undefined && (
          <div className="stage__copy">
            <h1 className={`stage__title${hero.wordmark === 'ember' ? ' stage__title--ember' : ''}`}>{hero.title}</h1>
            <p className="stage__watchline">
              <FocusButton id="hero-play" className="stage__watchnow" onSelect={() => openTitle(hero)}>
                WATCH NOW
              </FocusButton>
              <span className="stage__watchline-rule" aria-hidden="true">
                |
              </span>
              {useLockup ? <BrandLockup /> : <span className="stage__source">{source}</span>}
            </p>
            <FocusButton id="hero-info" className="tvm-button--glass stage__learn" onSelect={() => openTitle(hero)}>
              Learn More
            </FocusButton>
            {heroes.length > 1 && (
              <div className="stage__dots" aria-hidden="true">
                {heroes.map((item, index) => (
                  <span key={item.id} className={`stage__dot${index === slide ? ' stage__dot--on' : ''}`} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <Ribbon active="home" />

      <div className="home__shelf">
        {watching.length > 0 && (
          <Rail title="Continue watching">{mapRailPosters(watching, 'continue', openTitle)}</Rail>
        )}

        {watchlist.length > 0 && (
          <Rail title="Watchlist">{mapRailPosters(watchlist, 'watchlist', openTitle)}</Rail>
        )}

        {catalogRails.length > 0 ? (
          catalogRails.map((rail) => (
            <Rail key={rail.id} title={rail.title}>
              {mapRailPosters(rail.titles, rail.id, openTitle)}
            </Rail>
          ))
        ) : (
          <>
            <Rail bare id="for-you-1">
              {loading && rowOne.length === 0 ? (
                <>
                  <Skeleton className="skeleton--poster" />
                  <Skeleton className="skeleton--poster" />
                  <Skeleton className="skeleton--poster" />
                </>
              ) : (
                mapRailPosters(rowOne, 'home', openTitle)
              )}
            </Rail>
            <Rail bare id="for-you-2">{mapRailPosters(rowTwo, 'home2', openTitle)}</Rail>
            <Rail title="Popular films">{mapRailPosters(extraFilms, 'film', openTitle)}</Rail>
            <Rail title="Popular series">{mapRailPosters(extraShows, 'show', openTitle)}</Rail>
          </>
        )}
      </div>
    </main>
  );
}
