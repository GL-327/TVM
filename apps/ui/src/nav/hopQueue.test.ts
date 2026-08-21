import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAxisHopQueue, AXIS_HOP_MAX_PENDING } from './hopQueue';

const dir = dirname(fileURLToPath(import.meta.url));

describe('axis hop queue', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('applies one hop per frame and keeps extras for the next frames', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const hop = vi.fn();
    const queue = createAxisHopQueue(hop, 3);
    queue.push('right');
    queue.push('right');
    queue.push('right');
    expect(hop).not.toHaveBeenCalled();

    frames.shift()?.(0);
    expect(hop).toHaveBeenCalledTimes(1);
    expect(hop).toHaveBeenLastCalledWith('right');

    frames.shift()?.(0);
    expect(hop).toHaveBeenCalledTimes(2);

    frames.shift()?.(0);
    expect(hop).toHaveBeenCalledTimes(3);
    expect(frames).toHaveLength(0);
  });

  it('drops a backlog when the direction flips', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const hop = vi.fn();
    const queue = createAxisHopQueue(hop, 3);
    queue.push('right');
    queue.push('right');
    queue.push('left');
    frames.shift()?.(0);
    expect(hop).toHaveBeenCalledTimes(1);
    expect(hop).toHaveBeenCalledWith('left');
  });

  it('coalesces Up/Down the same way so category rows are not skipped', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const hop = vi.fn();
    const queue = createAxisHopQueue(hop, 3);
    queue.push('down');
    queue.push('down');
    queue.push('down');
    expect(hop).not.toHaveBeenCalled();
    frames.shift()?.(0);
    expect(hop).toHaveBeenCalledTimes(1);
    expect(hop).toHaveBeenCalledWith('down');
  });

  it('queues vertical hops on the view stack so a lagged frame cannot skip rails', () => {
    const src = readFileSync(join(dir, 'ViewStackProvider.tsx'), 'utf8');
    expect(src).toContain('runVerticalHop');
    expect(src).toContain("intent === 'left' || intent === 'right' || intent === 'up' || intent === 'down'");
    expect(src).toContain('dpad.push(intent)');
    expect(src).not.toContain('dpadBusy');
    expect(src).not.toContain('isScrollAnimating');
    expect(src).toContain('settleWrappingTrack(wrapping)');
    const queue = readFileSync(join(dir, 'hopQueue.ts'), 'utf8');
    expect(queue).not.toContain('BUSY_RETRIES');
    expect(queue).not.toContain('busyTries');
    expect(src).not.toContain('horizontal.push');
    expect(src).not.toContain('settleWrappingTrack(wrappingTrack)');
  });

  it('collapses a key burst so one press cannot skip titles', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    expect(AXIS_HOP_MAX_PENDING).toBe(1);
    const hop = vi.fn();
    const queue = createAxisHopQueue(hop);
    queue.push('right');
    queue.push('right');
    queue.push('right');
    frames.shift()?.(0);
    expect(hop).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
  });

  it('hops on the first frame instead of waiting for the camera to idle', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const hop = vi.fn();
    const queue = createAxisHopQueue(hop);
    queue.push('right');
    frames.shift()?.(0);
    expect(hop).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
  });
});
