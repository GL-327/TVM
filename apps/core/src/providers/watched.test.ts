import { describe, expect, it } from 'vitest';
import { markWatched } from './media.ts';
import type { MediaItem } from './types.ts';

const episode = (id: string): MediaItem => ({
  id, title: id, year: 2020, kind: 'series', synopsis: '', poster: '', backdrop: '', genres: [], rating: '', playable: true, hue: 0,
} as MediaItem);

describe('markWatched', () => {
  it('marks finished and completed episodes, and only those', () => {
    const items = markWatched([episode('tt1:1:1'), episode('tt1:1:2'), episode('tt1:1:3'), episode('tt1:1:4')], {
      'tt1:1:1': { position: 2900, duration: 3000, updated: '2026-11-01T00:00:00Z' },
      'tt1:1:2': { position: 600, duration: 3000, updated: '2026-11-01T00:00:00Z' },
      'tt1:1:3': { position: 0, duration: 3000, updated: '2026-11-01T00:00:00Z', completedAt: '2026-10-01T00:00:00Z' },
    } as never);
    expect(items.map((item) => item.watched)).toEqual([true, false, true, false]);
  });
});
