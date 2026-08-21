import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { mpvFilename, mpvInstallDir, resolveMpvExecutable } from './mpv';

const execFileAsync = promisify(execFile);
const MPV_RELEASE = 'https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest';

export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

let inflight: Promise<string | undefined> | undefined;

export function pickWindowsMpvAsset(
  assets: readonly GithubReleaseAsset[],
  arch: string = process.arch,
): GithubReleaseAsset | null {
  let best: GithubReleaseAsset | null = null;
  let bestScore = -1;
  for (const asset of assets) {
    const score = scoreWindowsMpvAsset(asset.name, arch);
    if (score === null || score <= bestScore) continue;
    best = asset;
    bestScore = score;
  }
  return best;
}

export function scoreWindowsMpvAsset(name: string, arch: string): number | null {
  const n = name.toLowerCase();
  if (!n.startsWith('mpv-')) return null;
  if (n.includes('dev') || n.includes('debug') || n.includes('ffmpeg') || n.includes('src')) return null;
  if (!n.endsWith('.7z') && !n.endsWith('.zip')) return null;

  let archScore: number;
  if (arch === 'arm64') {
    if (!n.includes('aarch64') && !n.includes('arm64')) return null;
    archScore = 4;
  } else {
    if (n.includes('aarch64') || n.includes('arm64') || n.includes('i686')) return null;
    if (n.includes('x86_64-v3') || n.includes('x64-v3')) archScore = 6;
    else if (n.includes('x86_64') || n.includes('x64') || n.includes('win64')) archScore = 5;
    else return null;
  }

  return archScore + (n.endsWith('.zip') ? 1 : 0);
}

async function extractArchive(archive: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  await execFileAsync('tar', ['-xf', archive, '-C', dest], { windowsHide: true });
}

async function downloadFile(url: string, dest: string, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'TVM', Accept: 'application/octet-stream' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`mpv download failed (${response.status})`);
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}

async function latestWindowsAsset(fetchImpl: typeof fetch, arch: string): Promise<GithubReleaseAsset | null> {
  const response = await fetchImpl(MPV_RELEASE, {
    headers: { 'User-Agent': 'TVM', Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { assets?: GithubReleaseAsset[] };
  if (!Array.isArray(body.assets)) return null;
  return pickWindowsMpvAsset(body.assets, arch);
}

async function installWindowsMpv(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  arch: string,
): Promise<string | undefined> {
  const asset = await latestWindowsAsset(fetchImpl, arch);
  if (asset === null) return undefined;

  const dest = mpvInstallDir(env, 'win32');
  const cacheDir = join(env['LOCALAPPDATA'] ?? dest, 'TVM', 'cache');
  await mkdir(cacheDir, { recursive: true });
  const archive = join(cacheDir, asset.name);
  await rm(dest, { recursive: true, force: true });
  await downloadFile(asset.browser_download_url, archive, fetchImpl);
  await extractArchive(archive, dest);
  return resolveMpvExecutable(env, undefined, 'win32');
}

/**
 * Find mpv, or download a portable Windows build into %LOCALAPPDATA%\TVM\mpv.
 * Linux/macOS keep using a system install. Tests set TVM_SKIP_MPV_INSTALL=1.
 */
export async function ensureMpvExecutable(
  env: NodeJS.ProcessEnv = process.env,
  resourcesPath: string | undefined = process.resourcesPath,
  platform: NodeJS.Platform = process.platform,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const configured = env['TVM_MPV_PATH']?.trim();
  if (configured !== undefined && configured !== '') return configured;

  const existing = resolveMpvExecutable(env, resourcesPath, platform);
  if (existing !== undefined) return existing;
  if (env['TVM_SKIP_MPV_INSTALL'] === '1') return undefined;
  if (platform !== 'win32') return undefined;

  inflight ??= installWindowsMpv(env, fetchImpl, process.arch)
    .catch(() => undefined)
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

export function mpvCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(mpvInstallDir(env), mpvFilename());
}
