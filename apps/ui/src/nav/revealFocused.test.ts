import { describe, expect, it } from 'vitest';
import { rowCameraTop } from './revealFocused';

describe('home camera', () => {
  it('locks a row just below the sticky ribbon', () => {
    expect(rowCameraTop(0, 640, 0, 72)).toBe(568);
    expect(rowCameraTop(200, 120, 0, 72)).toBe(248);
  });
});
