import { afterEach, describe, expect, it, vi } from 'vitest';
import { chosenVersion, chooseVersion, fetchPlaybackVersions, orderVersions, playbackKey, qualityBadges, type Version } from './playbackVersions';
import { applyRemoteFlags, readPolishPrefs } from './polishPrefs';
import { episodeIsWatched, isPhoneApp, uiExtraEnabled } from './uiExtras';
import { asTitle, requestPlayback, toMediaItem } from './media';

afterEach(() => { applyRemoteFlags({}); chooseVersion({ id: 'tt123', season: 2, episode: 3 }, undefined); vi.unstubAllGlobals(); });
describe('version ordering and selection', () => {
  it('moves recommended versions first and preserves Core order within each group', () => {
    const versions = [{ id: 'a' }, { id: 'b', recommended: true }, { id: 'c' }, { id: 'd', recommended: true }] as Version[];
    expect(orderVersions(versions).map((v) => v.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(versions[0]?.id).toBe('a');
  });
  it('shares episode identities across Details and the player, without leaking a choice to another episode', () => {
    chooseVersion({ id: 'tt123', season: 2, episode: 3 }, 'large');
    expect(playbackKey({ id: 'tt123:2:3' })).toBe('tt123|2|3');
    expect(chosenVersion({ id: 'tt123:2:3' })).toBe('large');
    expect(chosenVersion({ id: 'tt123:2:4' })).toBeUndefined();
    chooseVersion({ id: 'tt123:2:3' }, undefined);
    expect(chosenVersion({ id: 'tt123:2:3' })).toBeUndefined();
  });
  it('silently returns no versions for missing and failed endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    expect(await fetchPlaybackVersions({ id: 'tt123:2:3' })).toEqual([]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchPlaybackVersions({ id: 'tt123' })).toEqual([]);
  });
  it('sends the chosen episode version and preserves the requested resume position', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{"kind":"unavailable","reason":"empty"}')));
    vi.stubGlobal('fetch', fetch);
    chooseVersion({ id: 'tt123', season: 2, episode: 3 }, 'large');
    await requestPlayback({ id: 'tt123:2:3', season: 2, episode: 3, startAt: 1234 });
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ versionId: 'large', startAt: 1234 });
    applyRemoteFlags({ versionPicker: false });
    await requestPlayback({ id: 'tt123:2:3', startAt: 1234, versionId: 'explicit' });
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).not.toHaveProperty('versionId');
  });
  it('requests separate season and episode parameters with an unqualified IMDb id', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"versions":[]}'));
    vi.stubGlobal('fetch', fetch);
    await fetchPlaybackVersions({ id: 'tt123:2:3' });
    const url = new URL(fetch.mock.calls[0]![0], 'http://localhost');
    expect(Object.fromEntries(url.searchParams)).toEqual({ id: 'tt123', season: '2', episode: '3' });
  });
});
describe('Extras gating and badges', () => {
  it('honours the preference and remote kill switch, including default-off extras', () => {
    const prefs = readPolishPrefs();
    expect(uiExtraEnabled('themeSongs', prefs, false)).toBe(false);
    expect(uiExtraEnabled('sleepTimer', prefs, false)).toBe(true);
    expect(uiExtraEnabled('sleepTimer', { ...prefs, extras: { sleepTimer: false } }, false)).toBe(false);
    applyRemoteFlags({ sleepTimer: false });
    expect(uiExtraEnabled('sleepTimer', prefs, false)).toBe(false);
  });
  it('excludes desktop-only extras in both phone shells', () => {
    expect(isPhoneApp('Test TVM-iOS/1.4')).toBe(true);
    expect(isPhoneApp('TVM-Android')).toBe(true);
    expect(isPhoneApp('Mozilla Safari')).toBe(false);
    const prefs = readPolishPrefs();
    for (const id of ['pauseOnMinimize', 'shortcutsOverlay', 'trailerBackdrops', 'themeSongs'] as const) {
      expect(uiExtraEnabled(id, { ...prefs, extras: { [id]: true } }, true)).toBe(false);
    }
    expect(uiExtraEnabled('sleepTimer', prefs, true)).toBe(true);
  });
  it('shows only known quality facts', () => {
    expect(qualityBadges()).toEqual([]);
    expect(qualityBadges({ height: 1080 })).toEqual([]);
    expect(qualityBadges({ height: 2160, hdr: 'dv', audio: { atmos: true } })).toEqual(['4K', 'DV', 'Atmos']);
    expect(qualityBadges({ hdr: 'hdr10' })).toEqual(['HDR']);
  });
  it('preserves already-known quality metadata through catalog conversion', () => {
    const item = { id: 'tt999999', title: 'Test title', year: 2026, kind: 'movie' as const, synopsis: '', poster: '',
      backdrop: '', genres: [], rating: '', playable: true, hue: 0, height: 2160, hdr: 'dv' as const, audio: { atmos: true } };
    expect(qualityBadges(asTitle(item))).toEqual(['4K', 'DV', 'Atmos']);
    expect(qualityBadges(toMediaItem(asTitle(item)))).toEqual(['4K', 'DV', 'Atmos']);
  });
  it('does not reveal unwatched episodes based on partial progress', () => {
    expect(episodeIsWatched({})).toBe(false);
    expect(episodeIsWatched({ progress: 0.95 })).toBe(false);
    expect(episodeIsWatched({ progress: 0.97 })).toBe(true);
    expect(episodeIsWatched({ watched: true })).toBe(true);
    expect(episodeIsWatched({ watched: false, progress: 1 })).toBe(false);
  });
});
