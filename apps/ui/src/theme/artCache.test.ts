import { describe, expect, it } from 'vitest';
import { ArtCache } from './artCache';

describe('artwork cache budget', () => {
  it('keeps recently used entries when another catalog fills the cache', () => {
    const cache = new ArtCache(2, 1000);
    cache.set('a', 'image-a');
    cache.set('b', 'image-b');
    expect(cache.get('a')).toBe('image-a');
    cache.set('c', 'image-c');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('image-a');
    expect(cache.get('c')).toBe('image-c');
  });

  it('bounds encoded bytes as well as image count', () => {
    const cache = new ArtCache(20, 12);
    cache.set('a', '1234');
    cache.set('b', '5678');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('5678');
    cache.set('large', '1234567');
    expect(cache.get('large')).toBeUndefined();
  });

  it('does not charge replaced entries twice', () => {
    const cache = new ArtCache(20, 12);
    cache.set('a', '1234');
    cache.set('a', '12');
    cache.set('b', '3456');
    expect(cache.get('a')).toBe('12');
    expect(cache.get('b')).toBe('3456');
  });
});
