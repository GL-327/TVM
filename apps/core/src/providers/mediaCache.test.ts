import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyProgress, createMediaService } from './media.ts';
import { createRealDebrid, type RdDownload } from './realdebrid.ts';
import type { MediaItem } from './types.ts';

describe('media caching and progress', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  const file = (id = '1'): RdDownload => ({ id, filename: 'Arrival.2016.mp4', link: 'https://example.com/arrival' });

  async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-media-cache-'));
    dirs.push(dir);
    const rd = createRealDebrid({ dataDir: dir, env: { TVM_RD_TOKEN: 'fixture-token' } });
    const downloads = vi.spyOn(rd, 'downloads').mockResolvedValue([file()]);
    const torrents = vi.spyOn(rd, 'torrents').mockResolvedValue([]);
    const status = vi.spyOn(rd, 'status').mockResolvedValue({ configured: true, username: 'Fixture', premium: true, error: null });
    const media = createMediaService({ dataDir: dir, rd, fetch: async () => new Response('{}') });
    return { media, downloads, torrents, status };
  }

  it('shares simultaneous library and account requests', async () => {
    const { media, downloads, torrents, status } = await fixture();
    const libraries = await Promise.all(Array.from({ length: 8 }, () => media.library()));
    expect(libraries.every((items) => items[0]?.id === 'rd:d:1')).toBe(true);
    expect(downloads).toHaveBeenCalledTimes(1);
    expect(torrents).toHaveBeenCalledTimes(1);
    await Promise.all(Array.from({ length: 8 }, () => media.status()));
    expect(status).toHaveBeenCalledTimes(1);
  });

  it('updates progress immediately without reloading files and isolates profiles', async () => {
    const { media, downloads } = await fixture();
    const firstProfile = media.profiles().activeId;
    await media.library();
    media.saveProgress('rd:d:1', 900, 3600);
    expect((await media.library())[0]?.progress).toBe(0.25);
    media.saveProgress('rd:d:1', 1800, 3600);
    expect((await media.item('rd:d:1'))?.progress).toBe(0.5);
    media.createProfile('Second');
    expect((await media.library())[0]?.progress).toBeUndefined();
    media.switchProfile(firstProfile);
    expect((await media.library())[0]?.progress).toBe(0.5);
    media.saveProgress('rd:d:1', 3599, 3600);
    expect((await media.library())[0]?.progress).toBeUndefined();
    expect(downloads).toHaveBeenCalledTimes(1);
  });

  it('keeps the requesting profile when another request switches profiles while Home loads', async () => {
    const { media, status } = await fixture();
    await media.library();
    media.saveProgress('rd:d:1', 900, 3600);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    status.mockImplementation(async () => {
      await gate;
      return { configured: true, username: 'Fixture', premium: true, error: null };
    });
    const home = media.home();
    media.createProfile('Second');
    release();
    expect((await home).continueWatching[0]?.progress).toBe(0.25);
    expect((await media.home()).continueWatching).toEqual([]);
  });

  it('does not let an older request refill the library after cache clear', async () => {
    const { media, downloads } = await fixture();
    let release!: (files: RdDownload[]) => void;
    downloads.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = media.library();
    media.clearCache();
    downloads.mockResolvedValue([file('new')]);
    expect((await media.library())[0]?.id).toBe('rd:d:new');
    release([file('old')]);
    await old;
    expect((await media.library())[0]?.id).toBe('rd:d:new');
    expect(downloads).toHaveBeenCalledTimes(2);
  });

  it('retains cached files when one part of a refresh fails', async () => {
    const { media, downloads, torrents } = await fixture();
    await media.library();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 46_000);
    downloads.mockRejectedValue(new Error('offline'));
    torrents.mockResolvedValue([{ id: 'new', filename: 'Dune.2021.mkv', status: 'downloaded', progress: 100, links: ['https://example.com/dune'] }]);
    expect((await media.library()).map((item) => item.id)).toEqual(['rd:t:new:0', 'rd:d:1']);
  });

  it('indexes child progress with exact namespace boundaries and removes stale values', () => {
    const item: MediaItem = { id: 'tt1', title: 'One', year: null, kind: 'series', synopsis: '', poster: '', backdrop: '', genres: [], rating: '', hue: 0, playable: true, progress: 0.5 };
    const progress = {
      'tt1:1:1': { position: 900, duration: 3600, updated: '2026-01-01' },
      'tt10:1:1': { position: 2700, duration: 3600, updated: '2026-01-01' },
    };
    expect(applyProgress([item], progress)[0]?.progress).toBe(0.25);
    expect(applyProgress([item], {})[0]?.progress).toBeUndefined();
    expect(item.progress).toBe(0.5);
  });
});
