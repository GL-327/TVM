import { describe, expect, it } from 'vitest';
import { TITLES } from '../../../data/catalog';
import {
  activateDisneyTitle,
  buildDisneyRails,
  capDisneyRail,
  disneyActivateTarget,
  disneyBrandMatches,
  disneyCardId,
  disneyCardIds,
  disneyFallbackHub,
  disneyHeroBadge,
  disneyNavItems,
  disneyPlayLabel,
  DISNEY_RAIL_CAP,
  DISNEY_TABS,
  disneyTitleMatches,
  laneFromCategory,
  originalIdsFrom,
  pickBrandTitles,
  wrapHubFocus,
} from './disney';

describe('Disney+ hub skin', () => {
  it('uses Home / Movies / Series / Originals / Watchlist with a living-room icon row', () => {
    expect(DISNEY_TABS.map((tab) => tab.label)).toEqual(['Home', 'Movies', 'Series', 'Originals', 'Watchlist']);
    expect(DISNEY_TABS.map((tab) => tab.id)).toEqual(['home', 'movies', 'shows', 'new', 'list']);
    expect(disneyNavItems().map((item) => item.id)).toEqual([
      'service-tab-home',
      'disney-search',
      'service-tab-list',
      'service-tab-movies',
      'service-tab-shows',
      'service-tab-new',
    ]);
  });

  it('maps originals/series/watchlist aliases onto existing lanes', () => {
    expect(laneFromCategory('originals')).toBe('new');
    expect(laneFromCategory('series')).toBe('shows');
    expect(laneFromCategory('kids')).toBe('kids');
    expect(laneFromCategory('watchlist')).toBe('list');
    expect(laneFromCategory('mylist')).toBe('list');
  });

  it('filters movies, series, originals, and brand collections without dead ends', () => {
    const hub = disneyFallbackHub();
    const originals = originalIdsFrom(hub);
    const film = TITLES.find((title) => title.kind === 'movie');
    const show = TITLES.find((title) => title.kind === 'series');
    expect(film).toBeDefined();
    expect(show).toBeDefined();
    if (film === undefined || show === undefined) return;
    expect(disneyTitleMatches(film, 'movies', originals)).toBe(true);
    expect(disneyTitleMatches(show, 'movies', originals)).toBe(false);
    expect(disneyTitleMatches(show, 'shows', originals)).toBe(true);

    const endgame = TITLES.find((title) => title.id === 'endgame');
    const mandalorian = TITLES.find((title) => title.id === 'the-mandalorian');
    if (endgame !== undefined) expect(disneyBrandMatches(endgame, 'marvel')).toBe(true);
    if (mandalorian !== undefined) expect(disneyBrandMatches(mandalorian, 'starwars')).toBe(true);
    expect(pickBrandTitles(TITLES, 'pixar').length).toBeGreaterThan(0);

    for (const lane of ['home', 'movies', 'shows', 'new', 'kids', 'list'] as const) {
      const rails = buildDisneyRails(hub, lane, [], null);
      expect(rails.some((rail) => rail.titles.length > 0)).toBe(true);
    }
    expect(buildDisneyRails(hub, 'home', [], 'marvel').some((rail) => rail.titles.length > 0)).toBe(true);
    expect(buildDisneyRails(hub, 'list', TITLES.slice(0, 2), null)[0]?.id).toBe('disney-watchlist');
  });

  it('keeps Play / Resume on the hero and Details as the info path', () => {
    const film = TITLES.find((title) => title.kind === 'movie');
    expect(film).toBeDefined();
    if (film === undefined) return;
    expect(disneyPlayLabel(film)).toBe('Play');
    expect(disneyPlayLabel({ ...film, progress: 0.25 })).toBe('Resume');
    expect(disneyHeroBadge('home', null)).toBe('Now Streaming');
    expect(disneyHeroBadge('new', null)).toBe('Disney+ Original');
    expect(disneyHeroBadge('home', 'marvel')).toBe('Marvel');
  });

  it('wraps focus at both ends of a row', () => {
    expect(wrapHubFocus('right', 4, 5, 'd-1', 'd-5')).toBe('d-1');
    expect(wrapHubFocus('left', 0, 5, 'd-1', 'd-5')).toBe('d-5');
    const orbs = disneyNavItems().map((item) => item.id);
    expect(wrapHubFocus('right', orbs.length - 1, orbs.length, orbs[0] ?? '', orbs[orbs.length - 1] ?? '')).toBe(
      orbs[0],
    );
    expect(wrapHubFocus('left', 0, orbs.length, orbs[0] ?? '', orbs[orbs.length - 1] ?? '')).toBe(orbs[orbs.length - 1]);
  });

  it('loops rail cards last to first on the conveyor', () => {
    const ids = disneyCardIds('disney-films', TITLES.slice(0, 5));
    expect(ids).toHaveLength(5);
    expect(wrapHubFocus('right', ids.length - 1, ids.length, ids[0] ?? '', ids[ids.length - 1] ?? '')).toBe(ids[0]);
    expect(wrapHubFocus('left', 0, ids.length, ids[0] ?? '', ids[ids.length - 1] ?? '')).toBe(ids[ids.length - 1]);
  });

  it('keeps conveyor clone ids off the focusable copy so selection can land', () => {
    expect(disneyCardId('disney-films', 'avatar')).toBe('disney-films-avatar');
    expect(disneyCardId('disney-films', 'avatar', 1)).toBe('disney-films-avatar');
    expect(disneyCardId('disney-films', 'avatar', 0)).toBe('disney-films-avatar--0');
    expect(disneyCardId('disney-films', 'avatar', 2)).toBe('disney-films-avatar--2');
  });

  it('caps rails so the circular hub stays snappy', () => {
    const seed = TITLES[0];
    expect(seed).toBeDefined();
    if (seed === undefined) return;
    const fat = Array.from({ length: DISNEY_RAIL_CAP + 12 }, (_, index) => ({
      ...seed,
      id: `disney-cap-${index}`,
    }));
    expect(capDisneyRail(fat)).toHaveLength(DISNEY_RAIL_CAP);
    expect(buildDisneyRails(disneyFallbackHub(), 'home', fat, null).every((rail) => rail.titles.length <= DISNEY_RAIL_CAP)).toBe(
      true,
    );
  });

  it('plays movies through TVM and opens series details', () => {
    const film = TITLES.find((title) => title.kind === 'movie');
    const show = TITLES.find((title) => title.kind === 'series');
    expect(film).toBeDefined();
    expect(show).toBeDefined();
    if (film === undefined || show === undefined) return;
    expect(disneyActivateTarget(film)).toBe('player');
    expect(disneyActivateTarget(show)).toBe('details');
    const played: string[] = [];
    const opened: string[] = [];
    expect(activateDisneyTitle(film, (title) => played.push(title.id), (title) => opened.push(title.id))).toBe('player');
    expect(activateDisneyTitle(show, (title) => played.push(title.id), (title) => opened.push(title.id))).toBe('details');
    expect(played).toEqual([film.id]);
    expect(opened).toEqual([show.id]);
  });
});
