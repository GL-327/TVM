import { describe, expect, it } from 'vitest';
import { TITLES, type Title } from '../../../data/catalog';
import { openPlayback } from '../../../data/openDetails';
import { navTabs, playLabel } from '../layouts';
import {
  activatePeacockTitle,
  buildPeacockRails,
  laneFromCategory,
  peacockCardIds,
  peacockHeroActionIds,
  peacockNavIds,
  peacockPlayTarget,
  peacockRailAction,
  pickLaneHero,
  toHubTitle,
  uniqueHubTitles,
  wrapHubFocus,
} from './peacock';

const film: Title = {
  id: 'peacock-film',
  title: 'The Super Mario Bros. Movie',
  year: 2023,
  kind: 'movie',
  synopsis: 'A plumber in the Mushroom Kingdom.',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  genres: ['Animation'],
  rating: 'PG',
  runtime: '1h 32m',
  hue: 200,
};

const show: Title = {
  id: 'peacock-show',
  title: 'The Office',
  year: 2005,
  kind: 'series',
  synopsis: 'A paper company.',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  genres: ['Comedy'],
  rating: '12',
  seasons: 9,
  hue: 48,
};

describe('Peacock hub contract', () => {
  it('uses Home / Movies / TV Shows / My Stuff and Watch Now', () => {
    expect(navTabs('peacock').map((tab) => tab.label)).toEqual(['Home', 'Movies', 'TV Shows', 'My Stuff']);
    expect(playLabel('peacock')).toBe('Watch Now');
    expect(laneFromCategory('tv shows')).toBe('shows');
    expect(laneFromCategory('my stuff')).toBe('list');
  });

  it('wraps the side rail vertically and hero actions horizontally', () => {
    const ids = peacockNavIds(navTabs('peacock'));
    expect(ids[0]).toBe('service-back');
    expect(ids).toContain('service-tab-home');
    expect(ids).toContain('service-tab-list');
    expect(wrapHubFocus('down', ids.length - 1, ids, 'y')).toBe('service-back');
    expect(wrapHubFocus('up', 0, ids, 'y')).toBeNull();
    expect(wrapHubFocus('right', ids.length - 1, ids, 'y')).toBeNull();
    expect(wrapHubFocus('left', 0, ids, 'y')).toBeNull();
    const actions = peacockHeroActionIds();
    expect(actions).toEqual(['service-play', 'service-info']);
    expect(wrapHubFocus('right', 1, actions)).toBe('service-play');
    expect(wrapHubFocus('left', 0, actions)).toBe('service-info');
  });

  it('builds Keep Watching and My Stuff rails', () => {
    const catalog = uniqueHubTitles([film, show, ...TITLES]);
    expect(pickLaneHero('list', catalog)).toBeUndefined();
    const home = buildPeacockRails({
      lane: 'home',
      watching: [show],
      watchlist: [film],
      hubRails: [{ id: 'peacock-series', title: 'Peacock originals', titles: [show] }],
      catalog,
    });
    expect(home.some((rail) => rail.id === 'peacock-continue' && rail.title === 'Keep Watching')).toBe(true);
    expect(home.some((rail) => rail.title === 'Peacock Originals')).toBe(true);
    const stuff = buildPeacockRails({
      lane: 'list',
      watching: [show],
      watchlist: [film],
      hubRails: [],
      catalog,
    });
    expect(stuff[0]?.title).toBe('My Stuff');
    expect(stuff[0]?.titles[0]?.id).toBe(film.id);
  });

  it('wraps rail cards and plays every row through TVM', () => {
    const ids = peacockCardIds('peacock-movies', [film, show]);
    expect(ids).toEqual(['peacock-movies-peacock-film', 'peacock-movies-peacock-show']);
    expect(wrapHubFocus('right', 1, ids)).toBe(ids[0]);
    expect(wrapHubFocus('left', 0, ids)).toBe(ids[1]);
    expect(wrapHubFocus('right', 0, ids)).toBeNull();
    expect(peacockRailAction('peacock-continue')).toBe('play');
    expect(peacockRailAction('peacock-movies')).toBe('play');
    expect(peacockRailAction('peacock-stuff')).toBe('play');
    expect(peacockPlayTarget(film)).toBe('player');
    expect(peacockPlayTarget(show)).toBe('details');
    const played: string[] = [];
    const opened: string[] = [];
    expect(activatePeacockTitle(film, (title) => played.push(title.id), (title) => opened.push(title.id))).toBe('player');
    expect(activatePeacockTitle(show, (title) => played.push(title.id), (title) => opened.push(title.id))).toBe('details');
    expect(played).toEqual([film.id]);
    expect(opened).toEqual([show.id]);
  });

  it('keeps season counts on hub titles', () => {
    expect(toHubTitle(show).seasons).toBe(9);
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
