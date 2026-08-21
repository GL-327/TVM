import { afterEach, describe, expect, it, vi } from 'vitest';
import { animate, cancelScrollAnim, isScrollAnimating, jumpAxis } from './scrollAnim';

function fakeEl(scrollLeft = 0, opts?: { scrollWidth?: number; clientWidth?: number; freeze?: boolean }) {
  let left = scrollLeft;
  const freeze = opts?.freeze === true;
  return {
    get scrollLeft() {
      return left;
    },
    set scrollLeft(value: number) {
      if (!freeze) left = value;
    },
    scrollTop: 0,
    scrollWidth: opts?.scrollWidth ?? 3000,
    clientWidth: opts?.clientWidth ?? 800,
    scrollHeight: 2000,
    clientHeight: 600,
  } as unknown as HTMLElement;
}

describe('scroll camera tween', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not run onSettle when the lerp is cancelled', () => {
    const el = fakeEl(0);
    const settle = vi.fn();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    animate(el, 'x', 400, settle);
    expect(isScrollAnimating(el)).toBe(true);
    cancelScrollAnim(el);
    expect(settle).not.toHaveBeenCalled();
    expect(isScrollAnimating(el)).toBe(false);
    jumpAxis(el, 'x', 10);
    expect(settle).not.toHaveBeenCalled();
  });

  it('finishes when writing scrollLeft does not move the camera', () => {
    const el = fakeEl(100, { freeze: true });
    const settle = vi.fn();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    animate(el, 'x', 400, settle);
    expect(frames).toHaveLength(1);
    frames[0]?.(0);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(isScrollAnimating(el)).toBe(false);
  });

  it('runs onSettle only after a natural finish', () => {
    const el = fakeEl(0);
    const settle = vi.fn();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    animate(el, 'x', 40, settle);
    for (let i = 0; i < 40 && frames.length > 0 && settle.mock.calls.length === 0; i += 1) {
      const cb = frames.shift();
      cb?.(0);
    }
    expect(settle).toHaveBeenCalledTimes(1);
    expect(isScrollAnimating(el)).toBe(false);
  });
});
