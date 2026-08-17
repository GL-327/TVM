import { existsSync, rmSync, unlinkSync } from 'node:fs';
import {
  artworkCachePath,
  catalogCachePath,
  entitlementPath,
  billingPath,
  usagePath,
  livePlaylistPath,
  planPath,
  profilesPath,
  progressPath,
  rdTokenPath,
  watchlistPath,
  poolRdPath,
  devUnlockPath,
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
  remove(planPath(dataDir));
  remove(entitlementPath(dataDir));
  remove(billingPath(dataDir));
  remove(usagePath(dataDir));
  remove(poolRdPath(dataDir));
  remove(devUnlockPath(dataDir));
  removeTree(join(dataDir, 'profiles'));
}
