import { describe, expect, it } from 'vitest';
import { TITLES, type Title } from '../../../data/catalog';
import { openPlayback } from '../../../data/openDetails';
import { wrapFocusId } from '../../../nav/wrapFocus';
import { laneMatches, navTabs, playLabel } from '../layouts';
import {
  activateNetflixTitle,
  buildNetflixRows,
  inNetflixLane,
  isNetflixOriginal,
  isNetflixPlayable,
  isNetflixStub,
  netflixCardId,
  netflixCardIds,
  netflixCameraTarget,
  netflixDisplayTitle,
  netflixHeroActionIds,
  netflixKicker,
  netflixNavIds,
  netflixPlayLabel,
  netflixPlayTarget,
  netflixRailLabel,
  netflixSeasonLabel,
  netflixTabs,
  pickNetflixHero,
  stepNetflixFocus,
  titlesFromNetflixCatalog,
  uniqueNetflixTitles,
  wrapNetflixFocus,
} from './netflix';

const film: Title = {
  id: 'nf-film',
  title: 'Glass Onion',
  year: 2022,
  kind: 'movie',
  synopsis: 'A new Knives Out mystery.',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  genres: ['Mystery'],
  rating: '12',
  runtime: '2h 19m',
  hue: 40,
};

const show: Title = {
  id: 'stranger-things',
  title: 'Stranger Things',
  year: 2016,
  kind: 'series',
  synopsis: 'A small town, a missing boy.',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  genres: ['Science Fiction'],
  rating: '15',
  seasons: 5,
  hue: 350,
};

const stub: Title = {
  id: 'tt0000001',
  title: 'tt0000001',
  year: 0,
  kind: 'movie',
  synopsis: '',
  poster: '',
  backdrop: '',
  genres: [],
  rating: '',
  hue: 0,
};

const locked: Title = {
  id: 'nf-locked',
  title: 'Unreleased Special',
  year: 2026,
  kind: 'movie',
  synopsis: 'Not in the library.',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  genres: ['Drama'],
  rating: '15',
  hue: 10,
  playable: false,
};

