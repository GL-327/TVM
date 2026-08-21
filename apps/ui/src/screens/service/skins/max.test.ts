import { describe, expect, it } from 'vitest';
import { TITLES } from '../../../data/catalog';
import {
  activateMaxTitle,
  buildMaxRails,
  isSportsTitle,
  laneFromCategory,
  maxActionIds,
  maxCardId,
  maxCardIds,
  maxFallbackHub,
  maxHeroKicker,
  maxMoreLabel,
  maxNavIds,
  maxPlayLabel,
  maxRowCameraTop,
  MAX_TABS,
  maxTitleMatches,
  wrapHubFocus,
} from './max';

describe('Max hub skin', () => {
  it('uses Home / Series / Movies / Sports / My Stuff on Lane ids the dispatcher already knows', () => {
    expect(MAX_TABS.map((tab) => tab.label)).toEqual(['Home', 'Series', 'Movies', 'Sports', 'My Stuff']);
    expect(MAX_TABS.map((tab) => tab.id)).toEqual(['home', 'shows', 'movies', 'new', 'list']);
    expect(maxNavIds()).toEqual([
      'service-back',
      'service-tab-home',
      'service-tab-shows',
      'service-tab-movies',
      'service-tab-new',
      'service-tab-list',
      'service-search',
    ]);
    expect(maxActionIds()).toEqual(['service-play', 'service-info']);
  });

  it('maps sports/series/mystuff aliases onto existing lanes', () => {
    expect(laneFromCategory('sports')).toBe('new');
    expect(laneFromCategory('series')).toBe('shows');
    expect(laneFromCategory('home')).toBe('home');
    expect(laneFromCategory('mystuff')).toBe('list');
    expect(laneFromCategory('my-list')).toBe('list');
  });

  it('keeps sports titles on the Sports lane and still fills the row', () => {
    const smackdown = TITLES.find((title) => title.id === 'smackdown');
    const dune = TITLES.find((title) => title.id === 'dune-part-two');
    expect(smackdown).toBeDefined();
    expect(dune).toBeDefined();
    if (smackdown === undefined || dune === undefined) return;
    expect(isSportsTitle(smackdown)).toBe(true);
    expect(maxTitleMatches(smackdown, 'new')).toBe(true);
    expect(maxTitleMatches(dune, 'movies')).toBe(true);
    expect(maxTitleMatches(dune, 'shows')).toBe(false);
    expect(maxHeroKicker(smackdown)).toBe('Sports');
  });

  it('never leaves a category rail empty', () => {
    const hub = maxFallbackHub();
    for (const lane of ['home', 'shows', 'movies', 'new', 'list'] as const) {
      const rails = buildMaxRails(hub, lane, []);
      expect(rails.length).toBeGreaterThan(0);
      expect(rails.some((rail) => rail.titles.length > 0)).toBe(true);
    }
    expect(buildMaxRails(hub, 'new', []).some((rail) => rail.titles.some(isSportsTitle))).toBe(true);
    expect(buildMaxRails(hub, 'list', TITLES.slice(0, 3))[0]?.id).toBe('max-mystuff');
  });

  it('keeps Play / Resume and details copy on the hero path', () => {
    const film = TITLES.find((title) => title.kind === 'movie');
    const show = TITLES.find((title) => title.kind === 'series');
    expect(film).toBeDefined();
    expect(show).toBeDefined();
    if (film === undefined || show === undefined) return;
    expect(maxPlayLabel(film)).toBe('Play');
    expect(maxPlayLabel({ ...film, progress: 0.4 })).toBe('Resume');
    expect(maxMoreLabel(show)).toBe('Go to Series');
    expect(maxMoreLabel(film)).toBe('More Info');
  });

  it('wraps focus at both ends of a looping rail', () => {
    expect(wrapHubFocus('right', 3, 4, 'max-a', 'max-d')).toBe('max-a');
    expect(wrapHubFocus('left', 0, 4, 'max-a', 'max-d')).toBe('max-d');
    expect(wrapHubFocus('right', 1, 4, 'max-a', 'max-d')).toBeNull();
    const ids = maxCardIds('max-films', TITLES.slice(0, 3));
    expect(ids).toHaveLength(3);
    expect(wrapHubFocus('right', 2, ids.length, ids[0] ?? '', ids[2] ?? '')).toBe(ids[0]);
    expect(wrapHubFocus('left', 0, ids.length, ids[0] ?? '', ids[2] ?? '')).toBe(ids[2]);
  });

  it('pins a focused row under the Max nav (down camera)', () => {
    expect(maxRowCameraTop(0, 640, 0, 72)).toBe(568);
    expect(maxRowCameraTop(200, 80, 0, 66)).toBe(214);
    expect(maxRowCameraTop(0, 40, 0, 66)).toBe(0);
  });

  it('plays films in TVM Stream and opens series in details', () => {
    const film = TITLES.find((title) => title.kind === 'movie');
    const show = TITLES.find((title) => title.kind === 'series');
    expect(film).toBeDefined();
    expect(show).toBeDefined();
    if (film === undefined || show === undefined) return;
    const played: string[] = [];
    const opened: string[] = [];
    expect(activateMaxTitle(film, (title) => played.push(title.id), (title) => opened.push(title.id))).toBe('player');
    expect(activateMaxTitle(show, (title) => played.push(title.id), (title) => opened.push(title.id))).toBe('details');
    expect(played).toEqual([film.id]);
    expect(opened).toEqual([show.id]);
  });

  it('keeps conveyor copies off the focus map', () => {
    expect(maxCardId('max-films', 'dune-part-two')).toBe('max-films-dune-part-two');
    expect(maxCardId('max-films', 'dune-part-two', 1)).toBe('max-films-dune-part-two');
    expect(maxCardId('max-films', 'dune-part-two', 0)).toBe('max-films-dune-part-two--0');
    expect(maxCardId('max-films', 'dune-part-two', 2)).toBe('max-films-dune-part-two--2');
  });
});
