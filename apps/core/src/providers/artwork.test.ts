import { describe, expect, it } from 'vitest';
import { artworkFor, normalizeArtUrl, preferBackdrop, upgradeImageUrl } from './artwork.ts';

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

  it('turns protocol-relative CDN urls into https srcs', () => {
    expect(normalizeArtUrl('//images.metahub.space/poster/medium/tt0111161/img')).toBe(
      'https://images.metahub.space/poster/medium/tt0111161/img',
    );
    expect(upgradeImageUrl('//images.metahub.space/poster/medium/tt0111161/img', 'poster')).toBe(
      'https://images.metahub.space/poster/large/tt0111161/img',
    );
  });
});

describe('artwork lookup resilience', () => {
  it('keeps a healthy provider result when another provider rejects', async () => {
    const artwork = await artworkFor('Arrival', async (input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (String(input).includes('tvmaze')) throw new Error('offline');
      return new Response(JSON.stringify({ results: [{ artworkUrl100: 'https://is1.mzstatic.com/100x100bb.jpg' }] }));
    });
    expect(artwork?.poster).toBe('https://is1.mzstatic.com/2000x2000bb.jpg');
  });
});
