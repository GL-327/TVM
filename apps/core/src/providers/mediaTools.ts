import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { safeMpvEntries, type MpvAsset } from './mpvInstall.ts';

export const runTool = promisify(execFile);
const ASSET_LIMIT = 200 * 1024 * 1024;
const exe = process.platform === 'win32' ? '.exe' : '';
const tar = exe && process.env['SystemRoot'] ? join(process.env['SystemRoot'], 'System32', 'tar.exe') : 'tar';
const headers = { 'User-Agent': 'TVM', Accept: 'application/vnd.github+json' };

export function verifiedAsset(assets: readonly MpvAsset[], repo: string, name: string): MpvAsset | undefined {
  return assets.find(asset => asset.name === name && /^sha256:[a-f0-9]{64}$/.test(asset.digest) &&
    Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= ASSET_LIMIT &&
    asset.browser_download_url.startsWith(`https://github.com/${repo}/releases/download/`) &&
    asset.browser_download_url.endsWith('/' + name));
}

async function downloadVerified(fetchImpl: typeof fetch, asset: MpvAsset, destination: string): Promise<void> {
  const res = await fetchImpl(asset.browser_download_url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new Error('Tool download unavailable');
  const digest = createHash('sha256');
  let length = 0;
  const check = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      length += chunk.length;
      if (length > asset.size) return done(new Error('Tool download exceeds expected size'));
      digest.update(chunk);
      done(null, chunk);
    },
  });
  await pipeline(Readable.from(res.body), check, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  if (length !== asset.size || `sha256:${digest.digest('hex')}` !== asset.digest) throw new Error('Tool checksum mismatch');
}

async function fetchRelease(fetchImpl: typeof fetch, repo: string): Promise<MpvAsset[]> {
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Tool release unavailable');
  const release = await response.json() as { assets?: MpvAsset[] };
  return Array.isArray(release.assets) ? release.assets : [];
}

async function ffmpegArchive(archive: string, stage: string, paths: string[]): Promise<void> {
  const flags = { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 30_000 };
  const { stdout } = await runTool(tar, ['-tf', archive], flags);
  const { stdout: details } = await runTool(tar, ['-tvf', archive], flags);
  if (!safeMpvEntries(stdout) || details.split(/\r?\n/).some(line => /^[lhbcps]/.test(line))) throw new Error('Unsafe tool archive');
  const entries = paths.map(file => stdout.split(/\r?\n/).filter(line => line.endsWith('/bin/' + basename(file))));
  if (!entries.every(items => items.length === 1)) throw new Error('Tool archive has missing executables');
  await runTool(tar, ['-xf', archive, '-C', stage, '--no-same-owner', '--no-same-permissions', ...entries.flat()], {
    windowsHide: true, timeout: 120_000,
  });
  for (const [index, [file]] of entries.entries()) await rename(join(stage, file!), paths[index]!);
}

const installed = new Map<string, Promise<string[]>>();
const retry = new Map<string, number>();
async function isFile(file: string): Promise<boolean> {
  return (await stat(file).catch(() => null))?.isFile() ?? false;
}
export function createMediaTools(dataDir: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch) {
  async function ensure(kind: 'yt-dlp' | 'ffmpeg'): Promise<string[]> {
    const root = join(dataDir, 'tools');
    const destination = join(root, kind);
    const names = kind === 'yt-dlp' ? ['yt-dlp' + exe] : ['ffmpeg' + exe, 'ffprobe' + exe];
    const paths = names.map(name => join(destination, name));
    const overrides = (kind === 'yt-dlp' ? [env['TVM_YTDLP_PATH']] : [env['TVM_FFMPEG_PATH'], env['TVM_FFPROBE_PATH']])
      .map(path => path?.trim() ?? '');
    if (overrides.every(isAbsolute) && (await Promise.all(overrides.map(isFile))).every(Boolean)) return overrides;
    if ((await Promise.all(paths.map(isFile))).every(Boolean)) return paths;
    if (env['TVM_SKIP_EXTRAS_TOOLS_INSTALL'] === '1') throw new Error('Tool install disabled');
    const pending = installed.get(destination);
    if (pending) return pending;
    if (Date.now() < (retry.get(destination) ?? 0)) throw new Error('Tool install cooling down');
    const task = install().catch((error: unknown) => {
      retry.set(destination, Date.now() + 60_000);
      throw error;
    }).finally(() => { if (installed.get(destination) === task) installed.delete(destination); });
    installed.set(destination, task);
    return task;

    async function install(): Promise<string[]> {
      const arch = process.arch;
      const platform = process.platform;
      const target = arch === 'x64' || arch === 'arm64';
      const yt = platform === 'win32' ? arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe'
        : platform === 'darwin' ? 'yt-dlp_macos' : arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
      const repo = kind === 'yt-dlp' ? 'yt-dlp/yt-dlp'
        : platform === 'darwin' ? 'eugeneware/ffmpeg-static' : 'yt-dlp/FFmpeg-Builds';
      const archive = kind === 'ffmpeg' && platform !== 'darwin'
        ? platform === 'win32' ? `ffmpeg-master-latest-win${arch === 'arm64' ? 'arm64' : '64'}-gpl.zip`
          : `ffmpeg-master-latest-linux${arch === 'arm64' ? 'arm64' : '64'}-gpl.tar.xz`
        : null;
      const assetNames = kind === 'yt-dlp' ? [yt] : archive ? [archive] : names.map(name => `${name}-darwin-${arch}`);
      if (!target || !['win32', 'linux', 'darwin'].includes(platform)) throw new Error('Tool platform unsupported');
      const assets = await fetchRelease(fetchImpl, repo);
      const chosen = assetNames.map(name => verifiedAsset(assets, repo, name));
      if (!chosen.every((asset): asset is MpvAsset => !!asset)) throw new Error('No verified tool release');
      await mkdir(root, { recursive: true });
      const stage = await mkdtemp(join(root, kind + '-stage-'));
      try {
        const publish = join(stage, 'publish');
        await mkdir(publish);
        const files = names.map(name => join(publish, name));
        if (archive) {
          const path = join(stage, archive);
          await downloadVerified(fetchImpl, chosen[0]!, path);
          await ffmpegArchive(path, stage, files);
        } else {
          await Promise.all(chosen.map((asset, index) => downloadVerified(fetchImpl, asset, files[index]!)));
        }
        for (const file of files) {
          if (!exe) await chmod(file, 0o700);
          await runTool(file, [kind === 'yt-dlp' ? '--version' : '-version'], { windowsHide: true, timeout: 10_000 });
        }
        try { await rename(publish, destination); }
        catch (error) {
          if (!(await Promise.all(paths.map(isFile))).every(Boolean)) {
            await rm(destination, { recursive: true, force: true });
            await rename(publish, destination);
          }
        }
        retry.delete(destination);
        return paths;
      } finally { await rm(stage, { recursive: true, force: true }); }
    }
  }
  return {
    ytdlp: async () => (await ensure('yt-dlp'))[0]!,
    ffmpeg: async () => {
      const [ffmpeg, ffprobe] = await ensure('ffmpeg');
      return { ffmpeg: ffmpeg!, ffprobe: ffprobe! };
    },
  };
}
