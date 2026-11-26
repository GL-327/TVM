import { describe, expect, it } from 'vitest';
import { computeFps, formatFpsLabel } from './FpsOverlay';

describe('FPS overlay helpers', () => {
  it('computes rounded FPS over a valid millisecond interval', () => {
    expect(computeFps(60, 1000)).toBe(60);
    expect(computeFps(15, 1020)).toBe(15);
    expect(computeFps(0, 1000)).toBeNull();
    expect(computeFps(10, 0)).toBeNull();
    expect(computeFps(NaN, 1000)).toBeNull();
  });

  it('formats active samples and the initial pending state', () => {
    expect(formatFpsLabel(null)).toBe('— FPS');
    expect(formatFpsLabel(60)).toBe('60 FPS');
  });
});
