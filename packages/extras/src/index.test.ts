import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExtras, emptySegments, isSubtitleUrl, subtitleToVtt } from './index.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const binding = (value: string) => ({ value });
afterEach(() => { vi.useRealTimers(); });

describe('shared extras (mocked fetch)', () => {
  it('maps IMDb through the right Wikidata property and normalizes IntroDB milliseconds', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('wikidata')
      ? json({ results: { bindings: [{ tmdb: binding('1396') }] } })
      : json({ intro: [{ start_ms: 228665, end_ms: 246498 }], recap: [{ start_ms: null, end_ms: 18000 }], credits: [{ start_ms: 3432884, end_ms: null }] }));
    const client = createExtras({ fetch: fetcher });
    const result = await client.segments({ id: 'tt0903747', season: 1, episode: 1 });
    expect(result).toEqual({ intro: { start: 228.665, end: 246.498 }, recap: { start: 0, end: 18 }, credits: { start: 3432.884, end: null }, source: 'theintrodb' });
    expect(decodeURIComponent(String(fetcher.mock.calls[0]?.[0]))).toContain('wdt:P4983');
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('season=1&episode=1');
    await client.segments({ id: 'tt0903747', season: 1, episode: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses film identifiers and rejects malformed ranges and untrusted IMDb input', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('wikidata')
      ? json({ results: { bindings: [{ tmdb: binding('157336') }] } })
      : json({ intro: [{ start_ms: -1, end_ms: 100 }, { start_ms: 100, end_ms: 100 }], recap: [{ start_ms: 1, end_ms: null }] }));
    const client = createExtras({ fetch: fetcher });
    expect(await client.segments({ id: 'tt0816692' })).toEqual(emptySegments());
    expect(decodeURIComponent(String(fetcher.mock.calls[0]?.[0]))).toContain('wdt:P4947');
    await client.segments({ id: 'tt1". } SERVICE <http://localhost> {' });
    await client.segments({ id: 'tt0903747', season: -1, episode: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('falls back to AniList/AniSkip even if Wikidata fails and preserves seconds', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes('wikidata')) throw new Error('offline');
      if (String(url).includes('cinemeta')) return json({});
      if (String(url).includes('anilist')) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body)).variables.search).toBe('Jujutsu Kaisen');
        return json({ data: { Media: { idMal: 40748, title: { english: 'JUJUTSU KAISEN' } } } });
      }
      expect(String(url)).toContain('/40748/1?types[]=op&types[]=ed&types[]=recap');
      return json({ results: [
        { skipType: 'op', interval: { startTime: 54.711, endTime: 145.111 } },
        { skipType: 'ed', interval: { startTime: 1338.255, endTime: 1428.255 } },
        { skipType: 'recap', interval: { startTime: 0, endTime: 12 } },
        { skipType: 'op', interval: { startTime: -1, endTime: 1 } },
      ] });
    });
    const result = await createExtras({ fetch: fetcher }).segments({ id: 'tt12343534', season: 1, episode: 1, anime: true, title: 'Jujutsu Kaisen' });
    expect(result).toEqual({ intro: { start: 54.711, end: 145.111 }, recap: { start: 0, end: 12 }, credits: { start: 1338.255, end: 1428.255 }, source: 'aniskip' });
  });

  it('does not call anime services when primary timestamps exist', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('wikidata')
      ? json({ results: { bindings: [{ tmdb: binding('95479') }] } }) : json({ intro: [{ start_ms: 1000, end_ms: 90000 }] }));
    expect((await createExtras({ fetch: fetcher }).segments({ id: 'tt12343534', season: 1, episode: 1, anime: true, title: 'Jujutsu Kaisen' })).source).toBe('theintrodb');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('deduplicates subtitles by canonical language, respects ranking and sorts preferences', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ subtitles: [
      { id: 'bad', lang: 'eng', url: 'https://strem.io.evil.test/a' },
      { id: 'fr', lang: 'fre', url: 'https://subs5.strem.io/a' },
      { id: 'en-best', lang: 'eng', url: 'https://subs5.strem.io/b' },
      { id: 'en-later', lang: 'eng', url: 'https://subs5.strem.io/c' },
      { id: 'de', lang: 'ger', url: 'https://subs.strem.io/d' },
    ] }));
    const c = createExtras({ fetch: fetcher });
    const list = await c.subtitles({ id: 'tt0903747', season: 1, episode: 1 }, ['en', 'fr']);
    expect(list.map(s => s.id)).toEqual(['en-best', 'fr', 'de']);
    expect(list.map(s => s.language)).toEqual(['eng', 'fra', 'deu']);
    expect(list[0]?.url).toBe('/api/extras/subtitle.vtt?u=https%3A%2F%2Fsubs5.strem.io%2Fb');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/series/tt0903747:1:1.json');
    expect((await c.subtitles({ id: 'tt0903747', season: 1, episode: 1 }, ['de']))[0]?.language).toBe('deu');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('converts SRT UTF-8 and CP1252 into VTT without damaging cue commas', () => {
    const utf = new TextEncoder().encode('\uFEFF1\r\n00:00:01,200 --> 00:00:02,999\r\nHello, world\r\n');
    expect(subtitleToVtt(utf.buffer)).toBe('WEBVTT\n\n1\n00:00:01.200 --> 00:00:02.999\nHello, world\n');
    const legacy = new Uint8Array([...new TextEncoder().encode('1\n00:00:00,000 --> 00:00:02,000\nCaf'), 0xe9]);
    expect(subtitleToVtt(legacy.buffer)).toContain('Café');
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n';
    expect(subtitleToVtt(new TextEncoder().encode(vtt).buffer)).toBe(vtt);
    expect(subtitleToVtt(new TextEncoder().encode('<html>Error</html>').buffer)).toBe('WEBVTT\n\n');
  });

  it('restricts proxy hosts, credentials, ports, redirects and oversized bodies', async () => {
    for (const url of ['http://subs5.strem.io/a', 'https://strem.io.evil/a', 'https://evil-strem.io/a', 'https://user@subs5.strem.io/a', 'https://subs5.strem.io:444/a', 'http://127.0.0.1/', 'file:///a']) expect(isSubtitleUrl(url)).toBe(false);
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.redirect).toBe('error');
      return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } });
    });
    const c = createExtras({ fetch: fetcher });
    expect(await c.subtitleVtt('http://127.0.0.1/')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await c.subtitleVtt('https://subs5.strem.io/a')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await createExtras({ fetch: async () => new Response('x', { headers: { 'content-length': '2000001' } }) }).subtitleVtt('https://subs5.strem.io/b')).toBeNull();
  });

  it('fetches VTT once and keeps safe source text', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('1\n00:00:01,000 --> 00:00:02,000\nHello'));
    const c = createExtras({ fetch: fetcher });
    expect(await c.subtitleVtt('https://subs5.strem.io/a')).toContain('00:00:01.000');
    await c.subtitleVtt('https://subs5.strem.io/a');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('extracts only valid YouTube ids and tolerates one failed Cinemeta kind', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('/movie/') ? json({}, 404) : json({ meta: { trailers: [{ source: 'VFkjBy2b50Q', type: 'Trailer' }, { source: 'VFkjBy2b50Q' }, { source: 'javascript:bad' }] } }));
    expect(await createExtras({ fetch: fetcher }).trailers('tt0903747')).toEqual([{ youtubeId: 'VFkjBy2b50Q', name: 'Trailer' }]);
  });

  it('keeps collection release order, removes duplicates and chooses a specific trilogy', async () => {
    const records = [
      ['all', 'Saga', 'tt0000001'], ['trilogy', 'Original trilogy', 'tt0076759'],
      ['all', 'Saga', 'tt0076759'], ['trilogy', 'Original trilogy', 'tt0080684'],
      ['all', 'Saga', 'tt0080684'], ['trilogy', 'Original trilogy', 'tt0086190'],
      ['all', 'Saga', 'tt0086190'], ['trilogy', 'Original trilogy', 'tt0086190'],
    ].map(([c, label, imdb]) => ({ collection: binding(c!), collectionLabel: binding(label!), imdb: binding(imdb!) }));
    const c = createExtras({ fetch: async () => json({ results: { bindings: records } }) });
    expect(await c.collection('tt0076759')).toEqual({ name: 'Original trilogy', ids: ['tt0076759', 'tt0080684', 'tt0086190'] });
  });

  it('caches TVmaze ids and handles absent embeds for ended shows', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('/lookup/') ? json({ id: 169 }) : json({ _embedded: { nextepisode: { season: 6, number: 1, name: 'Return', airstamp: '2026-11-27T20:00:00Z' } } }));
    const c = createExtras({ fetch: fetcher });
    expect(await c.upcoming('tt0903747')).toEqual({ season: 6, episode: 1, name: 'Return', airstamp: '2026-11-27T20:00:00Z' });
    await c.upcoming('tt0903747');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await createExtras({ fetch: async url => json(String(url).includes('/lookup/') ? { id: 169 } : {}) }).upcoming('tt0903747')).toBeNull();
  });

  it('shares concurrent calls, aborts on deadline, and retries failures after a short cache', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const c = createExtras({ fetch: fetcher });
    const pending = Promise.all([c.animeTitle('Example'), c.animeTitle('Example')]);
    await vi.advanceTimersByTimeAsync(6001);
    expect(await pending).toEqual([{ english: null, malId: null }, { english: null, malId: null }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await c.animeTitle('Example');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(61_000);
    const retry = c.animeTitle('Example');
    await vi.advanceTimersByTimeAsync(6001);
    await retry;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('times out while reading a stalled body as well as awaiting headers', async () => {
    vi.useFakeTimers();
    const c = createExtras({ fetch: async () => new Response(new ReadableStream({ start() {} })) });
    const pending = c.animeTitle('Example');
    await vi.advanceTimersByTimeAsync(6001);
    expect(await pending).toEqual({ english: null, malId: null });
  });
});
