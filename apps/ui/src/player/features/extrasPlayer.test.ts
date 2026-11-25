import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./SkipRecap.css', () => ({}));

import { activeSegmentForTime } from './SkipRecap';
import { shouldShowNextUp } from './NextUp';
import { sortSubtitlesByPreference, type ListedSubtitle } from './SubtitlePicker';

beforeAll(() => {
  const runtime = globalThis as unknown as {
    HTMLElement?: unknown;
    document?: unknown;
  };
  if (typeof runtime.HTMLElement !== 'function') {
    runtime.HTMLElement = class HTMLElement {};
  }
  if (runtime.document === undefined) {
    runtime.document = {
      querySelector: () => null,
      querySelectorAll: () => [],
    };
  }
});

describe('player skip segments', () => {
  const segments = {
    recap: { start: 0, end: 35 },
    intro: { start: 40, end: 110 },
    credits: { start: 1300, end: null },
    source: 'theintrodb' as const,
  };

  it('hides all segments when skip mode is off', () => {
    expect(activeSegmentForTime(15, 1400, segments, null, 'off')).toBeNull();
    expect(activeSegmentForTime(60, 1400, segments, null, 'off')).toBeNull();
    expect(activeSegmentForTime(1320, 1400, segments, null, 'off')).toBeNull();
  });

  it('returns active recap, intro, and credits segments with proper labels', () => {
    expect(activeSegmentForTime(10, 1400, segments, null, 'button')?.label).toBe('Skip recap');
    expect(activeSegmentForTime(75, 1400, segments, null, 'button')?.label).toBe('Skip intro');
    expect(activeSegmentForTime(1320, 1400, segments, null, 'auto')).toEqual({
      kind: 'credits',
      start: 1300,
      end: null,
      label: 'Skip credits',
    });
    expect(activeSegmentForTime(38, 1400, segments, null, 'button')).toBeNull();
  });
});

describe('Up Next credits and 30 s window', () => {
  it('triggers at credits start when credits are known', () => {
    expect(shouldShowNextUp(1290, 1400, 1300)).toBe(false);
    expect(shouldShowNextUp(1300, 1400, 1300)).toBe(true);
  });

  it('falls back to the last 30 s when credits are unknown', () => {
    expect(shouldShowNextUp(1360, 1400, null)).toBe(false);
    expect(shouldShowNextUp(1370, 1400, null)).toBe(true);
  });
});

describe('SubtitlePicker preferred language ordering', () => {
  it('places preferred subtitle languages first in priority order', () => {
    const tracks: ListedSubtitle[] = [
      { id: 'app:0', label: 'French', language: 'fra', kind: 'subtitles', source: 'app', selected: false },
      { id: 'app:1', label: 'English', language: 'eng', kind: 'subtitles', source: 'app', selected: false },
      { id: 'app:2', label: 'Spanish', language: 'spa', kind: 'subtitles', source: 'app', selected: false },
    ];
    expect(sortSubtitlesByPreference(tracks, ['spa', 'eng']).map((t) => t.language)).toEqual(['spa', 'eng', 'fra']);
  });
});