describe('Netflix hub contract', () => {
  it('uses Home / TV Shows / Movies / New & Popular / My List tabs', () => {
    expect(netflixTabs().map((tab) => tab.label)).toEqual(['Home', 'TV Shows', 'Movies', 'New & Popular', 'My List']);
    expect(navTabs('netflix').map((tab) => tab.id)).toEqual(['home', 'shows', 'movies', 'new', 'list']);
    expect(playLabel('netflix')).toBe('Play');
  });

  it('wraps category tabs and chrome at both ends', () => {
    const ids = netflixNavIds(netflixTabs());
    expect(ids[0]).toBe('service-back');
    expect(ids).toContain('service-tab-home');
    expect(ids).toContain('service-tab-shows');
    expect(ids).toContain('service-tab-movies');
    expect(ids).toContain('service-tab-new');
    expect(ids).toContain('service-tab-list');
    expect(ids).toContain('service-search');
    expect(ids[ids.length - 1]).toBe('service-profile');
    expect(wrapNetflixFocus('right', ids.length - 1, ids)).toBe('service-back');
    expect(wrapNetflixFocus('left', 0, ids)).toBe('service-profile');
    expect(wrapNetflixFocus('right', 1, ids)).toBeNull();
    expect(wrapFocusId('right', 4, 5, 'service-tab-home', 'service-tab-list')).toBe('service-tab-home');
    expect(stepNetflixFocus('right', 5, ids)).toBe('service-search');
    expect(stepNetflixFocus('right', ids.length - 1, ids)).toBe('service-back');
    expect(stepNetflixFocus('left', 0, ids)).toBe('service-profile');
    expect(stepNetflixFocus('up', 0, ids)).toBeNull();
  });

  it('wraps hero Play / More Info / My List and rail cards', () => {
    const actions = netflixHeroActionIds();
    expect(actions).toEqual(['service-play', 'service-info', 'service-watchlist']);
    expect(wrapNetflixFocus('right', 2, actions)).toBe('service-play');
    expect(wrapNetflixFocus('left', 0, actions)).toBe('service-watchlist');
    const cards = netflixCardIds('nf-continue', [film, show]);
    expect(wrapNetflixFocus('right', 1, cards)).toBe(cards[0]);
    expect(wrapNetflixFocus('left', 0, cards)).toBe(cards[1]);
    expect(netflixCardId('nf-continue', film.id)).toBe('nf-continue-nf-film');
    expect(netflixCardId('nf-continue', film.id, 0)).toBe('nf-continue-nf-film--0');
    expect(netflixCardId('nf-continue', film.id, 2)).toBe('nf-continue-nf-film--2');
  });

  it('locks later rails under the nav and keeps the billboard at the top', () => {
    expect(
      netflixCameraTarget({ zone: 'top', scrollTop: 420, railTop: 640, viewTop: 0, navHeight: 72 }),
    ).toBe(0);
    expect(
      netflixCameraTarget({ zone: 'row', scrollTop: 0, railTop: 640, viewTop: 0, navHeight: 72 }),
    ).toBe(558);
  });

  it('filters lanes and keeps Netflix catalog originals', () => {
    expect(inNetflixLane(film, 'movies')).toBe(true);
    expect(inNetflixLane(show, 'movies')).toBe(false);
    expect(inNetflixLane(show, 'shows')).toBe(true);
    expect(inNetflixLane(film, 'new')).toBe(true);
    expect(laneMatches(show, 'new')).toBe(false);
    expect(isNetflixOriginal(show)).toBe(true);
    expect(TITLES.some(isNetflixOriginal)).toBe(true);
  });

  it('marks stubs and locked titles as unplayable without a broken name', () => {
    expect(isNetflixStub(stub)).toBe(true);
    expect(isNetflixPlayable(stub)).toBe(false);
    expect(isNetflixPlayable(locked)).toBe(false);
    expect(isNetflixPlayable(film)).toBe(true);
    expect(netflixDisplayTitle(stub)).toBe('Unavailable');
    expect(netflixPlayTarget(stub)).toBe('unavailable');
    expect(netflixPlayTarget(show)).toBe('details');
    expect(netflixPlayTarget(film)).toBe('player');
    expect(netflixKicker(show)).toBe('SERIES');
    expect(netflixKicker(film)).toBe('FILM');
    expect(netflixSeasonLabel(show)).toBe('5 Seasons');
    expect(netflixSeasonLabel(film)).toBe('2h 19m');
    expect(netflixPlayLabel(film)).toBe('Play');
    expect(netflixPlayLabel({ ...film, progress: 0.4 })).toBe('Resume');
    expect(netflixPlayLabel(stub)).toBe('Unavailable');
  });

  it('reads a Service catalog bag without treating it as a title list', () => {
    const fromBag = titlesFromNetflixCatalog({
      hero: {
        id: film.id,
        title: film.title,
        kind: 'movie',
        year: film.year,
        synopsis: film.synopsis,
        poster: film.poster,
        backdrop: film.backdrop,
        genres: [...film.genres],
        rating: film.rating,
        runtime: film.runtime,
        hue: film.hue,
        playable: true,
      },
      rails: [{ id: 'netflix-films', title: 'Popular films', items: [] }],
      continueWatching: [],
    });
    expect(fromBag.some((title) => title.id === film.id)).toBe(true);
    expect(() => titlesFromNetflixCatalog({ rails: [], continueWatching: [], hero: null })).not.toThrow();
  });

  it('plays films from rails and opens series or stubs in details', () => {
    const played: string[] = [];
    const opened: string[] = [];
    expect(activateNetflixTitle(film, (title) => played.push(title.id), (title) => opened.push(title.id))).toBe('player');
    expect(activateNetflixTitle(show, (title) => played.push(title.id), (title) => opened.push(title.id))).toBe('details');
    expect(activateNetflixTitle(stub, (title) => played.push(title.id), (title) => opened.push(title.id))).toBe('unavailable');
    expect(played).toEqual([film.id]);
    expect(opened).toEqual([show.id, stub.id]);
  });

  it('picks a lane hero and builds usable rails from catalog and watchlist', () => {
    const catalog = uniqueNetflixTitles([film, show, stub, locked, ...TITLES]);
    expect(pickNetflixHero('movies', catalog)?.kind).toBe('movie');
    expect(pickNetflixHero('shows', catalog)?.kind).toBe('series');
    expect(isNetflixStub(pickNetflixHero('home', catalog) as Title)).toBe(false);

    const home = buildNetflixRows({
      lane: 'home',
      watching: [show],
      watchlist: [film],
      hubRails: [{ id: 'netflix-films', title: 'Popular films', titles: [film] }],
      catalog,
    });
    expect(home.map((rail) => rail.id)).toContain('nf-continue');
    expect(home.map((rail) => rail.id)).toContain('nf-list-home');
    expect(home.map((rail) => rail.id)).toContain('nf-top10');
    expect(home.some((rail) => rail.id === 'netflix-films' && rail.title === 'Popular Movies')).toBe(true);
    expect(home.every((rail) => rail.titles.length > 0)).toBe(true);

    const movies = buildNetflixRows({
      lane: 'movies',
      watching: [show, film],
      watchlist: [show],
      hubRails: [],
      catalog,
    });
    expect(movies.every((rail) => rail.titles.every((title) => title.kind === 'movie'))).toBe(true);
    expect(movies.some((rail) => rail.titles.some((title) => title.id === film.id))).toBe(true);

    const list = buildNetflixRows({
      lane: 'list',
      watching: [show],
      watchlist: [film],
      hubRails: [],
      catalog,
    });
    expect(list[0]?.id).toBe('nf-mylist');
    expect(list[0]?.titles.map((title) => title.id)).toEqual(expect.arrayContaining([film.id, show.id]));
    expect(netflixRailLabel('Because you watched')).toBe('Because you watched');
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
