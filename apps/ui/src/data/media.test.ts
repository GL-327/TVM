import { describe, expect, it } from 'vitest';
import { asTitle, type MediaItem } from './media';

const item: MediaItem = {
  id: 'rd:t:dune',
  title: 'Dune.Part.Two.2024.BluRay.mkv',
  year: 2024,
  kind: 'movie',
  synopsis: '',
  poster: '',
  backdrop: '',
  genres: [],
  rating: '',
  playable: true,
  hue: 32,
};

describe('asTitle', () => {
  it('matches catalog titles without throwing', () => {
    expect(() => asTitle(item)).not.toThrow();
    expect(asTitle(item).title.length).toBeGreaterThan(0);
  });

  it('keeps a series kind when the catalog also has a movie with a similar name', () => {
    const show: MediaItem = {
      ...item,
      id: 'tt0944947',
      title: 'Game of Thrones',
      kind: 'series',
      season: 1,
      episode: 1,
    };
    expect(asTitle(show).kind).toBe('series');
  });
});
