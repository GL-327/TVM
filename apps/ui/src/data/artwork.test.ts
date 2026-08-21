import { describe, expect, it } from 'vitest';
import { normalizeArtUrl, preferBackdrop, preferPoster, upgradeImageUrl } from './artwork';

describe('artwork urls', () => {
  it('promotes metahub and TMDB stills used on the hero', () => {
    expect(upgradeImageUrl('https://images.metahub.space/background/medium/tt0111161/img', 'backdrop')).toBe(
      'https://images.metahub.space/background/large/tt0111161/img',
    );
    expect(upgradeImageUrl('https://image.tmdb.org/t/p/w1280/abc.jpg', 'backdrop')).toBe(
      'https://image.tmdb.org/t/p/w780/abc.jpg',
    );
    expect(upgradeImageUrl('https://image.tmdb.org/t/p/original/poster.jpg', 'poster')).toBe(
      'https://image.tmdb.org/t/p/w342/poster.jpg',
    );
    expect(upgradeImageUrl('https://is1-ssl.mzstatic.com/image/thumb/foo/600x600bb.jpg', 'poster')).toContain(
      '780x780bb',
    );
  });

  it('fills a missing backdrop from metahub instead of stretching a poster', () => {
    expect(preferBackdrop('tt0111161', '', 'https://example/p.jpg')).toBe(
      'https://images.metahub.space/background/large/tt0111161/img',
    );
    expect(preferPoster('tt0111161', '', '')).toBe('https://images.metahub.space/poster/large/tt0111161/img');
  });

  it('turns protocol-relative, http CDN, and TMDB paths into loadable https srcs', () => {
    expect(normalizeArtUrl('//images.metahub.space/poster/medium/tt0111161/img')).toBe(
      'https://images.metahub.space/poster/medium/tt0111161/img',
    );
    expect(normalizeArtUrl('http://image.tmdb.org/t/p/w500/abc.jpg')).toBe(
      'https://image.tmdb.org/t/p/w500/abc.jpg',
    );
    expect(normalizeArtUrl('/t/p/w342/abc.jpg')).toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
    expect(normalizeArtUrl('/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg')).toBe(
      'https://image.tmdb.org/t/p/original/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
    );
    expect(upgradeImageUrl('//images.metahub.space/poster/medium/tt0111161/img', 'poster')).toBe(
      'https://images.metahub.space/poster/large/tt0111161/img',
    );
    expect(preferPoster('local:1', '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', '')).toBe(
      'https://image.tmdb.org/t/p/w342/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
    );
    expect(preferPoster('file:1', '', '')).toBe('');
  });
});
