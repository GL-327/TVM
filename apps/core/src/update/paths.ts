import { join, resolve } from 'node:path';

export const UPDATE_REPO = 'GL-327/TVM';
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const raw = env['TVM_DATA_DIR'];
  if (raw !== undefined && raw.trim() !== '') return resolve(raw);

  if (platform === 'win32') {
    const root = env['LOCALAPPDATA'] ?? env['APPDATA'] ?? resolve('.');
    return join(root, 'TVM');
  }

  if (platform === 'darwin') {
    const home = env['HOME'] ?? resolve('.');
    return join(home, 'Library', 'Application Support', 'TVM');
  }

  const xdg = env['XDG_DATA_HOME'];
  if (xdg !== undefined && xdg.trim() !== '') return join(xdg, 'tvm');
  const home = env['HOME'];
  if (home !== undefined && home.trim() !== '') return join(home, '.local', 'share', 'tvm');
  return join(resolve('.'), 'tvm-data');
}

export function applyPolicy(env: NodeJS.ProcessEnv = process.env): { allowed: boolean; reason: string | null } {
  if (env['TVM_ENV'] === 'production') return { allowed: true, reason: null };
  if (env['TVM_ALLOW_APPLY'] === '1') return { allowed: true, reason: null };
  return {
    allowed: false,
    reason: 'Apply is disabled in this checkout so a download cannot overwrite the source tree. Publish a release and apply it on an appliance, or set TVM_ENV=production.',
  };
}

export function appDir(dataDir: string, version: string): string {
  return join(dataDir, 'app', version);
}

export function currentPointer(dataDir: string): string {
  return join(dataDir, 'app', 'current');
}

export function secretsDir(dataDir: string): string {
  return join(dataDir, 'secrets');
}

export function tokenPath(dataDir: string): string {
  return join(secretsDir(dataDir), 'github-token');
}

export function rdTokenPath(dataDir: string): string {
  return join(secretsDir(dataDir), 'rd-token');
}

export function profilesPath(dataDir: string): string {
  return join(dataDir, 'profiles.json');
}

export function profileDir(dataDir: string, profileId: string): string {
  return join(dataDir, 'profiles', profileId);
}

export function progressPath(dataDir: string): string {
  return join(dataDir, 'progress.json');
}

export function watchlistPath(dataDir: string): string {
  return join(dataDir, 'watchlist.json');
}

export function livePlaylistPath(dataDir: string): string {
  return join(dataDir, 'live-playlist.json');
}

export function tmdbKeyPath(dataDir: string): string {
  return join(secretsDir(dataDir), 'tmdb-key');
}

export function planPath(dataDir: string): string {
  return join(dataDir, 'plan.json');
}

export function cacheDir(dataDir: string): string {
  return join(dataDir, 'cache');
}

export function artworkCachePath(dataDir: string): string {
  return join(cacheDir(dataDir), 'artwork.json');
}

export function catalogCachePath(dataDir: string): string {
  return join(cacheDir(dataDir), 'catalog.json');
}

export function statusPath(dataDir: string): string {
  return join(dataDir, 'update-status.json');
}
