import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureWindowsMpv, pickMpvAsset, safeMpvEntries, type MpvAsset } from './mpvInstall.ts';

const bytes = Buffer.from('fixture archive');
const asset: MpvAsset = { name: 'mpv-x86_64-20261110.7z', size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, browser_download_url: 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/fixture/mpv.7z' };

describe('portable Windows playback setup', () => {
  it('requires a verified build for the CPU without assuming AVX2 support', () => {
    expect(pickMpvAsset([{ ...asset, name: 'mpv-x86_64-v3-fixture.7z' }, asset], 'x64')).toEqual(asset);
    expect(pickMpvAsset([asset], 'arm64')).toBeUndefined();
    expect(pickMpvAsset([{ ...asset, digest: '' }], 'x64')).toBeUndefined();
    expect(pickMpvAsset([{ ...asset, browser_download_url: 'https://example.test/mpv.7z' }], 'x64')).toBeUndefined();
    expect(safeMpvEntries('mpv.exe\ndoc/manual.pdf\n')).toBe(true);
    for (const path of ['../escape.exe', '/absolute.exe', 'C:/outside.exe', 'doc/../../escape.exe', '\\root.exe']) expect(safeMpvEntries(path)).toBe(false);
  });

  it('stages a verified player once and reuses it without downloading again', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tvm-mpv-'));
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      ++calls;
      return url.includes('api.github.com') ? Response.json({ assets: [asset] }) : new Response(bytes);
    }) as typeof fetch;
    const options = { platform: 'win32', arch: 'x64', env: { LOCALAPPDATA: root }, fetchImpl, extract: async (_archive: string, destination: string) => { await writeFile(join(destination, 'mpv.exe'), Buffer.from('MZfixture')); } };
    try {
      expect(await ensureWindowsMpv(options)).toBe(true);
      expect(await ensureWindowsMpv(options)).toBe(true);
      expect(calls).toBe(2);
      expect((await readFile(join(root, 'TVM/mpv/mpv.exe'))).toString()).toBe('MZfixture');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('refuses altered bytes before extraction and leaves no installed player', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tvm-mpv-'));
    let extracted = false;
    try {
      await expect(ensureWindowsMpv({ platform: 'win32', arch: 'x64', env: { LOCALAPPDATA: root }, fetchImpl: (async (url: string) => url.includes('api.github.com') ? Response.json({ assets: [asset] }) : new Response(Buffer.from('altered archive'))) as typeof fetch,
        extract: async () => { extracted = true; },
      })).rejects.toThrow('checksum failed');
      expect(extracted).toBe(false);
      expect(existsSync(join(root, 'TVM/mpv/mpv.exe'))).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
