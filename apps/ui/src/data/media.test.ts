import { describe, expect, it } from 'vitest';
import { asTitle, liveGroups, type MediaItem } from './media';

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
});

describe('liveGroups', () => {
  it('prefixes All and skips blank groups', () => {
    expect(liveGroups([])).toEqual(['All']);
    expect(
      liveGroups([
        { id: 'live:0', name: 'One', url: 'https://example.com/a.m3u8', group: 'Sports' },
        { id: 'live:1', name: 'Two', url: 'https://example.com/b.m3u8' },
        { id: 'live:2', name: 'Three', url: 'https://example.com/c.m3u8', group: 'Sports' },
        { id: 'live:3', name: 'Four', url: 'https://example.com/d.m3u8', group: 'News' },
      ]),
    ).toEqual(['All', 'Sports', 'News']);
  });
});
