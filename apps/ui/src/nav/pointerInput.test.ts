import { describe, expect, it } from 'vitest';
import { canScrollAxis, wheelPixels, wheelTarget, wheelWantsRail } from './pointerInput';

function box(partial: Partial<Parameters<typeof canScrollAxis>[0]>) {
  return { scrollWidth: 0, clientWidth: 0, scrollHeight: 0, clientHeight: 0, ...partial };
}

describe('canScrollAxis', () => {
  it('sees a rail that overflows its camera', () => {
    expect(canScrollAxis(box({ scrollWidth: 4000, clientWidth: 1200 }), 'x')).toBe(true);
    expect(canScrollAxis(box({ scrollWidth: 1200, clientWidth: 1200 }), 'x')).toBe(false);
  });

  it('sees a page taller than its viewport', () => {
    expect(canScrollAxis(box({ scrollHeight: 2400, clientHeight: 1080 }), 'y')).toBe(true);
    expect(canScrollAxis(box({ scrollHeight: 1080, clientHeight: 1080 }), 'y')).toBe(false);
  });

  it('ignores a sub-pixel difference so rounding is not mistaken for overflow', () => {
    expect(canScrollAxis(box({ scrollHeight: 1080.5, clientHeight: 1080 }), 'y')).toBe(false);
  });
});

describe('wheelWantsRail', () => {
  it('sends a trackpad side-swipe to the rail', () => {
    expect(wheelWantsRail(-40, 2, false)).toBe(true);
  });

  it('sends a plain wheel down the page instead of along the rail', () => {
    expect(wheelWantsRail(0, 120, false)).toBe(false);
  });

  it('lets Shift redirect a mouse wheel along the rail', () => {
    // A mouse wheel never reports deltaX, so Shift is the only way to say
    // "sideways" without a trackpad.
    expect(wheelWantsRail(0, 120, true)).toBe(true);
  });
});

describe('wheel camera input', () => {
  it('normalizes line, page and pixel devices on either axis', () => {
    expect(wheelPixels(2, 1, 800)).toBe(32);
    expect(wheelPixels(-1, 2, 800)).toBe(-800);
    expect(wheelPixels(2.5, 0, 800)).toBe(2.5);
    expect(wheelPixels(Number.NaN, 0, 800)).toBe(0);
  });

  it('accumulates notches but reverses without waiting for stale momentum', () => {
    expect(wheelTarget(100, 300, 120)).toBe(420);
    expect(wheelTarget(100, 300, -30)).toBe(70);
    expect(wheelTarget(100, 40, 30)).toBe(130);
  });
});
