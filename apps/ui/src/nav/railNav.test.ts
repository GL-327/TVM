import { describe, expect, it } from 'vitest';
import { neighborRowIndex, pickClosestIndex, wrapIndex } from './railNav';

describe('rail vertical nav', () => {
  it('picks the centre closest to the current card', () => {
    expect(pickClosestIndex([10, 50, 90], 48)).toBe(1);
    expect(pickClosestIndex([10, 50, 90], 8)).toBe(0);
    expect(pickClosestIndex([10, 50, 90], 91)).toBe(2);
    expect(pickClosestIndex([], 0)).toBe(-1);
  });

  it('moves one row and clamps at both ends', () => {
    expect(neighborRowIndex(2, 'up', 4)).toBe(1);
    expect(neighborRowIndex(0, 'up', 4)).toBeNull();
    expect(neighborRowIndex(2, 'down', 4)).toBe(3);
    expect(neighborRowIndex(3, 'down', 4)).toBeNull();
    expect(neighborRowIndex(0, 'down', 1)).toBeNull();
  });

  it('wraps left and right inside a rail', () => {
    expect(wrapIndex(4, 'right', 5)).toBe(0);
    expect(wrapIndex(0, 'left', 5)).toBe(4);
    expect(wrapIndex(1, 'right', 5)).toBe(2);
    expect(wrapIndex(1, 'left', 5)).toBe(0);
    expect(wrapIndex(0, 'right', 1)).toBe(0);
  });
});
