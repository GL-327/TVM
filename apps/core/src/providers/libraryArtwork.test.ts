import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { artworkCachePath } from '../update/paths.ts';
import { createLibraryArtwork } from './libraryArtwork.ts';
import type { MediaItem } from './types.ts';

describe('library artwork cache', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  async function directory(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-library-art-'));
    dirs.push(dir);
    return dir;
  }
  const item: MediaItem = { id: 'rd:d:1', title: 'Arrival', year: null, kind: 'file', synopsis: '', poster: '', backdrop: '', genres: [], rating: '', hue: 0, playable: true };
  const result = () => new Response(JSON.stringify({ results: [{ artworkUrl100: 'https://is1.mzstatic.com/100x100bb.jpg' }] }));

  it('shares lookups between episodes and persists one completed batch', async () => {
    const dir = await directory();
    const upstream = vi.fn(async () => result());
    const cache = createLibraryArtwork(dir, upstream);
    const decorated = await Promise.all([cache.decorate(item), cache.decorate({ ...item, title: ' ARRIVAL ' })]);
    expect(decorated.every((value) => value.poster.includes('2000x2000'))).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(existsSync(artworkCachePath(dir))).toBe(false);
    cache.flush();
    expect(Object.keys(JSON.parse(await readFile(artworkCachePath(dir), 'utf8')))).toEqual(['arrival']);
    const restored = createLibraryArtwork(dir, upstream);
    expect((await restored.decorate(item)).poster).toBe(decorated[0]?.poster);
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it('does not share cached artwork across separate data directories', async () => {
    const first = createLibraryArtwork(await directory(), async () => result());
    await first.decorate(item);
    const upstream = vi.fn(async () => new Response('{}'));
    const second = createLibraryArtwork(await directory(), upstream);
    expect((await second.decorate(item)).poster).toBe('');
    await second.decorate(item);
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it('does not refill or persist a cleared cache when an older lookup finishes', async () => {
    const dir = await directory();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const upstream = vi.fn(async () => { await gate; return result(); });
    const cache = createLibraryArtwork(dir, upstream);
    const pending = cache.decorate(item);
    cache.clear();
    release();
    await pending;
    cache.flush();
    expect(existsSync(artworkCachePath(dir))).toBe(false);
    await cache.decorate(item);
    expect(upstream).toHaveBeenCalledTimes(6);
  });
});
