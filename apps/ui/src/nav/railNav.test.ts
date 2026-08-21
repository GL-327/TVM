import { describe, expect, it } from 'vitest';
import { neighborRowIndex, pickClosestIndex, railHopDistance, VERTICAL_ROW_SELECTOR, wrapIndex } from './railNav';

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

  it('never skips a category row', () => {
    expect(neighborRowIndex(0, 'down', 6)).toBe(1);
    expect(neighborRowIndex(1, 'down', 6)).toBe(2);
    expect(neighborRowIndex(4, 'up', 6)).toBe(3);
  });

  it('wraps left and right inside a rail', () => {
    expect(wrapIndex(4, 'right', 5)).toBe(0);
    expect(wrapIndex(0, 'left', 5)).toBe(4);
    expect(wrapIndex(1, 'right', 5)).toBe(2);
    expect(wrapIndex(1, 'left', 5)).toBe(0);
    expect(wrapIndex(0, 'right', 1)).toBe(0);
  });

  it('cannot skip a title when holding left or right, including looping', () => {
    for (const count of [2, 3, 5, 8, 12, 20]) {
      const seen = new Set<number>();
      let index = 0;
      for (let step = 0; step < count; step += 1) {
        const next = wrapIndex(index, 'right', count);
        expect(next).not.toBeNull();
        expect(railHopDistance(index, next ?? -1, count)).toBe(1);
        seen.add(index);
        index = next ?? index;
      }
      expect(seen.size).toBe(count);
      expect(index).toBe(0);

      const left = wrapIndex(0, 'left', count);
      expect(left).toBe(count - 1);
      expect(railHopDistance(0, left ?? -1, count)).toBe(1);
    }
  });

  it('treats hub hero actions as a row so Down from Play reaches the next rail', () => {
    expect(VERTICAL_ROW_SELECTOR).toContain('.service-hero__actions');
    expect(VERTICAL_ROW_SELECTOR).toContain('.hulu-hub__actions');
    expect(VERTICAL_ROW_SELECTOR).toContain('.appletv-hub__actions');
    expect(VERTICAL_ROW_SELECTOR).toContain('.peacock-hub__actions');
    expect(VERTICAL_ROW_SELECTOR).toContain('.legacy-hub__actions');
    expect(VERTICAL_ROW_SELECTOR).toContain('.service-rail');
    expect(VERTICAL_ROW_SELECTOR).not.toContain('.settings-row');
  });
});
