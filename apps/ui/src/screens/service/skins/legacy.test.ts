import { describe, expect, it } from 'vitest';
import { TITLES, type Title } from '../../../data/catalog';
import { openPlayback } from '../../../data/openDetails';
import {
  buildLegacyRails,
  laneFromCategory,
  legacyCardId,
  legacyCardIds,
  legacyDownCameraY,
  legacyHeroActionIds,
  legacyNavIds,
  legacyPlayLabel,
  legacyRailAction,
  LEGACY_TABS,
  uniqueHubTitles,
  wrapHubFocus,
} from './legacy';

const film: Title = {
  id: 'legacy-film',
  title: 'Heat',
  year: 1995,
  kind: 'movie',
  synopsis: 'A crew in Los Angeles.',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  genres: ['Crime'],
  rating: '15',
  runtime: '2h 50m',
  hue: 20,
};

const show: Title = {
  id: 'legacy-show',
  title: 'The Wire',
  year: 2002,
  kind: 'series',
  synopsis: 'A city and a case.',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  genres: ['Crime'],
  rating: '15',
  seasons: 5,
  hue: 210,
};

describe('legacy hub contract', () => {
  it('uses Home / Series / Movies / My List', () => {
    expect(LEGACY_TABS.map((tab) => tab.label)).toEqual(['Home', 'Series', 'Movies', 'My List']);
    expect(LEGACY_TABS.map((tab) => tab.id)).toEqual(['home', 'shows', 'movies', 'list']);
    expect(laneFromCategory('series')).toBe('shows');
    expect(laneFromCategory('my list')).toBe('list');
  });

  it('wraps chrome and hero actions at both ends', () => {
    const ids = legacyNavIds(LEGACY_TABS);
    expect(ids[0]).toBe('service-back');
    expect(ids).toContain('service-tab-home');
    expect(ids).toContain('service-tab-shows');
    expect(ids).toContain('service-tab-movies');
    expect(ids).toContain('service-tab-list');
    expect(ids[ids.length - 1]).toBe('service-search');
    expect(wrapHubFocus('right', ids.length - 1, ids)).toBe('service-back');
    expect(wrapHubFocus('left', 0, ids)).toBe('service-search');
    expect(wrapHubFocus('right', 1, ids)).toBeNull();
    expect(wrapHubFocus('down', 0, ids)).toBeNull();
    const actions = legacyHeroActionIds();
    expect(actions).toEqual(['service-play', 'service-info']);
    expect(wrapHubFocus('right', 1, actions)).toBe('service-play');
    expect(wrapHubFocus('left', 0, actions)).toBe('service-info');
  });

  it('loops rail cards and keeps conveyor clone ids off the focusable copy', () => {
    const ids = legacyCardIds('app-movies', [film, show]);
    expect(ids).toEqual(['app-movies-legacy-film', 'app-movies-legacy-show']);
    expect(wrapHubFocus('right', 1, ids)).toBe(ids[0]);
    expect(wrapHubFocus('left', 0, ids)).toBe(ids[1]);
    expect(wrapHubFocus('right', 0, ids)).toBeNull();
    expect(legacyCardId('app-movies', film.id)).toBe('app-movies-legacy-film');
    expect(legacyCardId('app-movies', film.id, 0)).toBe('app-movies-legacy-film--0');
    expect(legacyCardId('app-movies', film.id, 2)).toBe('app-movies-legacy-film--2');
  });

  it('pins Down camera under the sticky nav', () => {
    expect(legacyDownCameraY(0, 640, 0, 54)).toBe(586);
    expect(legacyDownCameraY(200, 120, 0, 54)).toBe(266);
  });

  it('plays Continue Watching through TVM Stream and opens details from other rails', () => {
    expect(legacyRailAction('youtube-continue')).toBe('play');
    expect(legacyRailAction('app-up-next')).toBe('play');
    expect(legacyRailAction('app-movies')).toBe('details');
    expect(legacyPlayLabel(film)).toBe('Play');
    expect(legacyPlayLabel({ ...film, progress: 0.4 })).toBe('Resume');
  });

  it('builds playable home rails from watching, list, and catalog', () => {
    const catalog = uniqueHubTitles([film, show, film, ...TITLES]);
    const home = buildLegacyRails({
      appId: 'youtube',
      lane: 'home',
      watching: [show],
      watchlist: [film],
      hubRails: [],
      catalog,
    });
    expect(home[0]?.id).toBe('youtube-continue');
    expect(home.some((rail) => rail.id === 'youtube-movies')).toBe(true);
    expect(home.some((rail) => rail.id === 'youtube-shows')).toBe(true);
  });

  it('sends titles into the TVM player', () => {
    const pushed: Array<{ name: string; modal?: boolean }> = [];
    const navigate = {
      push: (name: string) => {
        pushed.push({ name });
      },
      pushModal: (name: string) => {
        pushed.push({ name, modal: true });
      },
    };
    openPlayback(navigate as never, film);
    expect(pushed).toEqual([{ name: 'player', modal: true }]);
  });
});
