import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { artworkCachePath, catalogCachePath, rdTokenPath } from '../update/paths.ts';
import { clearCacheDir, factoryResetDir } from './maintenance.ts';

describe('maintenance', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('clears artwork and catalog caches without touching the Real-Debrid token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-maint-'));
    dirs.push(dir);
    await mkdir(join(dir, 'cache'), { recursive: true });
    await mkdir(join(dir, 'secrets'), { recursive: true });
    await writeFile(artworkCachePath(dir), '{}');
    await writeFile(catalogCachePath(dir), '{}');
    await writeFile(rdTokenPath(dir), 'keep-me');
    clearCacheDir(dir);
    await expect(readFile(rdTokenPath(dir), 'utf8')).resolves.toBe('keep-me');
  });

  it('deletes the Real-Debrid token on a full reset', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-reset-'));
    dirs.push(dir);
    await mkdir(join(dir, 'secrets'), { recursive: true });
    await writeFile(rdTokenPath(dir), 'wipe-me');
    factoryResetDir(dir);
    await expect(readFile(rdTokenPath(dir), 'utf8')).rejects.toThrow();
  });
});
