import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearExtrasCache,
  clearExtrasStats,
  fetchExtrasAnimeTitle,
  fetchExtrasCollection,
  fetchExtrasSegments,
  fetchExtrasStats,
  fetchExtrasSubtitles,
  fetchExtrasTrailers,
  fetchExtrasUpcoming,
  fetchExtrasUpcomingHome,
  formatEpisodeCode,
  formatUpcomingDate,
  formatWatchDuration,
  isAnimeCandidate,
  shouldPlayHeroPreview,
  shouldShowAnimeEnglishTitle,
  visibleCollectionItems,
  youtubeEmbedUrl,
  youtubeWatchUrl,
  type HeroPreviewGuardInput,
} from './extras';
import type { MediaItem } from './media';

const makeItem = (id: string, title: string, genres: string[] = ['Action']): MediaItem => ({
  id,
  title,
  year: 2021,
  kind: 'movie',
  synopsis: '',
  poster: '',
  backdrop: '',
  genres,
  rating: 'PG-13',
  playable: true,
  hue: 200,
});

describe('extras API client and graceful 404/failure fallback', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearExtrasCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns empty or null gracefully when Core and upstream services both 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as unknown as typeof fetch;

    expect(await fetchExtrasSegments({ id: 'tt0816692' })).toEqual({
      intro: null,
      recap: null,
      credits: null,
      source: null,
    });
    expect(await fetchExtrasSubtitles({ id: 'tt0816692' })).toEqual([]);
    expect(await fetchExtrasTrailers('tt0816692')).toEqual([]);
    expect(await fetchExtrasCollection('tt0816692')).toEqual({ name: null, items: [] });
    expect(await fetchExtrasUpcoming('tt0903747')).toBeNull();
    expect(await fetchExtrasUpcomingHome()).toBeNull();
    expect(await fetchExtrasStats()).toBeNull();
    expect(await fetchExtrasAnimeTitle('Shingeki no Kyojin')).toEqual({ english: null, malId: null });
    expect(await clearExtrasStats()).toBe(false);
  });

  it('returns null gracefully without falling back when Core fails with 500', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    expect(await fetchExtrasSegments({ id: 'tt0816692' })).toBeNull();
    expect(await fetchExtrasSubtitles({ id: 'tt0816692' })).toBeNull();
    expect(await fetchExtrasTrailers('tt0816692')).toBeNull();
    expect(await fetchExtrasCollection('tt0816692')).toBeNull();
    expect(await fetchExtrasUpcoming('tt0903747')).toBeNull();
    expect(await fetchExtrasAnimeTitle('Cowboy Bebop')).toBeNull();
    expect(fetchSpy.mock.calls.every(([url]) => String(url).startsWith('/api/extras/'))).toBe(true);
  });

  it('falls back to packages/extras in the browser when Core returns 404', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/extras/')) return new Response(null, { status: 404 });
      if (url.startsWith('https://query.wikidata.org/sparql')) {
        if (url.includes('P179')) {
          return new Response(
            JSON.stringify({
              results: {
                bindings: [
                  {
                    collection: { value: 'http://www.wikidata.org/entity/Q1' },
                    collectionLabel: { value: 'Dune Series' },
                    imdb: { value: 'tt1160419' },
                  },
                  {
                    collection: { value: 'http://www.wikidata.org/entity/Q1' },
                    collectionLabel: { value: 'Dune Series' },
                    imdb: { value: 'tt15239678' },
                  },
                ],
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ results: { bindings: [{ tmdb: { value: '438631' } }] } }),
          { status: 200 },
        );
      }
      if (url.startsWith('https://api.theintrodb.org/v2/media')) {
        return new Response(
          JSON.stringify({
            intro: [{ start_ms: 5000, end_ms: 45000 }],
            recap: [],
            credits: [{ start_ms: 1800000, end_ms: null }],
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('https://v3-cinemeta.strem.io/meta/')) {
        return new Response(
          JSON.stringify({ meta: { trailers: [{ source: 'n9xhJrPXop4', name: 'Official Trailer' }] } }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/media?id=')) {
        const id = decodeURIComponent(url.split('id=')[1] ?? '');
        return new Response(JSON.stringify(makeItem(id, `Title ${id}`)), { status: 200 });
      }
      if (url.startsWith('https://api.tvmaze.com/lookup/shows')) {
        return new Response(JSON.stringify({ id: 169 }), { status: 200 });
      }
      if (url.startsWith('https://api.tvmaze.com/shows/169')) {
        return new Response(
          JSON.stringify({
            _embedded: {
              nextepisode: { season: 2, number: 5, name: 'Next Episode', airstamp: '2026-12-03T02:00:00Z' },
            },
          }),
          { status: 200 },
        );
      }
      if (url === 'https://graphql.anilist.co') {
        return new Response(
          JSON.stringify({ data: { Media: { idMal: 16498, title: { english: 'Attack on Titan' } } } }),
          { status: 200 },
        );
      }
      if (url.startsWith('https://opensubtitles-v3.strem.io/subtitles/')) {
        return new Response(
          JSON.stringify({
            subtitles: [
              { id: 'en1', lang: 'eng', url: 'https://subs1.strem.io/en.srt' },
              { id: 'es1', lang: 'spa', url: 'https://blocked.strem.io/es.srt' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === 'https://subs1.strem.io/en.srt') {
        return new Response('1\n00:00:01,000 --> 00:00:03,000\nHello world\n', { status: 200 });
      }
      if (url === 'https://blocked.strem.io/es.srt') {
        return Promise.reject(new TypeError('Failed to fetch (CORS)'));
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    expect(await fetchExtrasSegments({ id: 'tt1160419' })).toEqual({
      intro: { start: 5, end: 45 },
      recap: null,
      credits: { start: 1800, end: null },
      source: 'theintrodb',
    });
    expect(await fetchExtrasTrailers('tt1160419')).toEqual([
      { youtubeId: 'n9xhJrPXop4', name: 'Official Trailer' },
    ]);
    const collection = await fetchExtrasCollection('tt1160419');
    expect(collection?.name).toBe('Dune Series');
    expect(collection?.items.map((item) => item.id)).toEqual(['tt1160419', 'tt15239678']);
    expect(await fetchExtrasUpcoming('tt0903747')).toEqual({
      season: 2,
      episode: 5,
      name: 'Next Episode',
      airstamp: '2026-12-03T02:00:00Z',
    });
    expect(await fetchExtrasUpcomingHome()).toBeNull();
    expect(await fetchExtrasStats()).toBeNull();
    expect(await clearExtrasStats()).toBe(false);
    expect(await fetchExtrasAnimeTitle('Shingeki no Kyojin')).toEqual({
      english: 'Attack on Titan',
      malId: 16498,
    });

    const subs = await fetchExtrasSubtitles({ id: 'tt1160419' });
    expect(subs?.length).toBe(1);
    expect(subs?.[0]?.language).toBe('eng');
    expect(subs?.[0]?.url).toMatch(/^(blob:|data:text\/vtt)/);
  });

  it('hides fallback subtitles whose response is opaque (CORS blocked)', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/extras/')) return new Response(null, { status: 404 });
      if (url.startsWith('https://opensubtitles-v3.strem.io/subtitles/')) {
        return new Response(
          JSON.stringify({ subtitles: [{ id: 'en1', lang: 'eng', url: 'https://subs1.strem.io/en.srt' }] }),
          { status: 200 },
        );
      }
      if (url === 'https://subs1.strem.io/en.srt') {
        return { ok: true, status: 200, type: 'opaque' } as unknown as Response;
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    expect(await fetchExtrasSubtitles({ id: 'tt1160419' })).toEqual([]);
  });

  it('returns null gracefully on network rejection', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    expect(await fetchExtrasSegments({ id: 'tt0816692', title: 'Interstellar' })).toBeNull();
    expect(await fetchExtrasSubtitles({ id: 'tt0816692' })).toBeNull();
    expect(await fetchExtrasTrailers('tt0816692')).toBeNull();
    expect(await fetchExtrasCollection('tt0816692')).toBeNull();
    expect(await fetchExtrasUpcoming('tt0903747')).toBeNull();
    expect(await fetchExtrasUpcomingHome()).toBeNull();
    expect(await fetchExtrasStats()).toBeNull();
    expect(await fetchExtrasAnimeTitle('Cowboy Bebop')).toBeNull();
    expect(await clearExtrasStats()).toBe(false);
  });

  it('parses segments, trailers, upcoming, stats, and anime titles when available', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/extras/segments')) {
        return new Response(
          JSON.stringify({
            intro: { start: 12.5, end: 88.2 },
            recap: null,
            credits: { start: 2500, end: null },
            source: 'theintrodb',
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/extras/trailers')) {
        return new Response(
          JSON.stringify({
            trailers: [
              { youtubeId: 'LY19rHKAaAg', name: 'Main Trailer' },
              { youtubeId: 'bad id!', name: 'Invalid' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/extras/upcoming/home')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                item: { ...makeItem('tt0903747', 'Breaking Bad'), kind: 'series' },
                next: { season: 2, episode: 4, name: 'Down', airstamp: '2026-12-03T02:00:00Z' },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/extras/upcoming')) {
        return new Response(
          JSON.stringify({
            next: { season: 3, episode: 1, name: 'Premiere', airstamp: '2026-12-03T02:00:00Z' },
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/extras/stats/clear')) {
        return new Response(null, { status: 204 });
      }
      if (url.startsWith('/api/extras/stats')) {
        return new Response(
          JSON.stringify({
            week: 7200,
            month: 18000,
            all: 54000,
            finished: 4,
            streakDays: 3,
            topGenres: [{ genre: 'Sci-Fi', seconds: 36000 }],
            history: [{ item: makeItem('tt0816692', 'Interstellar'), at: '2026-11-24T20:00:00Z', seconds: 5400 }],
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/extras/anime-title')) {
        return new Response(JSON.stringify({ english: 'Attack on Titan', malId: 16498 }), { status: 200 });
      }
      if (url.startsWith('/api/extras/subtitles')) {
        return new Response(
          JSON.stringify({
            subtitles: [{ id: '1', language: 'eng', label: 'English', url: '/api/extras/subtitle.vtt?u=abc' }],
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    expect(await fetchExtrasSegments({ id: 'tt0903747', season: 1, episode: 1 })).toEqual({
      intro: { start: 12.5, end: 88.2 },
      recap: null,
      credits: { start: 2500, end: null },
      source: 'theintrodb',
    });
    expect(await fetchExtrasTrailers('tt0816692')).toEqual([{ youtubeId: 'LY19rHKAaAg', name: 'Main Trailer' }]);
    expect(await fetchExtrasSubtitles({ id: 'tt0816692' })).toEqual([
      { id: '1', language: 'eng', label: 'English', url: '/api/extras/subtitle.vtt?u=abc' },
    ]);
    expect((await fetchExtrasUpcoming('tt0903747'))?.episode).toBe(1);
    expect((await fetchExtrasUpcomingHome())?.length).toBe(1);
    const stats = await fetchExtrasStats();
    expect(stats?.finished).toBe(4);
    expect(stats?.topGenres[0]?.genre).toBe('Sci-Fi');
    expect(await clearExtrasStats()).toBe(true);
    expect(await fetchExtrasAnimeTitle('Shingeki no Kyojin')).toEqual({
      english: 'Attack on Titan',
      malId: 16498,
    });
  });

  it('hides collections with fewer than 2 members and filters out the current film', () => {
    const one = { name: 'Solo Saga', items: [makeItem('tt0000001', 'One')] };
    expect(visibleCollectionItems(one, 'tt0000001')).toEqual([]);

    const two = {
      name: 'Dune',
      items: [makeItem('tt1160419', 'Dune'), makeItem('tt15239678', 'Dune: Part Two')],
    };
    expect(visibleCollectionItems(two, 'tt1160419').map((i) => i.id)).toEqual(['tt15239678']);
  });
});

describe('extras formatting and guards', () => {
  it('checks anime title display and candidate detection', () => {
    expect(shouldShowAnimeEnglishTitle('Shingeki no Kyojin', 'Attack on Titan')).toBe('Attack on Titan');
    expect(shouldShowAnimeEnglishTitle('Cowboy Bebop', 'cowboy bebop')).toBeNull();
    expect(shouldShowAnimeEnglishTitle('Cowboy Bebop', null)).toBeNull();
    expect(isAnimeCandidate(['Animation', 'Action'])).toBe(true);
    expect(isAnimeCandidate(['Drama'], false)).toBe(false);
    expect(isAnimeCandidate(['Drama'], true)).toBe(true);
  });

  it('formats dates, episode codes, watch hours, and YouTube URLs', () => {
    expect(formatEpisodeCode(2, 4)).toBe('S02E04');
    expect(formatUpcomingDate('2026-12-03T12:00:00Z')).toBeTruthy();
    expect(formatUpcomingDate('not-a-date')).toBeNull();
    expect(formatWatchDuration(0)).toBe('0 hrs');
    expect(formatWatchDuration(1800)).toBe('30 min');
    expect(formatWatchDuration(7200)).toBe('2.0 hrs');
    expect(formatWatchDuration(43200)).toBe('12 hrs');
    expect(youtubeEmbedUrl('LY19rHKAaAg', { muted: true, loop: true })).toContain(
      'https://www.youtube-nocookie.com/embed/LY19rHKAaAg',
    );
    expect(youtubeEmbedUrl('LY19rHKAaAg', { muted: true })).toContain('mute=1');
    expect(youtubeWatchUrl('LY19rHKAaAg')).toBe('https://www.youtube.com/watch?v=LY19rHKAaAg');
  });

  it('restricts hero trailer previews strictly to desktop web when idle and non-reduced', () => {
    const base: HeroPreviewGuardInput = {
      heroPreviews: true,
      reducedMotion: false,
      phoneShell: false,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0',
      narrowViewport: false,
      coarsePointer: false,
      connectionType: 'wifi',
      saveData: false,
      documentHidden: false,
    };
    expect(shouldPlayHeroPreview(base)).toBe(true);
    expect(shouldPlayHeroPreview({ ...base, heroPreviews: false })).toBe(false);
    expect(shouldPlayHeroPreview({ ...base, reducedMotion: true })).toBe(false);
    expect(shouldPlayHeroPreview({ ...base, phoneShell: true })).toBe(false);
    expect(shouldPlayHeroPreview({ ...base, narrowViewport: true })).toBe(false);
    expect(shouldPlayHeroPreview({ ...base, coarsePointer: true })).toBe(false);
    expect(shouldPlayHeroPreview({ ...base, userAgent: 'TVM-iOS iPhone' })).toBe(false);
    expect(shouldPlayHeroPreview({ ...base, connectionType: 'cellular' })).toBe(false);
    expect(shouldPlayHeroPreview({ ...base, saveData: true })).toBe(false);
    expect(shouldPlayHeroPreview({ ...base, documentHidden: true })).toBe(false);
  });
});
