import { describe, expect, it, vi } from 'vitest';
import { createAppsService, matchStudio } from './apps.ts';
import type { CatalogBundle } from './cinemeta.ts';
import type { MediaItem } from './types.ts';

function item(id: string, title: string, kind: MediaItem['kind'] = 'series'): MediaItem {
  return {
    id,
    title,
    year: 2020,
    kind,
    synopsis: '',
    poster: '',
    backdrop: '',
    genres: [],
    rating: '',
    playable: false,
    hue: 12,
  };
}

function emptyBundle(series: MediaItem[]): CatalogBundle {
  return {
    moviesTop: [],
    seriesTop: series,
    moviesRated: [],
    seriesRated: [],
    recentTv: [],
    newFilms: [],
    catalog: series,
  };
}

describe('apps hubs', () => {
  it('matches TVMaze webChannel and network names', () => {
    expect(matchStudio({ webChannel: { name: 'Netflix' } }, ['netflix'])).toBe(true);
    expect(matchStudio({ network: { name: 'HBO' } }, ['hbo', 'max'])).toBe(true);
    expect(matchStudio({ network: { name: 'CBS' } }, ['netflix'])).toBe(false);
  });

  it('returns Netflix originals from TVMaze plus curated films via Cinemeta meta', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes('tt1111111')) {
        return new Response(JSON.stringify({ webChannel: { name: 'Netflix' } }), { status: 200 });
      }
      if (href.includes('tt2222222')) {
        return new Response(JSON.stringify({ network: { name: 'HBO' } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    const meta = vi.fn(async (id: string) => ({
      item: item(id, `Film ${id}`, 'movie'),
      children: [],
    }));
    const apps = createAppsService({
      fetch: fetchImpl as unknown as typeof fetch,
      catalog: {
        bundle: async () => emptyBundle([item('tt1111111', 'Stranger Things'), item('tt2222222', 'The Wire')]),
        meta,
      },
    });

    const hub = await apps.hub('netflix');
    expect(hub).not.toBeNull();
    expect(hub?.disclaimer).toMatch(/not the licensed netflix app/i);
    expect(hub?.layout).toBe('netflix');
    expect(hub?.hero !== undefined).toBe(true);
    const series = hub?.rails.find((rail) => rail.id === 'netflix-series')?.items ?? [];
    expect(series.some((entry) => entry.id === 'tt1111111' && entry.title === 'Stranger Things')).toBe(true);
    const films = hub?.rails.find((rail) => rail.id === 'netflix-films')?.items ?? [];
    expect(films.length).toBeGreaterThan(0);
    expect(meta).toHaveBeenCalled();
  });

  it('returns null for an unknown app id', async () => {
    const apps = createAppsService({
      catalog: {
        bundle: async () => emptyBundle([]),
        meta: async () => null,
      },
    });
    expect(await apps.hub('hbo-go')).toBeNull();
  });

  it('lists ribbon mocks in the requested order', () => {
    const apps = createAppsService({
      catalog: {
        bundle: async () => emptyBundle([]),
        meta: async () => null,
      },
    });
    const ids = apps.list().ribbon.map((app) => app.id);
    expect(ids).toEqual(['tvm-stream', 'netflix', 'prime', 'max', 'appletv', 'disney', 'hulu', 'peacock']);
    expect(apps.list().ribbon.find((app) => app.id === 'max')?.name).toBe('HBO Max');
  });

  it('still returns a playable hub when catalogs are empty', async () => {
    const apps = createAppsService({
      fetch: async () => new Response('{}', { status: 404 }),
      catalog: {
        bundle: async () => emptyBundle([]),
        meta: async () => null,
      },
    });
    const hub = await apps.hub('disney');
    expect(hub).not.toBeNull();
    expect(hub?.hero).toBeTruthy();
    expect(hub?.layout).toBe('disney');
  });
});
