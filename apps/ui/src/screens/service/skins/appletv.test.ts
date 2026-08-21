import { describe, expect, it } from 'vitest';
import { TITLES, type Title } from '../../../data/catalog';
import { openPlayback } from '../../../data/openDetails';
import { moreLabel, navTabs, playLabel } from '../layouts';
import {
  appleTvCameraY,
  appleTvCardId,
  appleTvCardIds,
  appleTvHeroActionIds,
  appleTvNavIds,
  appleTvRailAction,
  appleTvRailTitle,
  appleTvShouldLoop,
  buildAppleTvRails,
  laneFromCategory,
  nextAppleTvPreview,
  pickLaneHero,
  toHubTitle,
  uniqueHubTitles,
  wrapHubFocus,
} from './appletv';

const film: Title = {
  id: 'apple-film',
  title: 'Killers of the Flower Moon',
  year: 2023,
  kind: 'movie',
  synopsis: 'A study of greed.',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  genres: ['Drama'],
  rating: '15',
  runtime: '3h 26m',
  hue: 20,
};

const show: Title = {
  id: 'apple-show',
  title: 'Ted Lasso',
  year: 2020,
  kind: 'series',
  synopsis: 'A coach in London.',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  genres: ['Comedy'],
  rating: '12',
  seasons: 3,
  hue: 80,
};

describe('Apple TV hub contract', () => {
  it('uses Watch Now / Movies / TV Shows and Info', () => {
    expect(navTabs('appletv').map((tab) => tab.label)).toEqual(['Watch Now', 'Movies', 'TV Shows']);
    expect(playLabel('appletv')).toBe('Play');
    expect(moreLabel('appletv')).toBe('Info');
    expect(laneFromCategory('watch now')).toBe('home');
    expect(laneFromCategory('tv shows')).toBe('shows');
  });

  it('wraps chrome and hero actions at both ends', () => {
    const ids = appleTvNavIds(navTabs('appletv'));
    expect(ids[0]).toBe('service-back');
    expect(ids).toContain('service-tab-home');
    expect(ids).toContain('service-tab-movies');
    expect(ids).toContain('service-tab-shows');
    expect(wrapHubFocus('right', ids.length - 1, ids)).toBe('service-back');
    expect(wrapHubFocus('left', 0, ids)).toBe(ids[ids.length - 1]);
    expect(wrapHubFocus('right', 1, ids)).toBeNull();
    const actions = appleTvHeroActionIds();
    expect(actions).toEqual(['service-play', 'service-info']);
    expect(wrapHubFocus('right', 1, actions)).toBe('service-play');
    expect(wrapHubFocus('left', 0, actions)).toBe('service-info');
  });

  it('picks a lane hero and builds playable rails', () => {
    const catalog = uniqueHubTitles([film, show, film, ...TITLES]);
    expect(pickLaneHero('movies', catalog)?.kind).toBe('movie');
    expect(pickLaneHero('shows', catalog)?.kind).toBe('series');
    expect(appleTvRailTitle('appletv-continue', 'Continue')).toBe('Up Next');
    const home = buildAppleTvRails({
      lane: 'home',
      watching: [show],
      watchlist: [film],
      hubRails: [{ id: 'appletv-films', title: 'Popular films', titles: [film] }],
      catalog,
    });
    expect(home.some((rail) => rail.id === 'appletv-continue')).toBe(true);
    expect(home.some((rail) => rail.id === 'appletv-watchlist')).toBe(true);
    expect(home.every((rail) => rail.titles.length > 0)).toBe(true);
    const movies = buildAppleTvRails({
      lane: 'movies',
      watching: [show, film],
      watchlist: [show],
      hubRails: [],
      catalog,
    });
    expect(movies.every((rail) => rail.titles.every((title) => title.kind === 'movie'))).toBe(true);
  });

  it('plays from Up Next and opens details from other rails', () => {
    expect(appleTvRailAction('appletv-continue')).toBe('play');
    expect(appleTvRailAction('appletv-movies')).toBe('details');
    expect(appleTvRailAction('appletv-watchlist')).toBe('details');
  });

  it('wraps rail cards and keeps the same preview identity', () => {
    const ids = appleTvCardIds('appletv-movies', [film, show]);
    expect(ids).toEqual(['appletv-movies-apple-film', 'appletv-movies-apple-show']);
    expect(wrapHubFocus('right', 1, ids)).toBe(ids[0]);
    expect(wrapHubFocus('left', 0, ids)).toBe(ids[1]);
    expect(wrapHubFocus('right', 0, ids)).toBeNull();
    expect(nextAppleTvPreview(film, film)).toBe(film);
    expect(nextAppleTvPreview(film, show)).toBe(show);
    expect(toHubTitle(show).seasons).toBe(3);
  });

  it('loops conveyor copies and cameras Down onto the next rail', () => {
    expect(appleTvCardId('appletv-movies', 'apple-film')).toBe('appletv-movies-apple-film');
    expect(appleTvCardId('appletv-movies', 'apple-film', 0)).toBe('appletv-movies-apple-film--0');
    expect(appleTvCardId('appletv-movies', 'apple-film', 2)).toBe('appletv-movies-apple-film--2');
    expect(appleTvShouldLoop(1)).toBe(false);
    expect(appleTvShouldLoop(2)).toBe(true);
    expect(appleTvCameraY('hero', 640, 0, 0, 52)).toBe(0);
    expect(appleTvCameraY('rail', 0, 720, 0, 52)).toBe(668);
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
    expect(pushed).toEqual([{ name: 'details' }, { name: 'player', modal: true }]);
  });
});
