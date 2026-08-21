import { existsSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export interface MpvLaunchOptions {
  url: string;
  windowId: string;
  ipcPath: string;
  startAt?: number;
  platform?: NodeJS.Platform;
}

export type PathExists = (path: string) => boolean;

/**
 * Embed into a Chromium-free host HWND. A separate --ontop window steals
 * focus from TVM; --wid on the BrowserWindow itself is covered by Chromium.
 * auto-copy is the decode path that actually paints into a foreign window.
 */
export function buildMpvArgs(options: MpvLaunchOptions): string[] {
  const platform = options.platform ?? process.platform;
  const args = [
    `--input-ipc-server=${options.ipcPath}`,
    `--wid=${options.windowId}`,
    '--no-terminal',
    '--really-quiet',
    '--no-config',
    '--ytdl=no',
    '--force-window=yes',
    '--keep-open=no',
    '--hwdec=auto-copy',
    '--vo=gpu',
    '--cache=yes',
    '--cache-secs=60',
    '--cache-pause-initial=yes',
    '--cache-pause-wait=2',
    '--demuxer-max-bytes=256MiB',
    '--demuxer-max-back-bytes=64MiB',
    '--demuxer-readahead-secs=20',
    '--osc=no',
    '--osd-level=0',
    '--no-border',
    '--ontop=no',
    '--fullscreen=no',
    '--input-default-bindings=no',
    '--cursor-autohide=always',
  ];
  if (platform === 'win32') args.push('--gpu-context=d3d11');

  if (options.startAt !== undefined && Number.isFinite(options.startAt) && options.startAt > 0) {
    args.push(`--start=${options.startAt}`);
  }
  args.push(options.url);
  return args;
}

export function mpvFilename(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'mpv.exe' : 'mpv';
}

export function mpvInstallDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    const root = env['LOCALAPPDATA'] ?? env['USERPROFILE'] ?? '';
    return join(root, 'TVM', 'mpv');
  }
  const home = env['HOME'] ?? '';
  return join(home, '.local', 'share', 'tvm', 'mpv');
}

function pathDirs(env: NodeJS.ProcessEnv): string[] {
  const raw = env['PATH'] ?? env['Path'] ?? '';
  return raw
    .split(delimiter)
    .map((entry) => entry.replace(/^"(.*)"$/, '$1').trim())
    .filter((entry) => entry !== '');
}

function findNamedFile(dir: string, filename: string, depth: number, exists: PathExists): string | undefined {
  if (depth < 0) return undefined;
  const direct = join(dir, filename);
  if (exists(direct)) return direct;
  if (depth === 0 || !exists(dir)) return undefined;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const found = findNamedFile(join(dir, entry.name), filename, depth - 1, exists);
      if (found !== undefined) return found;
    }
  } catch {
    // Directory vanished or is unreadable — keep searching siblings.
  }
  return undefined;
}

/** Install locations TVM will use without asking the user to set PATH. */
export function mpvCandidatePaths(
  env: NodeJS.ProcessEnv = process.env,
  resourcesPath: string | undefined = process.resourcesPath,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const filename = mpvFilename(platform);
  const home = env['USERPROFILE'] ?? env['HOME'] ?? '';
  const local = env['LOCALAPPDATA'] ?? '';
  const programData = env['ProgramData'] ?? env['PROGRAMDATA'] ?? '';
  const paths: string[] = [];

  if (resourcesPath !== undefined && resourcesPath !== '') {
    paths.push(join(resourcesPath, 'mpv', filename));
  }
  paths.push(join(mpvInstallDir(env, platform), filename));

  if (platform === 'win32') {
    paths.push(
      'C:\\Program Files\\mpv\\mpv.exe',
      'C:\\Program Files\\mpv.net\\mpv.exe',
      'C:\\Program Files\\mpv.net\\mpvnet.exe',
      'C:\\mpv\\mpv.exe',
      home !== '' ? join(home, 'scoop', 'apps', 'mpv', 'current', 'mpv.exe') : '',
      home !== '' ? join(home, 'scoop', 'shims', 'mpv.exe') : '',
      local !== '' ? join(local, 'Programs', 'mpv', 'mpv.exe') : '',
      local !== '' ? join(local, 'Programs', 'mpv.net', 'mpv.exe') : '',
      programData !== '' ? join(programData, 'chocolatey', 'bin', 'mpv.exe') : '',
    );
    if (local !== '') {
      const winget = join(local, 'Microsoft', 'WinGet', 'Packages');
      try {
        for (const entry of readdirSync(winget, { withFileTypes: true })) {
          if (!entry.isDirectory() || !/mpv/i.test(entry.name)) continue;
          paths.push(join(winget, entry.name, 'mpv.exe'));
        }
      } catch {
        // WinGet is optional.
      }
    }
  } else {
    paths.push('/usr/bin/mpv', '/usr/local/bin/mpv', '/opt/homebrew/bin/mpv');
  }

  for (const dir of pathDirs(env)) {
    paths.push(join(dir, filename));
  }

  return [...new Set(paths.filter((path) => path !== ''))];
}

/**
 * Prefer a configured, bundled, or previously installed binary. Returns
 * undefined when TVM will have to download mpv (or the user must install it).
 */
export function resolveMpvExecutable(
  env: NodeJS.ProcessEnv = process.env,
  resourcesPath: string | undefined = process.resourcesPath,
  platform: NodeJS.Platform = process.platform,
  exists: PathExists = existsSync,
): string | undefined {
  const configured = env['TVM_MPV_PATH']?.trim();
  if (configured !== undefined && configured !== '') return configured;

  const filename = mpvFilename(platform);
  for (const path of mpvCandidatePaths(env, resourcesPath, platform)) {
    if (exists(path)) return path;
  }

  const installDir = mpvInstallDir(env, platform);
  if (exists(installDir)) {
    const nested = findNamedFile(installDir, filename, 3, exists);
    if (nested !== undefined) return nested;
  }

  return undefined;
}
