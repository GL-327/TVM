import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRecentSearches, readRecentSearches, saveRecentSearch } from './searchHistory';
import { watchlistView } from './watchlistView';
import type { MediaItem } from './media';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());

describe('recent searches', () => {
  it('deduplicates, bounds and separates history by profile', () => {
    for (let n = 0; n < 12; n++) saveRecentSearch('a', `Title ${n}`);
    saveRecentSearch('a', ' title 10 ');
    expect(readRecentSearches('a')).toHaveLength(8);
    expect(readRecentSearches('a')[0]).toBe('title 10');
    expect(readRecentSearches('b')).toEqual([]);
    clearRecentSearches('a');
    expect(readRecentSearches('a')).toEqual([]);
  });
  it('does not retain playback links or fail when storage is blocked', () => {
    saveRecentSearch('a', 'https://example.com/private?token=secret');
    expect(readRecentSearches('a')).toEqual([]);
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
    expect(saveRecentSearch('a', 'Dune')).toEqual(['Dune']);
  });
});

describe('watchlist filters', () => {
  const film: MediaItem = { id: 'film', title: 'Zulu', kind: 'movie', year: 2024, rating: '8.7', synopsis: '', poster: '', backdrop: '', genres: [], playable: true, hue: 0 };
  const show = { ...film, id: 'show', title: 'Alpha', kind: 'series' as const, year: 2020, rating: '9.1' };
  const file = { ...film, id: 'episode', title: 'Episode', kind: 'file' as const, season: 1, year: null, rating: '' };
  it('keeps episode files with series and preserves saved order', () => {
    expect(watchlistView([film, show, file], 'series', 'saved')).toEqual([show, file]);
    expect(watchlistView([film, show, file], 'movie', 'saved')).toEqual([film]);
  });
  it('sorts numerically without mutating the library', () => {
    const items = [film, show, file];
    expect(watchlistView(items, 'all', 'rating').map((x) => x.id)).toEqual(['show', 'film', 'episode']);
    expect(watchlistView(items, 'all', 'year')[0]).toBe(film);
    expect(watchlistView(items, 'all', 'title')[0]).toBe(show);
    expect(items).toEqual([film, show, file]);
  });
});
