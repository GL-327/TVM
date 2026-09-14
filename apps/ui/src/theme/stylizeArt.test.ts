import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('phosphor artwork scheduling', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('returns the original image after a network failure and permits a later retry', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    const { stylizeArt, stylizeFailed } = await import('./stylizeArt');
    await expect(stylizeArt('/poster.jpg')).resolves.toBeNull();
    expect(stylizeFailed('/poster.jpg', 'poster')).toBe(true);
    await expect(stylizeArt('/poster.jpg')).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
    expect(stylizeFailed('/poster.jpg', 'poster')).toBe(false);
    await stylizeArt('/poster.jpg');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('recognizes data URLs as already painted without fetching or waiting', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { stylizeArt, peekStylize } = await import('./stylizeArt');
    const src = 'data:image/png;base64,AA';
    expect(peekStylize(src, 'poster')).toBe(src);
    await expect(stylizeArt(src)).resolves.toBe(src);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shares a request between clones while one consumer is cancelled', async () => {
    let resolve: (response: { ok: boolean }) => void = () => undefined;
    const fetch = vi.fn(() => new Promise<{ ok: boolean }>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetch);
    const { stylizeArt } = await import('./stylizeArt');
    const controller = new AbortController();
    const one = stylizeArt('/shared.jpg', 'poster', controller.signal);
    const two = stylizeArt('/shared.jpg');
    controller.abort();
    expect(fetch.mock.calls).toHaveLength(1);
    resolve({ ok: false });
    await expect(Promise.all([one, two])).resolves.toEqual([null, null]);
  });

  it('never fetches cancelled work that is waiting behind the two decode slots', async () => {
    const resolvers: Array<(response: { ok: boolean }) => void> = [];
    const fetch = vi.fn(() => new Promise<{ ok: boolean }>((done) => { resolvers.push(done); }));
    vi.stubGlobal('fetch', fetch);
    const { stylizeArt, stylizeFailed } = await import('./stylizeArt');
    const a = stylizeArt('/a.jpg');
    const b = stylizeArt('/b.jpg');
    const controller = new AbortController();
    const c = stylizeArt('/c.jpg', 'poster', controller.signal);
    expect(fetch).toHaveBeenCalledTimes(2);
    controller.abort();
    resolvers.forEach((done) => done({ ok: false }));
    await expect(Promise.all([a, b, c])).resolves.toEqual([null, null, null]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(stylizeFailed('/c.jpg', 'poster')).toBe(false);
  });

  it('never fetches or occupies a decode slot for a backdrop', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { stylizeArt, DECODE_SLOTS } = await import('./stylizeArt');
    expect(DECODE_SLOTS).toBe(2);
    await expect(stylizeArt('/hero.jpg', 'backdrop', undefined, 'mosaic')).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks the CDN for a tile-sized still instead of decoding a hero or 342 poster', async () => {
    const { cheapArtUrl } = await import('./stylizeArt');
    expect(cheapArtUrl('https://image.tmdb.org/t/p/w342/abc.jpg')).toBe('https://image.tmdb.org/t/p/w185/abc.jpg');
    expect(cheapArtUrl('https://image.tmdb.org/t/p/original/wide.jpg')).toBe('https://image.tmdb.org/t/p/w185/wide.jpg');
    expect(cheapArtUrl('https://images.metahub.space/poster/large/tt1/img')).toBe(
      'https://images.metahub.space/poster/medium/tt1/img',
    );
    expect(cheapArtUrl('https://cdn.example/art.jpg')).toBe('https://cdn.example/art.jpg');
  });
});
