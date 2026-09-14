import { describe, expect, it } from 'vitest';
import {
  extraScrollToReveal,
  isPhoneViewport,
  keyboardOcclusionPx,
  KEYBOARD_OPEN_PX,
  phoneOrientation,
  edgeSwipeGoesBack,
} from './phoneViewport';

describe('phone viewport keyboard math', () => {
  it('treats a shrunk visual viewport as keyboard occlusion', () => {
    expect(keyboardOcclusionPx(844, 508, 0)).toBe(336);
  });

  it('subtracts a pinch offset so a scrolled visual viewport is not a keyboard', () => {
    expect(keyboardOcclusionPx(844, 844, 0)).toBe(0);
    expect(keyboardOcclusionPx(844, 700, 144)).toBe(0);
  });

  it('ignores non-finite measurements', () => {
    expect(keyboardOcclusionPx(Number.NaN, 500, 0)).toBe(0);
    expect(keyboardOcclusionPx(800, Number.POSITIVE_INFINITY, 0)).toBe(0);
  });

  it('never reports a negative inset', () => {
    expect(keyboardOcclusionPx(500, 800, 0)).toBe(0);
  });

  it('lifts a field that sits under the keyboard and leaves one that is already clear', () => {
    expect(extraScrollToReveal(780, 520, 20)).toBe(280);
    expect(extraScrollToReveal(400, 520, 20)).toBe(0);
    expect(extraScrollToReveal(Number.NaN, 520, 20)).toBe(0);
  });

  it('opens the keyboard chrome once occlusion clears the jitter floor', () => {
    expect(KEYBOARD_OPEN_PX).toBe(80);
    expect(keyboardOcclusionPx(844, 770, 0) >= KEYBOARD_OPEN_PX).toBe(false);
    expect(keyboardOcclusionPx(844, 500, 0) >= KEYBOARD_OPEN_PX).toBe(true);
  });
});

describe('phone viewport shell', () => {
  it('marks a narrow window as a phone even with a fine pointer', () => {
    expect(isPhoneViewport(true, false, true)).toBe(true);
  });

  it('marks a coarse tablet as a phone shell and leaves a wide desktop alone', () => {
    expect(isPhoneViewport(false, true, true)).toBe(true);
    expect(isPhoneViewport(false, false, false)).toBe(false);
    expect(isPhoneViewport(false, true, false)).toBe(false);
  });

  it('allows portrait and landscape from the window size', () => {
    expect(phoneOrientation(390, 844)).toBe('portrait');
    expect(phoneOrientation(430, 932)).toBe('portrait');
    expect(phoneOrientation(844, 390)).toBe('landscape');
    expect(phoneOrientation(932, 430)).toBe('landscape');
    expect(phoneOrientation(Number.NaN, 800)).toBe('portrait');
  });

  it('treats a left-edge horizontal swipe as back', () => {
    expect(edgeSwipeGoesBack(8, 80, 10)).toBe(true);
    expect(edgeSwipeGoesBack(80, 80, 10)).toBe(false);
    expect(edgeSwipeGoesBack(8, 80, 90)).toBe(false);
    expect(edgeSwipeGoesBack(4, 40, 5)).toBe(false);
  });
});
