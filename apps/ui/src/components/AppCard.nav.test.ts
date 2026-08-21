import { describe, expect, it } from 'vitest';
import { appGridCameraY, pickGridNeighborIndex } from './appGridNav';

describe('pickGridNeighborIndex', () => {
  const tops = [10, 10, 10, 80, 80, 80];
  const centers = [0, 100, 200, 0, 100, 200];

  it('moves Down from the first row to the same column on the next row', () => {
    expect(pickGridNeighborIndex(tops, centers, 0, 'down')).toBe(3);
    expect(pickGridNeighborIndex(tops, centers, 1, 'down')).toBe(4);
    expect(pickGridNeighborIndex(tops, centers, 2, 'down')).toBe(5);
  });

  it('moves Up from the second row back to the first', () => {
    expect(pickGridNeighborIndex(tops, centers, 4, 'up')).toBe(1);
    expect(pickGridNeighborIndex(tops, centers, 3, 'up')).toBe(0);
  });

  it('leaves the first row on Up and the last row on Down', () => {
    expect(pickGridNeighborIndex(tops, centers, 1, 'up')).toBeNull();
    expect(pickGridNeighborIndex(tops, centers, 5, 'down')).toBeNull();
  });
});

describe('appGridCameraY', () => {
  it('keeps the first row at the page top', () => {
    expect(appGridCameraY(0, 0, 120, 120)).toBe(0);
    expect(appGridCameraY(40, 0, 48, 40)).toBe(0);
  });

  it('locks a later row just under the chrome', () => {
    expect(appGridCameraY(0, 0, 640, 120, 16)).toBe(624);
    expect(appGridCameraY(200, 0, 120, 40, 16)).toBe(304);
  });
});
