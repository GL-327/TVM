import { describe, expect, it } from 'vitest';
import { TITLES, type Title } from '../../../data/catalog';
import { openPlayback } from '../../../data/openDetails';
import { navTabs, playLabel } from '../layouts';
import {
  buildHuluRails,
  huluCardId,
  huluCardIds,
  huluHeroActionIds,
  huluHeroKicker,
  huluNavIds,
  huluPlayLabel,
  huluRailAction,
  laneFromCategory,
  pickLaneHero,
  toHubTitle,
  uniqueHubTitles,
  wrapHubFocus,
  wrapHubNavFocus,
} from './hulu';

const film: Title = {
  id: 'hulu-film',
  title: 'Palm Springs',
  year: 2020,
  kind: 'movie',
  synopsis: 'A wedding loops.',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  genres: ['Comedy'],
  rating: '15',
  runtime: '1h 30m',
  hue: 140,
};

const show: Title = {
  id: 'hulu-show',
  title: 'The Bear',
  year: 2022,
  kind: 'series',
  synopsis: 'A Chicago kitchen.',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  genres: ['Drama'],
  rating: '15',
  seasons: 3,
  hue: 12,
};

describe('Hulu hub contract', () => {
  it('uses For You / Movies / Series / My Stuff and Start Watching', () => {
    expect(navTabs('hulu').map((tab) => tab.label)).toEqual(['For You', 'Movies', 'Series', 'My Stuff']);
    expect(playLabel('hulu')).toBe('Start Watching');
    expect(laneFromCategory('for you')).toBe('home');
    expect(laneFromCategory('tv')).toBe('shows');
    expect(laneFromCategory('my stuff')).toBe('list');
  });

  it('wraps chrome and hero actions at both ends', () => {
    const ids = huluNavIds(navTabs('hulu'));
    expect(ids[0]).toBe('service-back');
    expect(ids).toEqual(['service-back', 'service-tab-home', 'service-tab-movies', 'service-tab-shows', 'service-tab-list', 'service-search']);
    expect(wrapHubFocus('right', ids.length - 1, ids)).toBe('service-back');
    expect(wrapHubFocus('left', 0, ids)).toBe('service-search');
    expect(wrapHubNavFocus('down', ids.length - 1, ids)).toBe('service-back');
    expect(wrapHubNavFocus('up', 0, ids)).toBe('service-search');
    const actions = huluHeroActionIds();
    expect(wrapHubFocus('right', 1, actions)).toBe('service-play');
    expect(wrapHubFocus('up', 0, actions)).toBeNull();
    expect(wrapHubFocus('down', 0, actions)).toBeNull();
  });

  it('keeps conveyor copies off the focus map and lets Down leave a row', () => {
    expect(huluCardId('hulu-movies', 'hulu-film')).toBe('hulu-movies-hulu-film');
    expect(huluCardId('hulu-movies', 'hulu-film', 1)).toBe('hulu-movies-hulu-film');
    expect(huluCardId('hulu-movies', 'hulu-film', 0)).toBe('hulu-movies-hulu-film--0');
    expect(huluCardId('hulu-movies', 'hulu-film', 2)).toBe('hulu-movies-hulu-film--2');
    const ids = huluCardIds('hulu-movies', [film, show]);
    expect(wrapHubFocus('down', 0, ids)).toBeNull();
    expect(wrapHubFocus('up', 1, ids)).toBeNull();
    expect(wrapHubFocus('right', 1, ids)).toBe('hulu-movies-hulu-film');
    expect(wrapHubFocus('left', 0, ids)).toBe('hulu-movies-hulu-show');
  });

  it('hides the hero on My Stuff and keeps playable rails', () => {
    const catalog = uniqueHubTitles([film, show, ...TITLES]);
    expect(pickLaneHero('list', catalog)).toBeUndefined();
    expect(pickLaneHero('movies', catalog)?.kind).toBe('movie');
    const stuff = buildHuluRails({
      lane: 'list',
      watching: [show],
      watchlist: [film],
      hubRails: [],
      catalog,
    });
    expect(stuff).toEqual([{ id: 'hulu-stuff', title: 'My Stuff', titles: [film] }]);
    const movies = buildHuluRails({
      lane: 'movies',
      watching: [show, film],
      watchlist: [],
      hubRails: [],
      catalog,
    });
    expect(movies.every((rail) => rail.titles.every((title) => title.kind === 'movie'))).toBe(true);
  });

  it('plays from Continue Watching and opens details from other rails', () => {
    expect(huluRailAction('hulu-continue')).toBe('play');
    expect(huluRailAction('hulu-movies')).toBe('details');
    expect(huluRailAction('hulu-stuff')).toBe('details');
    expect(huluCardIds('hulu-continue', [show, film])).toEqual(['hulu-continue-hulu-show', 'hulu-continue-hulu-film']);
  });

  it('keeps Start Watching / Resume and seasons on hub titles', () => {
    expect(huluPlayLabel(film)).toBe('Start Watching');
    expect(huluPlayLabel({ ...film, progress: 0.4 })).toBe('Resume');
    expect(huluHeroKicker(show)).toBe('Hulu Original');
    expect(huluHeroKicker(film)).toBe('Featured on Hulu');
    expect(huluHeroKicker({ ...film, progress: 0.2 })).toBe('Continue Watching');
    expect(toHubTitle(show).seasons).toBe(3);
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
