import { describe, expect, it } from 'vitest';
import { isAllowedArtUrl } from './artProxy.ts';

describe('art proxy allowlist', () => {
  it('only hops known artwork CDNs', () => {
    expect(isAllowedArtUrl('https://image.tmdb.org/t/p/w342/abc.jpg')?.hostname).toBe('image.tmdb.org');
    expect(isAllowedArtUrl('https://images.metahub.space/poster/large/tt0111161/img')?.hostname).toBe(
      'images.metahub.space',
    );
    expect(isAllowedArtUrl('https://evil.example/secret.jpg')).toBeNull();
    expect(isAllowedArtUrl('file:///etc/passwd')).toBeNull();
    expect(isAllowedArtUrl('not a url')).toBeNull();
  });
});
