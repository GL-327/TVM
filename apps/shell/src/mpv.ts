import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface MpvLaunchOptions {
  url: string;
  windowId: string;
  ipcPath: string;
  startAt?: number;
}

export function buildMpvArgs(options: MpvLaunchOptions): string[] {
  const args = [
    `--wid=${options.windowId}`,
    `--input-ipc-server=${options.ipcPath}`,
    '--no-terminal',
    '--really-quiet',
    '--force-window=yes',
    '--keep-open=no',
    '--hwdec=auto-safe',
    '--vo=gpu-next',
    '--osc=no',
    '--osd-level=0',
    '--fullscreen',
  ];

  if (options.startAt !== undefined && Number.isFinite(options.startAt) && options.startAt > 0) {
    args.push(`--start=${options.startAt}`);
  }
  args.push(options.url);
  return args;
}

/**
 * Prefer a configured or bundled binary. Falling back to `mpv(.exe)` lets a
 * developer use their PATH without putting a large binary in git.
 */
export function resolveMpvExecutable(
  env: NodeJS.ProcessEnv = process.env,
  resourcesPath: string | undefined = process.resourcesPath,
  platform: NodeJS.Platform = process.platform,
): string {
  const configured = env['TVM_MPV_PATH']?.trim();
  if (configured !== undefined && configured !== '') return configured;

  const filename = platform === 'win32' ? 'mpv.exe' : 'mpv';
  if (resourcesPath !== undefined) {
    const bundled = join(resourcesPath, 'mpv', filename);
    if (existsSync(bundled)) return bundled;
  }

  if (platform === 'win32') {
    const home = env['USERPROFILE'] ?? '';
    const local = env['LOCALAPPDATA'] ?? '';
    const guessed = [
      'C:\\Program Files\\mpv\\mpv.exe',
      'C:\\Program Files\\mpv.net\\mpv.exe',
      'C:\\mpv\\mpv.exe',
      home !== '' ? join(home, 'scoop', 'apps', 'mpv', 'current', 'mpv.exe') : '',
      local !== '' ? join(local, 'Programs', 'mpv', 'mpv.exe') : '',
    ];
    for (const path of guessed) {
      if (path !== '' && existsSync(path)) return path;
    }
  }

  return filename;
}
