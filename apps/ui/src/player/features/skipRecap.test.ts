import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./SkipRecap.css', () => ({}));

import {
  DEFAULT_RECAP_END_SECONDS,
  isRecapWindow,
  parseRecapMetadata,
  resolveRecapMetadata,
  SKIP_RECAP_FOCUS_ID,
} from './SkipRecap';

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

describe('skip recap visibility', () => {
  it('hides when recap metadata is missing', () => {
    expect(parseRecapMetadata(null)).toBeNull();
    expect(parseRecapMetadata(undefined)).toBeNull();
    expect(parseRecapMetadata({})).toBeNull();
    expect(resolveRecapMetadata({})).toBeNull();
    expect(resolveRecapMetadata({ skipRecap: false })).toBeNull();
  });

  it('shows the default window when the plan allows skip recap', () => {
    expect(DEFAULT_RECAP_END_SECONDS).toBe(90);
    expect(resolveRecapMetadata({ skipRecap: true })).toEqual({ start: 0, end: 90 });
    expect(isRecapWindow(12, { start: 0, end: 90 })).toBe(true);
  });

  it('hides after the recap window ends', () => {
    const recap = { start: 0, end: 90 };
    expect(isRecapWindow(20, recap)).toBe(true);
    expect(isRecapWindow(90, recap)).toBe(false);
    expect(isRecapWindow(89.8, recap)).toBe(false);
  });

  it('hides for live playback even when the plan allows skip recap', () => {
    expect(resolveRecapMetadata({ skipRecap: true, mediaId: 'live:mock:sky' })).toBeNull();
  });

  it('hides when skipRecap is forced off despite a marker', () => {
    expect(resolveRecapMetadata({ skipRecap: false, recap: { start: 0, end: 40 } })).toBeNull();
  });

  it('uses an explicit recap marker for the visible window', () => {
    expect(parseRecapMetadata({ start: 8, end: 42 })).toEqual({ start: 8, end: 42 });
    expect(isRecapWindow(5, { start: 8, end: 42 })).toBe(false);
    expect(isRecapWindow(10, { start: 8, end: 42 })).toBe(true);
  });

  it('exposes the skip-recap focus id', () => {
    expect(SKIP_RECAP_FOCUS_ID).toBe('player-skip-recap');
  });
});
