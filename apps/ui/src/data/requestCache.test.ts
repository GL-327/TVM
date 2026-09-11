import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequestCache } from './requestCache';

afterEach(() => vi.useRealTimers());

describe('read cache', () => {
  it('shares concurrent work and serves fresh results', async () => {
    const cache = createRequestCache();
    const loader = vi.fn(async () => ({ title: 'Dune' }));
    const [a, b] = await Promise.all([cache.load('home', loader), cache.load('home', loader)]);
    expect(a).toBe(b);
    expect(await cache.load('home', loader)).toBe(a);
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it('expires entries and evicts least recently used reads', async () => {
    vi.useFakeTimers();
    const cache = createRequestCache(2);
    const loader = vi.fn(async () => 'value');
    await cache.load('a', loader, 100);
    await cache.load('b', loader, 100);
    await cache.load('a', loader, 100);
    await cache.load('c', loader, 100);
    await cache.load('b', loader, 100);
    expect(loader).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(101);
    await cache.load('b', loader, 100);
    expect(loader).toHaveBeenCalledTimes(5);
  });
  it('does not let an invalidated request overwrite a new result', async () => {
    const cache = createRequestCache();
    let resolveOld!: (value: string) => void;
    const old = cache.load('home', () => new Promise<string>((resolve) => { resolveOld = resolve; }));
    await Promise.resolve();
    cache.clear();
    await cache.load('home', async () => 'new profile');
    resolveOld('old profile');
    await old;
    expect(await cache.load('home', async () => 'unexpected')).toBe('new profile');
  });
  it('retries failures rather than caching them', async () => {
    const cache = createRequestCache();
    await expect(cache.load('a', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(await cache.load('a', async () => 'online')).toBe('online');
  });
});
