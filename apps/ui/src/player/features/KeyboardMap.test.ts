import { describe, expect, it } from 'vitest';
import { shouldYieldToRemote } from './KeyboardMap';

describe('player menu keyboard ownership', () => {
  it('lets an open picker close on Back before leaving playback', () => {
    expect(shouldYieldToRemote('back', { menuOpen: true })).toBe(true);
    expect(shouldYieldToRemote('back', { menuOpen: false })).toBe(false);
  });

  it('keeps seek arrows inside open menus', () => {
    expect(shouldYieldToRemote('seekBack', { menuOpen: true, chromeVisible: false })).toBe(true);
    expect(shouldYieldToRemote('seekForward', { menuOpen: true, chromeVisible: false })).toBe(true);
  });
});
