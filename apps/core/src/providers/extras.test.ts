import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoreExtras, extrasRoute, writeExtrasPrefs } from './extras.ts';
import { createMediaService } from './media.ts';
import { createRealDebrid } from './realdebrid.ts';
import { readProgress, writeProgress } from './progress.ts';
import { addWatchlist } from './watchlist.ts';
import { readPrefs, writePrefs } from '../prefs.ts';
import { DEFAULT_PREFS } from '../prefs.ts';
import { startCoreServer } from '../server.ts';
import type { MediaItem, PlaybackResolution } from './types.ts';

const json = (data: unknown) => new Response(JSON.stringify(data));
const item = (id: string, kind: MediaItem['kind'] = 'series', genres = ['Drama']): MediaItem => ({ id, title: `Title ${id}`, kind, genres, year: 2026,
  synopsis: '', poster: '', backdrop: '', rating: '', playable: true, hue: 210 });
const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
async function fixture(fetcher: typeof fetch = async () => json({})) {
  const dir = await mkdtemp(join(tmpdir(), 'tvm-extras-'));
  dirs.push(dir);
  let scope = join(dir, 'profiles', 'first');
  let at = Date.parse('2026-11-25T12:00:00Z');
  const filter = vi.fn(async (items: MediaItem[]) => items);
  const lookup = vi.fn(async (id: string) => item(id));
  const extras = createCoreExtras({ dataDir: dir, scope: () => scope, now: () => at, fetch: fetcher, filter: () => filter, item: lookup });
  return { dir, extras, filter, lookup, scope: () => scope, switch: () => { scope = join(dir, 'profiles', 'second'); }, advance: (ms: number) => { at += ms; } };
}

