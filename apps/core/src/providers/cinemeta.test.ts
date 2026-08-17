import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyEpisodeRatings,
  chooseCinemetaMeta,
  createCatalogService,
  filterNewFilms,
  mapCinemetaMeta,
  mapCinemetaVideos,
  parseTvmazeEpisodes,
  parseYear,
  seriesGenresForRail,
} from './cinemeta.ts';

describe('cinemeta mapping', () => {
  it('maps a Cinemeta movie onto a playable catalog item', () => {
    const item = mapCinemetaMeta(
      {
        id: 'tt15398776',
        name: 'Oppenheimer',
        year: '2023',
        poster: 'https://example/p.jpg',
        background: 'https://example/b.jpg',
        genre: ['Drama', 'History'],
        description: 'A bomb.',
        imdbRating: '8.3',
      },
      'movie',
    );
    expect(item?.id).toBe('tt15398776');
    expect(item?.title).toBe('Oppenheimer');
    expect(item?.year).toBe(2023);
    expect(item?.playable).toBe(true);
    expect(item?.genres).toEqual(['Drama', 'History']);
    expect(item?.rating).toBe('8.3');
  });

  it('fills a missing Cinemeta background from a large metahub still', () => {
    const item = mapCinemetaMeta(
      { id: 'tt0111161', name: 'The Shawshank Redemption', poster: 'https://images.metahub.space/poster/medium/tt0111161/img' },
      'movie',
    );
    expect(item?.poster).toBe('https://images.metahub.space/poster/large/tt0111161/img');
    expect(item?.backdrop).toBe('https://images.metahub.space/background/large/tt0111161/img');
  });

  it('maps series videos into season/episode children', () => {
    const show = mapCinemetaMeta(
      { id: 'tt0944947', name: 'Game of Thrones', year: '2011', imdbRating: '9.3' },
      'series',
    );
    expect(show).not.toBeNull();
    const kids = mapCinemetaVideos(show!, [
      { season: 1, episode: 2, title: 'The Kingsroad', released: '2011-04-24T00:00:00.000Z', imdbRating: 0 },
      { season: 0, episode: 1, title: 'Extra' },
      {
        season: 1,
        episode: 1,
        title: 'Winter Is Coming',
        firstAired: '2011-04-17T00:00:00.000Z',
        overview: 'The Starks find a direwolf.',
        imdbRating: '9.1',
      },
    ]);
    expect(kids.map((item) => [item.season, item.episode, item.episodeName])).toEqual([
      [1, 1, 'Winter Is Coming'],
      [1, 2, 'The Kingsroad'],
    ]);
    expect(kids[0]?.id).toBe('tt0944947:1:1');
    expect(kids[0]?.aired).toBe('2011-04-17');
    expect(kids[0]?.rating).toBe('9.1');
    expect(kids[1]?.aired).toBe('2011-04-24');
    expect(kids[1]?.rating).toBe('');
  });

  it('does not let a colliding movie steal a series IMDb id', () => {
    const series = mapCinemetaMeta({ id: 'tt1196946', name: 'The Mentalist', year: '2008' }, 'series');
    const movie = mapCinemetaMeta({ id: 'tt1196946', name: 'Le Mans', year: '1971' }, 'movie');
    const kids = mapCinemetaVideos(series!, [{ season: 1, episode: 1, title: 'Pilot' }]);
    const picked = chooseCinemetaMeta(
      movie !== null ? { item: movie, children: [] } : null,
      series !== null ? { item: series, children: kids } : null,
    );
    expect(picked?.item.title).toBe('The Mentalist');
    expect(picked?.item.kind).toBe('series');
    expect(picked?.children).toHaveLength(1);
  });

  it('loads series meta even when Cinemeta movie for the same tt is a different film', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-meta-'));
    try {
      const catalog = createCatalogService({
        dataDir: dir,
        fetch: async (input) => {
          const url = String(input);
          if (url.includes('/meta/movie/tt1196946')) {
            return new Response(JSON.stringify({ meta: { id: 'tt1196946', name: 'Le Mans', type: 'movie', imdbRating: '8.2' } }), {
              status: 200,
            });
          }
          if (url.includes('/meta/series/tt1196946')) {
            return new Response(
              JSON.stringify({
                meta: {
                  id: 'tt1196946',
                  name: 'The Mentalist',
                  type: 'series',
                  imdbRating: '8.2',
                  videos: [{ season: 1, episode: 1, title: 'Pilot' }],
                },
              }),
              { status: 200 },
            );
          }
          return new Response('no', { status: 404 });
        },
      });
      const meta = await catalog.meta('tt1196946');
      expect(meta?.item.title).toBe('The Mentalist');
      expect(meta?.item.kind).toBe('series');
      expect(meta?.children[0]?.id).toBe('tt1196946:1:1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps current and previous year films for the new-releases rail', () => {
    expect(parseYear('2026-2028')).toBe(2026);
    const fresh = filterNewFilms(
      [
        { id: 'tt1', title: 'Now', year: 2026, kind: 'movie', synopsis: '', poster: '', backdrop: '', genres: [], rating: '', playable: true, hue: 1 },
        { id: 'tt2', title: 'Old', year: 2019, kind: 'movie', synopsis: '', poster: '', backdrop: '', genres: [], rating: '', playable: true, hue: 1 },
      ],
      new Date('2026-08-16'),
    );
    expect(fresh.map((item) => item.id)).toEqual(['tt1']);
  });

  it('adds Animation when filling the Anime series rail', () => {
    expect(seriesGenresForRail('Anime')).toEqual(['Anime', 'Animation']);
    expect(seriesGenresForRail('Comedy')).toEqual(['Comedy']);
  });

  it('fills missing episode scores from TVMaze without replacing Cinemeta ratings', () => {
    const ratings = parseTvmazeEpisodes([
      { season: 4, number: 5, rating: { average: 7 } },
      { season: 4, number: 13, rating: { average: 8.1 } },
      { season: 4, number: 4, rating: { average: null } },
    ]);
    const kids = applyEpisodeRatings(
      [
        {
          id: 'tt1844624:4:5',
          title: 'AHS',
          year: 2011,
          kind: 'series',
          synopsis: '',
          poster: '',
          backdrop: '',
          genres: [],
          rating: '',
          playable: true,
          hue: 1,
          season: 4,
          episode: 5,
        },
        {
          id: 'tt1844624:4:13',
          title: 'AHS',
          year: 2011,
          kind: 'series',
          synopsis: '',
          poster: '',
          backdrop: '',
          genres: [],
          rating: '9.1',
          playable: true,
          hue: 1,
          season: 4,
          episode: 13,
        },
      ],
      ratings,
    );
    expect(kids[0]?.rating).toBe('7');
    expect(kids[1]?.rating).toBe('9.1');
  });

  it('loads per-episode TVMaze scores when Cinemeta videos have none', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-tvmaze-'));
    try {
      const catalog = createCatalogService({
        dataDir: dir,
        fetch: async (input) => {
          const url = String(input);
          if (url.includes('/meta/series/tt1844624')) {
            return new Response(
              JSON.stringify({
                meta: {
                  id: 'tt1844624',
                  name: 'American Horror Story',
                  type: 'series',
                  imdbRating: '7.9',
                  videos: [
                    { season: 4, episode: 5, title: 'Pink Cupcakes' },
                    { season: 4, episode: 13, title: 'Curtain Call', imdbRating: '8.2' },
                  ],
                },
              }),
              { status: 200 },
            );
          }
          if (url.includes('api.tvmaze.com/lookup/shows')) {
            return new Response(JSON.stringify({ id: 30 }), { status: 200 });
          }
          if (url.includes('api.tvmaze.com/shows/30/episodes')) {
            return new Response(
              JSON.stringify([
                { season: 4, number: 5, rating: { average: 7 } },
                { season: 4, number: 13, rating: { average: 8.1 } },
              ]),
              { status: 200 },
            );
          }
          return new Response(JSON.stringify({ meta: {} }), { status: 200 });
        },
      });
      const meta = await catalog.meta('tt1844624');
      expect(meta?.children.find((item) => item.episode === 5)?.rating).toBe('7');
      expect(meta?.children.find((item) => item.episode === 13)?.rating).toBe('8.2');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
