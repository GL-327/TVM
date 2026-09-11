import { describe, expect, it } from 'vitest';
import { readyHeroArt, settleHeroArt } from './heroArtState';

describe('hero artwork transitions', () => {
  it('keeps the last good frame when an older request finishes after rapid navigation', () => {
    const current = { current: 'a.jpg', previous: '' };
    expect(readyHeroArt(current, 'b.jpg', 'c.jpg')).toBe(current);
    expect(readyHeroArt(current, 'c.jpg', 'c.jpg')).toEqual({ current: 'c.jpg', previous: 'a.jpg' });
  });

  it('removes the outgoing image only after its replacement finishes fading', () => {
    const current = { current: 'b.jpg', previous: 'a.jpg' };
    expect(settleHeroArt(current, 'a.jpg')).toBe(current);
    expect(settleHeroArt(current, 'b.jpg')).toEqual({ current: 'b.jpg', previous: '' });
  });

  it('does not restart a fade for duplicate cached-image load notifications', () => {
    const current = { current: 'b.jpg', previous: 'a.jpg' };
    expect(readyHeroArt(current, 'b.jpg', 'b.jpg')).toBe(current);
  });
});
