import { describe, expect, it } from 'vitest';
import { TITLES, type Title } from '../../../data/catalog';
import { openPlayback } from '../../../data/openDetails';
import { wrapFocusId } from '../../../nav/wrapFocus';
import { laneMatches, navTabs, playLabel } from '../layouts';
import {
  activatePrimeTitle,
  buildPrimeRails,
  inPrimeLane,
  isPrimeSports,
  isPrimeStudio,
  laneFromCategory,
  pickPrimeHero,
  PRIME_HUB_CLASS,
  primeCardId,
  primeCardIds,
  primeDetailsLabel,
  primeHeroActionIds,
  primeHeroBadges,
  primeHeroPlayLabel,
  primeNavIds,
  primePlayTarget,
  primeRailAction,
  primeRailCameraTop,
  primeRuntimeLabel,
  primeTabs,
  uniquePrimeTitles,
  wrapPrimeFocus,
} from './prime';

const film: Title = {
  id: 'prime-film',
  title: 'The Tomorrow War',
  year: 2021,
  kind: 'movie',
  synopsis: 'A family man is drafted to fight a future war.',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  genres: ['Action'],
  rating: '12',
  runtime: '2h 18m',
  hue: 200,
  network: 'prime video',
};

const show: Title = {
  id: 'prime-show',
  title: 'Reacher',
  year: 2022,
  kind: 'series',
  synopsis: 'Jack Reacher.',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  genres: ['Action', 'Crime'],
  rating: '15',
  seasons: 3,
  hue: 20,
  network: 'prime video',
};

const sport: Title = {
  id: 'prime-sport',
  title: 'Thursday Night Football',
  year: 2023,
  kind: 'series',
  synopsis: 'Live football.',
  poster: '/p.jpg',
  backdrop: '',
  genres: ['Sports'],
  rating: 'PG',
  hue: 210,
};

