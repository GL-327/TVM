import { afterEach, describe, expect, it, vi } from 'vitest';
import { animate, cancelScrollAnim, isScrollAnimating, jumpAxis, scrollEase, scrollTarget } from './scrollAnim';

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

  it('covers the same distance at 30, 60 and 120 Hz for the same elapsed time', () => {
    const response30 = scrollEase(1000 / 30);
    const response60 = 1 - (1 - scrollEase(1000 / 60)) ** 2;
    const response120 = 1 - (1 - scrollEase(1000 / 120)) ** 4;
    expect(response30).toBeCloseTo(response60, 10);
    expect(response30).toBeCloseTo(response120, 10);
  });

  it('reports the in-flight target so wheel notches accumulate mid-tween', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const el = fakeEl(100);
    expect(scrollTarget(el, 'x')).toBe(100);
    animate(el, 'x', 500);
    expect(scrollTarget(el, 'x')).toBe(500);
    animate(el, 'x', scrollTarget(el, 'x') + 200);
    expect(scrollTarget(el, 'x')).toBe(700);
    expect(scrollTarget(el, 'y')).toBe(0);
    cancelScrollAnim(el);
  });

  it('settles synchronously without a frame when reduced motion is requested', async () => {
    const dataset: Record<string, string> = {};
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener: vi.fn() }) });
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    const motion = await import('../theme/motion');
    motion.applyMotionPreference('reduced');
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const settle = vi.fn();
    const el = fakeEl();
    animate(el, 'x', 400, settle);
    expect(el.scrollLeft).toBe(400);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(raf).not.toHaveBeenCalled();
    expect(isScrollAnimating(el)).toBe(false);
    motion.applyMotionPreference('auto');
  });

  it('releases a removed element without firing its wrap completion', () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const el = Object.assign(fakeEl(), { isConnected: false });
    const settle = vi.fn();
    animate(el, 'x', 400, settle);
    frame?.(16);
    expect(isScrollAnimating(el)).toBe(false);
    expect(settle).not.toHaveBeenCalled();
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

  it('keeps fractional progress on devices that round each scroll write', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const el = fakeEl();
    let rounded = 0;
    Object.defineProperty(el, 'scrollLeft', { get: () => rounded, set: (value: number) => { rounded = Math.round(value); } });
    const settle = vi.fn();
    animate(el, 'x', 100, settle);
    for (let i = 0; i < 90 && frames.length > 0; i += 1) frames.shift()?.(i * 1000 / 120);
    expect(el.scrollLeft).toBe(100);
    expect(settle).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(0);
  });

  it('ignores invalid targets without poisoning a running camera', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const el = fakeEl();
    animate(el, 'x', 100);
    animate(el, 'x', Number.NaN);
    expect(scrollTarget(el, 'x')).toBe(100);
    cancelScrollAnim(el);
  });

  it('snaps an in-flight tween when performance mode turns on', async () => {
    vi.resetModules();
    const frames: FrameRequestCallback[] = [];
    const dataset: Record<string, string> = {};
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: vi.fn() }) });
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    const scroll = await import('./scrollAnim');
    const motion = await import('../theme/motion');
    const el = fakeEl();
    const settle = vi.fn();
    scroll.animate(el, 'x', 400, settle);
    expect(scroll.isScrollAnimating(el)).toBe(true);
    motion.applyPerformanceMode(true);
    expect(el.scrollLeft).toBe(400);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(scroll.isScrollAnimating(el)).toBe(false);
    expect(dataset.motion).toBe('reduced');
    expect(dataset.perf).toBe('on');
  });
});
