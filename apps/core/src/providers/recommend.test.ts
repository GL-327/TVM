import { describe, expect, it } from 'vitest';
import { becauseYouWatched, interleaveUnused, pickYouMightLike, takeUnused } from './recommend.ts';
import type { MediaItem } from './types.ts';

function item(id: string, genres: string[], title = id): MediaItem {
  return {
    id,
    title,
    year: 2024,
    kind: 'movie',
    synopsis: '',
    poster: '',
    backdrop: '',
    genres,
    rating: '7',
    playable: true,
    hue: 1,
  };
}

describe('recommendations', () => {
  it('ranks titles that share watched genres first', () => {
    const horror = item('tt-h', ['Horror']);
    const comedy = item('tt-c', ['Comedy']);
    const picked = pickYouMightLike([comedy, horror], [item('tt-watched', ['Horror'])], new Set(), 8);
    expect(picked[0]?.id).toBe('tt-h');
  });

  it('falls back to catalog order when there is no history', () => {
    const pool = [item('a', ['Drama']), item('b', ['Action'])];
    expect(pickYouMightLike(pool, [], new Set(), 2).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('builds a because-you-watched rail from the source genres', () => {
    const source = item('tt-src', ['Action'], 'Reacher');
    const other = item('tt-act', ['Action'], 'Extraction');
    const skip = item('tt-rom', ['Romance'], 'Anyone But You');
    expect(becauseYouWatched(source, [other, skip], new Set(), 8).map((entry) => entry.id)).toEqual(['tt-act']);
  });

  it('interleaves unused films and series for a genre rail', () => {
    const films = [item('tt-m1', ['Anime'], 'Film One'), item('tt-m2', ['Anime'], 'Film Two')];
    const shows = [
      { ...item('tt-s1', ['Anime'], 'Show One'), kind: 'series' as const },
      { ...item('tt-s2', ['Anime'], 'Show Two'), kind: 'series' as const },
    ];
    const used = new Set<string>();
    const mixed = interleaveUnused(films, shows, used, 16);
    expect(mixed.map((entry) => [entry.id, entry.kind])).toEqual([
      ['tt-m1', 'movie'],
      ['tt-s1', 'series'],
      ['tt-m2', 'movie'],
      ['tt-s2', 'series'],
    ]);
    expect(takeUnused(films, new Set(), 16)).toHaveLength(2);
  });
});
