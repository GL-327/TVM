import { existsSync, rmSync, unlinkSync } from 'node:fs';
import {
  artworkCachePath,
  catalogCachePath,
  livePlaylistPath,
  profilesPath,
  progressPath,
  rdTokenPath,
  watchlistPath,
} from '../update/paths.ts';
import { join } from 'node:path';

function remove(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Missing is fine.
  }
}

function removeTree(path: string): void {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
}

export function clearCacheDir(dataDir: string): void {
  remove(artworkCachePath(dataDir));
  remove(catalogCachePath(dataDir));
  removeTree(join(dataDir, 'cache'));
}

export function factoryResetDir(dataDir: string): void {
  clearCacheDir(dataDir);
  remove(rdTokenPath(dataDir));
  remove(profilesPath(dataDir));
  remove(progressPath(dataDir));
  remove(watchlistPath(dataDir));
  remove(livePlaylistPath(dataDir));
  removeTree(join(dataDir, 'profiles'));
}
