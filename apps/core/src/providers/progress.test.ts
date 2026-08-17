import { describe, expect, it } from 'vitest';
import { pickContinueWatching, ratio, type ProgressMap } from './progress.ts';

describe('progress', () => {
  it('ignores a glance or a finished title', () => {
    expect(ratio({ position: 10, duration: 3600, updated: '2026-01-01' })).toBeUndefined();
    expect(ratio({ position: 20, duration: 40, updated: '2026-01-01' })).toBeUndefined();
    expect(ratio({ position: 3500, duration: 3600, updated: '2026-01-01' })).toBeUndefined();
    expect(ratio({ position: 900, duration: 3600, updated: '2026-01-01' })).toBe(0.25);
  });

  it('keeps one continue-watching card per show, newest first', () => {
    const progress: ProgressMap = {
      'rd:a': { position: 900, duration: 3600, updated: '2026-01-02T00:00:00.000Z' },
      'rd:b': { position: 400, duration: 3600, updated: '2026-01-03T00:00:00.000Z' },
      'rd:c': { position: 800, duration: 3600, updated: '2026-01-01T00:00:00.000Z' },
    };
    const items = [
      { id: 'rd:a', title: 'E1', showTitle: 'Reacher', progress: 0.25 },
      { id: 'rd:b', title: 'E2', showTitle: 'Reacher', progress: 0.11 },
      { id: 'rd:c', title: 'Dune', showTitle: 'Dune', progress: 0.22 },
    ];
    expect(pickContinueWatching(items, progress).map((item) => item.id)).toEqual(['rd:b', 'rd:c']);
  });
});
