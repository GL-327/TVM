import { describe, expect, it } from 'vitest';
import {
  canScrollAxis,
  fieldScrollDelta,
  isOwnedTouchTarget,
  isPhoneNavShell,
  navShouldIgnoreKey,
  panAxis,
  RAIL_SELECTOR,
  railPanLeft,
  tapShouldActivate,
  wheelPixels,
  wheelTarget,
  wheelWantsRail,
} from './pointerInput';

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

describe('coarse tap activation', () => {
  it('activates a tap that stayed inside the slop', () => {
    expect(tapShouldActivate(false, 2)).toBe(true);
    expect(tapShouldActivate(true, 2)).toBe(false);
    expect(tapShouldActivate(false, 40)).toBe(false);
  });
});

describe('nested rail pan', () => {
  it('waits for the slop before locking an axis', () => {
    expect(panAxis(2, 3)).toBeNull();
    expect(panAxis(4, 20)).toBe('y');
    expect(panAxis(24, 3)).toBe('x');
  });

  it('follows the finger along a horizontal rail from the press origin', () => {
    expect(railPanLeft(400, 80, 30)).toBe(450);
    expect(railPanLeft(400, 80, 120)).toBe(360);
    expect(railPanLeft(Number.NaN, 0, 10)).toBe(Number.NaN);
  });
});

describe('keyboard field geometry', () => {
  it('lifts a field that sits under the keyboard', () => {
    expect(fieldScrollDelta(700, 780, 0, 520, 20)).toBe(280);
  });

  it('leaves a field that is already in the visual viewport', () => {
    expect(fieldScrollDelta(80, 120, 0, 520, 20)).toBe(0);
  });

  it('pulls a field back when the visual viewport has panned it off the top', () => {
    expect(fieldScrollDelta(-40, 8, 0, 520, 20)).toBe(-60);
  });

  it('ignores non-finite measurements', () => {
    expect(fieldScrollDelta(Number.NaN, 100, 0, 500, 20)).toBe(0);
  });
});

describe('phone nav shell', () => {
  it('treats phone-shell and keyboard-open as a phone nav shell', () => {
    expect(isPhoneNavShell({ classList: { contains: (name) => name === 'phone-shell' } })).toBe(true);
    expect(isPhoneNavShell({ classList: { contains: (name) => name === 'keyboard-open' } })).toBe(true);
    expect(isPhoneNavShell({ classList: { contains: () => false } })).toBe(false);
  });

  it('does not claim keys without a real text field target', () => {
    expect(navShouldIgnoreKey({ key: 'a', target: null }, true)).toBe(false);
    expect(navShouldIgnoreKey({ key: 'Escape', target: null }, true)).toBe(false);
    expect(navShouldIgnoreKey({ key: 'Backspace', target: null }, false)).toBe(false);
  });
});

describe('phone cameras', () => {
  it('treats launch tiles, seasons and hub bars as rails as well as poster rows', () => {
    expect(RAIL_SELECTOR).toContain('.rail__track');
    expect(RAIL_SELECTOR).toContain('.home__launcher');
    expect(RAIL_SELECTOR).toContain('.season-row');
    expect(RAIL_SELECTOR).toContain('.max-nav');
    expect(RAIL_SELECTOR).toContain('.dplus-brands');
  });

  it('does not steal a pointer that is not on owned chrome', () => {
    expect(isOwnedTouchTarget(null)).toBe(false);
  });
});
