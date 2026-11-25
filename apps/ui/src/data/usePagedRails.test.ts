import { describe, expect, it } from 'vitest';
import { dedupeMediaItems, type MediaItem } from './media';
import { mergePagedRailItems } from './usePagedRails';

function makeItem(id: string, title = id): MediaItem {
  return {
    id,
    title,
    year: 2025,
    kind: 'movie',
    synopsis: '',
    poster: '',
    backdrop: '',
    genres: ['Action'],
    rating: '8.0',
    playable: false,
    hue: 210,
  };
}

describe('rail paging helpers', () => {
  it('dedupes overlapping items by id while preserving order', () => {
    const first = [makeItem('tt1'), makeItem('tt2'), makeItem('tt3')];
    const pageTwo = [makeItem('tt2'), makeItem('tt4'), makeItem('tt5'), makeItem('tt4')];
    expect(dedupeMediaItems(first, pageTwo).map((item) => item.id)).toEqual(['tt1', 'tt2', 'tt3', 'tt4', 'tt5']);
    expect(mergePagedRailItems(first, pageTwo).map((item) => item.id)).toEqual(['tt1', 'tt2', 'tt3', 'tt4', 'tt5']);
  });
});