describe('Prime Video hub contract', () => {
  it('uses Home / Movies / TV / Sports tabs from layouts', () => {
    expect(navTabs('prime').map((tab) => tab.id)).toEqual(['home', 'movies', 'shows', 'new']);
    expect(primeTabs().map((tab) => tab.label)).toEqual(['Home', 'Movies', 'TV', 'Sports']);
    expect(laneFromCategory('sports')).toBe('new');
    expect(laneFromCategory('tv')).toBe('shows');
    expect(playLabel('prime')).toBe('Play');
  });

  it('wraps category tabs and chrome at both ends', () => {
    const ids = primeNavIds(navTabs('prime'));
    expect(ids[0]).toBe('service-back');
    expect(ids).toContain('service-tab-home');
    expect(ids).toContain('service-tab-movies');
    expect(ids).toContain('service-tab-shows');
    expect(ids).toContain('service-tab-new');
    expect(wrapPrimeFocus('right', ids.length - 1, ids)).toBe('service-back');
    expect(wrapPrimeFocus('left', 0, ids)).toBe(ids[ids.length - 1]);
    expect(wrapPrimeFocus('right', 1, ids)).toBeNull();
    expect(wrapFocusId('right', 3, 4, 'service-tab-home', 'service-tab-new')).toBe('service-tab-home');
  });

  it('wraps hero Play / details / watchlist', () => {
    const ids = primeHeroActionIds();
    expect(ids).toEqual(['service-play', 'service-info', 'service-watchlist']);
    expect(wrapPrimeFocus('right', 2, ids)).toBe('service-play');
    expect(wrapPrimeFocus('left', 0, ids)).toBe('service-watchlist');
    expect(primeDetailsLabel()).toBe('More details');
    expect(primeHeroPlayLabel(film)).toBe('Play');
    expect(primeHeroPlayLabel({ ...film, progress: 0.42 })).toBe('Resume');
    expect(primeRuntimeLabel(show)).toBe('3 seasons');
    expect(primeRuntimeLabel({ ...show, seasons: 1 })).toBe('1 season');
    expect(primeRuntimeLabel(film)).toBe('2h 18m');
    expect(primeHeroBadges(film)).toEqual(['UHD', 'HDR']);
    expect(primeHeroBadges(show)).toEqual(['HD']);
  });

  it('filters lanes and keeps Prime / sports catalog titles', () => {
    expect(inPrimeLane(film, 'movies')).toBe(true);
    expect(inPrimeLane(show, 'movies')).toBe(false);
    expect(inPrimeLane(show, 'shows')).toBe(true);
    expect(inPrimeLane(film, 'new')).toBe(true);
    expect(inPrimeLane(sport, 'new')).toBe(true);
    expect(laneMatches(show, 'new')).toBe(true);
    expect(isPrimeStudio(film)).toBe(true);
    expect(isPrimeSports(sport)).toBe(true);
    expect(TITLES.some(isPrimeStudio)).toBe(true);
  });

  it('picks a lane hero and builds usable rails from catalog data', () => {
    const catalog = uniquePrimeTitles([film, show, sport, film, ...TITLES]);
    expect(pickPrimeHero('movies', catalog)?.kind).toBe('movie');
    expect(pickPrimeHero('shows', catalog)?.kind).toBe('series');
    const home = buildPrimeRails({
      lane: 'home',
      watching: [show],
      watchlist: [film],
      hubRails: [{ id: 'prime-films', title: 'Popular films', titles: [film] }],
      catalog,
    });
    expect(home.map((rail) => rail.id)).toContain('prime-continue');
    expect(home.map((rail) => rail.id)).toContain('prime-watchlist');
    expect(home.some((rail) => rail.id === 'prime-sports' && rail.titles.some(isPrimeSports))).toBe(true);
    expect(home.every((rail) => rail.titles.length > 0)).toBe(true);

    const movies = buildPrimeRails({
      lane: 'movies',
      watching: [show, film],
      watchlist: [show],
      hubRails: [],
      catalog,
    });
    expect(movies.every((rail) => rail.titles.every((title) => title.kind === 'movie'))).toBe(true);
    expect(movies.some((rail) => rail.titles.some((title) => title.id === film.id))).toBe(true);

    const sports = buildPrimeRails({
      lane: 'new',
      watching: [],
      watchlist: [],
      hubRails: [],
      catalog,
    });
    expect(sports.some((rail) => rail.id === 'prime-sports' && rail.titles.some(isPrimeSports))).toBe(true);
  });

  it('wraps rail cards and plays every row through TVM', () => {
    const ids = primeCardIds('prime-continue', [film, show]);
    expect(ids).toEqual(['prime-continue-prime-film', 'prime-continue-prime-show']);
    expect(primeCardId('prime-continue', film.id)).toBe('prime-continue-prime-film');
    expect(primeCardId('prime-continue', film.id, 0)).toBe('prime-continue-prime-film--0');
    expect(primeCardId('prime-continue', film.id, 2)).toBe('prime-continue-prime-film--2');
    expect(wrapPrimeFocus('right', 1, ids)).toBe(ids[0]);
    expect(wrapPrimeFocus('left', 0, ids)).toBe(ids[1]);
    expect(wrapPrimeFocus('down', 0, ids)).toBeNull();
    expect(wrapPrimeFocus('down', 1, primeHeroActionIds())).toBeNull();
    expect(primeRailAction('prime-continue')).toBe('play');
    expect(primeRailAction('prime-movies')).toBe('play');
    expect(primePlayTarget(film)).toBe('player');
    expect(primePlayTarget(show)).toBe('details');
    const played: string[] = [];
    const opened: string[] = [];
    expect(activatePrimeTitle(film, (title) => played.push(title.id), (title) => opened.push(title.id))).toBe('player');
    expect(activatePrimeTitle(show, (title) => played.push(title.id), (title) => opened.push(title.id))).toBe('details');
    expect(played).toEqual([film.id]);
    expect(opened).toEqual([show.id]);
  });

  it('owns the hub camera class and pins a row under the top chrome', () => {
    expect(PRIME_HUB_CLASS).toBe('service service--prime prime-hub');
    expect(primeRailCameraTop(0, 720, 0, 68)).toBe(652);
    expect(primeRailCameraTop(200, 140, 0, 68)).toBe(272);
    expect(wrapPrimeFocus('down', 0, primeNavIds(primeTabs()))).toBeNull();
  });

  it('sends films to the TVM player and series to details', () => {
    const pushed: Array<{ name: string; modal?: boolean }> = [];
    const navigate = {
      push: (name: string) => {
        pushed.push({ name });
      },
      pushModal: (name: string) => {
        pushed.push({ name, modal: true });
      },
    };
    openPlayback(navigate as never, show);
    openPlayback(navigate as never, film);
    expect(pushed).toEqual([
      { name: 'details' },
      { name: 'player', modal: true },
    ]);
  });
});
