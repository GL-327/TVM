import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const RELEASE = 'https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest';
const LIMIT = 200 * 1024 * 1024;
export interface MpvAsset { name: string; browser_download_url: string; digest: string; size: number }

export function pickMpvAsset(assets: readonly MpvAsset[], arch: string): MpvAsset | undefined {
  return assets.find(asset => {
    const name = asset.name.toLowerCase();
    if (!/^mpv-.+\.(7z|zip)$/.test(name) || /dev|debug|ffmpeg|src|x86_64-v[2-9]|x64-v[2-9]/.test(name)) return false;
    const supported = arch === 'arm64' ? /aarch64|arm64/.test(name) : arch === 'x64' && /x86_64|x64|win64/.test(name) && !/arm|aarch|i686/.test(name);
    return supported && /^sha256:[a-f0-9]{64}$/.test(asset.digest) && asset.size > 0 && asset.size <= LIMIT &&
      asset.browser_download_url.startsWith('https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/');
  });
}

export function safeMpvEntries(list: string): boolean {
  const entries = list.split(/\r?\n/).filter(Boolean);
  return entries.length > 0 && entries.length <= 4096 && entries.every(entry => {
    const path = entry.replaceAll('\\', '/');
    return path.length <= 1024 && !path.startsWith('/') && !path.includes(':') && !path.includes('\0') && !path.split('/').includes('..');
  });
}

const installs = new Map<string, Promise<boolean>>();
export function ensureWindowsMpv(options: {
  env?: NodeJS.ProcessEnv; platform?: string; arch?: string; fetchImpl?: typeof fetch;
  extract?: (archive: string, destination: string) => Promise<void>;
} = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  if ((options.platform ?? process.platform) !== 'win32' || env['TVM_SKIP_MPV_INSTALL'] === '1') return Promise.resolve(false);
  if (env['TVM_MPV_PATH']?.trim()) return Promise.resolve(existsSync(env['TVM_MPV_PATH'].trim()));
  const local = env['LOCALAPPDATA'];
  if (!local) return Promise.resolve(false);
  const destination = resolve(local, 'TVM', 'mpv');
  if (existsSync(join(destination, 'mpv.exe'))) return Promise.resolve(true);
  const existing = installs.get(destination);
  if (existing) return existing;
  const task = install().finally(() => installs.delete(destination));
  installs.set(destination, task);
  return task;

  async function install(): Promise<boolean> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(RELEASE, { headers: { 'User-Agent': 'TVM', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('Playback setup could not reach the mpv release.');
    const release = await response.json() as { assets?: MpvAsset[] };
    const asset = pickMpvAsset(Array.isArray(release.assets) ? release.assets : [], options.arch ?? process.arch);
    if (!asset) throw new Error('No verified mpv build is available for this computer.');
    const parent = resolve(local!, 'TVM');
    await mkdir(parent, { recursive: true });
    const stage = await mkdtemp(join(parent, 'mpv-stage-'));
    try {
      const download = await fetchImpl(asset.browser_download_url, { signal: AbortSignal.timeout(120_000) });
      if (!download.ok || !download.body) throw new Error('Playback setup download failed.');
      let length = 0;
      const chunks: Uint8Array[] = [];
      for await (const chunk of download.body) {
        length += chunk.byteLength;
        if (length > asset.size || length > LIMIT) throw new Error('Playback setup download exceeded its size limit.');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (length !== asset.size || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== asset.digest) throw new Error('Playback setup checksum failed.');
      const archive = join(stage, asset.name.replaceAll(/[^A-Za-z0-9._-]/g, '_'));
      await writeFile(archive, bytes);
      const extracted = join(stage, 'verified');
      await mkdir(extracted);
      if (options.extract) await options.extract(archive, extracted);
      else {
        const { stdout } = await exec('tar.exe', ['-tf', archive], { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 30_000 });
        const { stdout: details } = await exec('tar.exe', ['-tvf', archive], { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 30_000 });
        if (!safeMpvEntries(stdout) || details.split(/\r?\n/).some(line => /^[lh]/.test(line))) throw new Error('Unsafe playback setup archive.');
        await exec('tar.exe', ['-xf', archive, '-C', extracted, '--no-same-owner', '--no-same-permissions'], { windowsHide: true, timeout: 120_000 });
      }
      // Keep the existing installation until the replacement has a Windows executable.
      const executable = await readFile(join(extracted, 'mpv.exe'));
      if (executable[0] !== 0x4d || executable[1] !== 0x5a) throw new Error('Playback setup has no Windows player.');
      const backup = `${destination}.previous-${randomUUID()}`;
      const hadPrevious = existsSync(destination);
      if (hadPrevious) await rename(destination, backup);
      try { await rename(extracted, destination); }
      catch (error) { if (hadPrevious) await rename(backup, destination); throw error; }
      if (hadPrevious && backup.startsWith(parent + sep)) await rm(backup, { recursive: true, force: true });
      return true;
    } finally {
      if (stage.startsWith(parent + sep)) await rm(stage, { recursive: true, force: true });
    }
  }
}
