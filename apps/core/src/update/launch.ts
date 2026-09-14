import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAppliedApp } from './paths.ts';

export interface AppliedHop {
  coreEntry: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Production only: if an applied GitHub release sits under the data dir and
 * this process is still the image/source copy, hop into that bundle. Development
 * checkouts keep running from the tree so apply cannot clobber source.
 */
export function appliedLaunch(
  dataDir: string,
  currentModuleUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): AppliedHop | null {
  if (env['TVM_ENV'] !== 'production') return null;
  const applied = resolveAppliedApp(dataDir);
  if (applied === null) return null;
  let here = '';
  try {
    here = resolve(fileURLToPath(currentModuleUrl));
  } catch {
    here = '';
  }
  if (here !== '' && here === resolve(applied.coreEntry)) return null;
  return {
    coreEntry: applied.coreEntry,
    env: { ...env, TVM_UI_DIST: applied.uiDist },
  };
}
