import { describe, expect, it } from 'vitest';
import { heroScrollFade } from './heroFade';

describe('heroScrollFade', () => {
  it('holds the picture until the camera starts to pan, then fades it out', () => {
    expect(heroScrollFade(0, 800)).toBe(1);
    expect(heroScrollFade(368, 800)).toBe(0.5);
    expect(heroScrollFade(800, 800)).toBe(0);
    expect(heroScrollFade(-20, 800)).toBe(1);
  });
});
