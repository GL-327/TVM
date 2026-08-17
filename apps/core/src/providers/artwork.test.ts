import { describe, expect, it } from 'vitest';
import { preferBackdrop, upgradeImageUrl } from './artwork.ts';

describe('artwork urls', () => {
  it('promotes metahub and TMDB stills used on the hero', () => {
    expect(upgradeImageUrl('https://images.metahub.space/background/medium/tt0111161/img', 'backdrop')).toBe(
      'https://images.metahub.space/background/large/tt0111161/img',
    );
    expect(upgradeImageUrl('https://image.tmdb.org/t/p/w1280/abc.jpg', 'backdrop')).toBe(
      'https://image.tmdb.org/t/p/original/abc.jpg',
    );
  });

  it('fills a missing backdrop from metahub instead of stretching a poster', () => {
    expect(preferBackdrop('tt0111161', '', 'https://example/p.jpg')).toBe(
      'https://images.metahub.space/background/large/tt0111161/img',
    );
  });
});