describe('Core Extras', () => {
  it('dispatches every specified endpoint and hides unavailable upstream data', async () => {
    const f = await fixture();
    for (const [path, expected] of [
      ['segments', { intro: null, recap: null, credits: null, source: null }],
      ['subtitles', { subtitles: [] }], ['trailers', { trailers: [] }],
      ['collection', { name: null, items: [] }], ['upcoming', { next: null }],
      ['upcoming/home', { items: [] }], ['anime-title', { english: null, malId: null }],
    ] as const) {
      expect(await extrasRoute(f.extras, `/api/extras/${path}`, 'GET', new URLSearchParams({ id: 'tt0903747', title: 'Breaking Bad' }))).toEqual({ status: 200, body: expected });
    }
    expect((await extrasRoute(f.extras, '/api/extras/stats', 'GET', new URLSearchParams()))?.body).toMatchObject({ all: 0, history: [] });
    expect(await extrasRoute(f.extras, '/api/extras/stats/clear', 'POST', new URLSearchParams())).toEqual({ status: 204, body: null });
    expect(await extrasRoute(f.extras, '/api/extras/subtitle.vtt', 'GET', new URLSearchParams({ u: 'https://evil.test/' }))).toEqual({ status: 400, body: { error: 'invalid_subtitle_url' } });
    expect(await extrasRoute(f.extras, '/api/extras/subtitle.vtt', 'GET', new URLSearchParams({ u: 'https://subs5.strem.io/a' }))).toEqual({ status: 200, text: 'WEBVTT\n\n' });
    expect(await extrasRoute(f.extras, '/api/extras/unknown', 'GET', new URLSearchParams())).toBeNull();
  });

  it('primes and applies the active age filter to collections and hides a single allowed film', async () => {
    const f = await fixture(async () => json({ results: { bindings: ['tt0076759', 'tt0080684', 'tt0086190'].map(imdb => ({ collection: { value: 'Q17738' }, collectionLabel: { value: 'Star Wars' }, imdb: { value: imdb } })) } }));
    f.lookup.mockImplementation(async id => item(id, 'movie'));
    f.filter.mockImplementation(async items => items.filter(i => i.id !== 'tt0086190'));
    expect((await f.extras.collection('tt0076759')).items.map(i => i.id)).toEqual(['tt0076759', 'tt0080684']);
    f.filter.mockImplementation(async items => items.slice(0, 1));
    expect(await f.extras.collection('tt0076759')).toEqual({ name: null, items: [] });
    expect(f.filter).toHaveBeenCalledTimes(2);
  });

  it('deduplicates watchlist and Continue watching, filters age, and bounds upcoming to seven days', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => {
      const s = String(url);
      if (s.includes('/lookup/')) return json({ id: Number(s.match(/tt0*(\d+)/)?.[1]) });
      const id = Number(s.match(/shows\/(\d+)/)?.[1]);
      const airstamp = id === 9000002 ? '2026-12-10T12:00:00Z' : '2026-11-26T12:00:00Z';
      return json({ _embedded: { nextepisode: { season: 2, number: 1, name: 'Next', airstamp } } });
    });
    const f = await fixture(fetcher);
    addWatchlist(f.scope(), item('tt9000001'));
    addWatchlist(f.scope(), item('tt9000002'));
    addWatchlist(f.scope(), item('tt9000003'));
    addWatchlist(f.scope(), item('tt9000004', 'movie'));
    writeProgress(f.scope(), 'tt9000001:1:1', 100, 1000);
    f.filter.mockImplementation(async items => items.filter(i => i.id !== 'tt9000003'));
    expect((await f.extras.upcomingHome()).items.map(e => e.item.id)).toEqual(['tt9000001']);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(f.lookup).toHaveBeenCalledTimes(3);
    expect(await f.extras.upcoming('tt9000003')).toEqual({ next: null });
    f.switch();
    expect(await f.extras.upcomingHome()).toEqual({ items: [] });
  });

  it('keeps stats local, avoids seek inflation, isolates profiles, and clears without deleting Continue watching', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('stats must not call upstream'); });
    const f = await fixture(fetcher);
    const id = 'tt0903747:1:1';
    f.extras.remember({ ...item(id), title: 'Breaking Bad', genres: ['Drama', 'Crime'] });
    f.extras.recordProgress(id, 20, 1000);
    writeProgress(f.scope(), id, 20, 1000);
    f.advance(10_000);
    f.extras.recordProgress(id, 900, 1000, { position: 20, duration: 1000, updated: '2026-11-25T12:00:00Z' });
    const stats = f.extras.stats();
    expect(stats.all).toBe(32);
    expect(stats.week).toBe(32);
    expect(stats.month).toBe(32);
    expect(stats.streakDays).toBe(1);
    expect(stats.topGenres).toContainEqual({ genre: 'Drama', seconds: 32 });
    expect(stats.history[0]?.item.title).toBe('Breaking Bad');
    expect(fetcher).not.toHaveBeenCalled();
    f.extras.clearStats();
    expect(f.extras.stats()).toMatchObject({ all: 0, history: [] });
    expect(readProgress(f.scope())[id]?.position).toBe(20);
    f.switch();
    expect(f.extras.stats().all).toBe(0);
  });

  it('migrates progress once and calculates calendar totals, completed titles, and a consecutive streak', async () => {
    const f = await fixture();
    await writeFile(join(f.dir, 'old-progress-unused.json'), '{}');
    // Plain legacy progress is supported by the existing privateJson migration.
    const fs = await import('node:fs/promises');
    await fs.mkdir(f.scope(), { recursive: true });
    await fs.writeFile(join(f.scope(), 'progress.json'), JSON.stringify({
      first: { position: 100, duration: 100, updated: '2026-11-24T12:00:00Z', completedTitle: 'First' },
      second: { position: 100, duration: 1000, updated: '2026-11-23T12:00:00Z' },
      old: { position: 200, duration: 1000, updated: '2026-10-10T12:00:00Z' },
    }));
    expect(f.extras.stats()).toMatchObject({ week: 200, month: 200, all: 400, finished: 1, streakDays: 2 });
    expect(f.extras.stats().all).toBe(400);
    f.extras.clearStats();
    const reopened = createCoreExtras({ dataDir: f.dir, scope: f.scope, filter: () => f.filter, item: f.lookup });
    expect(reopened.stats().all).toBe(0);
  });

  it('returns fast subtitles and existing tracks while slow segments finish after the playback budget', async () => {
    vi.useFakeTimers();
    const f = await fixture(async url => {
      if (String(url).includes('opensubtitles')) return json({ subtitles: [{ id: 'en', lang: 'eng', url: 'https://subs5.strem.io/a' }] });
      return new Promise(() => {});
    });
    const result: PlaybackResolution = { kind: 'stream', url: 'https://example.com/a.mp4', title: 'Film', filename: 'a.mp4', mimeType: 'video/mp4', engine: 'html5', subtitles: [{ label: 'Existing', language: 'spa', url: '/old' }] };
    const promise = f.extras.enrichPlayback(result, { id: 'tt0816692' });
    await vi.advanceTimersByTimeAsync(1451);
    const enriched = await promise;
    expect(enriched.kind === 'stream' && enriched.subtitles?.map(s => s.language)).toEqual(['spa', 'eng']);
    expect(enriched.segments).toEqual({ intro: null, recap: null, credits: null, source: null });
    await vi.advanceTimersByTimeAsync(20_000);
  });

  it('keeps warmed public results on disk across instances, without storing profile history in that cache', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('subs5.strem.io')
      ? new Response('1\n00:00:01,000 --> 00:00:02,000\nHello')
      : json({ data: { Media: { idMal: 40748, title: { english: 'JUJUTSU KAISEN' } } } }));
    const f = await fixture(fetcher);
    await f.extras.client.animeTitle('Jujutsu Kaisen');
    await f.extras.client.subtitleVtt('https://subs5.strem.io/a');
    const second = createCoreExtras({ dataDir: f.dir, scope: f.scope, fetch: fetcher, now: () => Date.parse('2026-11-25T12:00:00Z'), filter: () => f.filter, item: f.lookup });
    expect(await second.client.animeTitle('Jujutsu Kaisen')).toEqual({ english: 'JUJUTSU KAISEN', malId: 40748 });
    expect(await second.client.subtitleVtt('https://subs5.strem.io/a')).toContain('00:00:01.000');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('validates new preferences and remembers the chosen subtitle language separately per profile', async () => {
    const f = await fixture();
    expect(readPrefs(f.dir)).toEqual(DEFAULT_PREFS);
    writeExtrasPrefs(f.dir, f.extras, { skipSegments: 'auto', autoplayNext: false, heroPreviews: false, subtitleLanguages: ['fra', 'eng'] });
    expect(readPrefs(f.dir)).toMatchObject({ skipSegments: 'auto', autoplayNext: false, heroPreviews: false });
    f.switch();
    writeExtrasPrefs(f.dir, f.extras, { subtitleLanguages: ['jpn'] });
    expect(f.extras.languages()[0]).toBe('jpn');
    const first = createCoreExtras({ dataDir: f.dir, scope: () => join(f.dir, 'profiles', 'first'), filter: () => f.filter, item: f.lookup });
    expect(first.languages()[0]).toBe('fra');
    expect(writePrefs(f.dir, { skipSegments: 'bad', subtitleLanguages: [null, 'javascript:x', 'eng', 'eng'] } as never)).toMatchObject({ skipSegments: 'auto', subtitleLanguages: ['eng'] });
  });

  it('uses media certificate ages rather than genres for collection and upcoming visibility', async () => {
    const f = await fixture();
    const fetcher = vi.fn<typeof fetch>(async url => {
      const u = new URL(String(url));
      const query = u.searchParams.get('query') ?? '';
      if (query.includes('bbfcLabel')) return json({ results: { bindings: ['tt0076759', 'tt0080684', 'tt0086190'].map((imdb, i) => ({ imdb: { value: imdb }, bbfcLabel: { value: i === 2 ? '18' : 'PG' } })) } });
      if (query.includes('collection')) return json({ results: { bindings: ['tt0076759', 'tt0080684', 'tt0086190'].map(imdb => ({ collection: { value: 'Q17738' }, collectionLabel: { value: 'Star Wars' }, imdb: { value: imdb } })) } });
      if (u.hostname.includes('cinemeta')) {
        const id = u.pathname.match(/(tt\d+)/)?.[1];
        return json(u.pathname.includes('/series/') ? {} : { meta: { id, name: 'Film', genre: ['Horror'] } });
      }
      return json({});
    });
    const media = createMediaService({ dataDir: f.dir, rd: createRealDebrid({ dataDir: f.dir, env: {} }), fetch: fetcher });
    const adult = media.profiles().activeId;
    media.createProfile('Family', { maxAge: 12 });
    expect((await media.extras!.collection('tt0076759')).items.map(i => i.id)).toEqual(['tt0076759', 'tt0080684']);
    media.switchProfile(adult);
    expect((await media.extras!.collection('tt0076759')).items).toHaveLength(3);
  });

  it('bounds cold collection metadata and the endpoint to six seconds', async () => {
    vi.useFakeTimers();
    const f = await fixture(async () => json({ results: { bindings: ['tt0076759', 'tt0080684'].map(imdb => ({ collection: { value: 'Q17738' }, imdb: { value: imdb } })) } }));
    f.lookup.mockImplementation(() => new Promise(() => {}));
    const pending = extrasRoute(f.extras, '/api/extras/collection', 'GET', new URLSearchParams({ id: 'tt0076759' }));
    await vi.advanceTimersByTimeAsync(6001);
    expect(await pending).toEqual({ status: 200, body: { name: null, items: [] } });
  });

  it('routes real HTTP responses, VTT content type, prefs, and 204 history clearing', async () => {
    const f = await fixture(async url => String(url).includes('subs5.strem.io') ? new Response('1\n00:00:01,000 --> 00:00:02,000\nHello') : json({}));
    const media = createMediaService({ dataDir: f.dir, rd: createRealDebrid({ dataDir: f.dir, env: {} }), fetch: async () => json({}) });
    media.extras = f.extras;
    const core = await startCoreServer(0, { dataDir: f.dir, env: {}, media });
    const base = `http://127.0.0.1:${core.port}`;
    try {
      const subs = await fetch(`${base}/api/extras/subtitles?id=tt0816692`);
      expect(subs.status).toBe(200);
      expect(await subs.json()).toEqual({ subtitles: [] });
      const vtt = await fetch(`${base}/api/extras/subtitle.vtt?u=${encodeURIComponent('https://subs5.strem.io/a')}`);
      expect(vtt.headers.get('content-type')).toContain('text/vtt');
      expect(await vtt.text()).toContain('00:00:01.000');
      const blocked = await fetch(`${base}/api/extras/subtitle.vtt?u=${encodeURIComponent('http://127.0.0.1/')}`);
      expect(blocked.status).toBe(400);
      const prefs = await fetch(`${base}/api/prefs`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skipSegments: 'off', subtitleLanguages: ['jpn'], heroPreviews: false }) });
      expect(await prefs.json()).toMatchObject({ skipSegments: 'off', heroPreviews: false, subtitleLanguages: ['jpn'] });
      const cleared = await fetch(`${base}/api/extras/stats/clear`, { method: 'POST' });
      expect(cleared.status).toBe(204);
      expect(await cleared.text()).toBe('');
    } finally { await core.close(); }
  });
});
