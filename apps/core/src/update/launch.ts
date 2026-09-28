import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectInstall } from './install.ts';
import { resolveAppliedApp } from './paths.ts';

export interface AppliedHop {
  coreEntry: string;
  env: NodeJS.ProcessEnv;
}

/**
 * If an applied GitHub release sits under the data dir and this process is
 * still the installed copy, hop into that build. A checkout keeps running
 * from its tree, so applying can never clobber source.
 *
 * This used to ask for TVM_ENV=production instead of looking at what kind of
 * install it is. The Windows launcher set development, so an install there
 * downloaded an update, applied it, restarted, and started the old build
 * again — the update was real and invisible, every time.
 */
export function appliedLaunch(
  dataDir: string,
  currentModuleUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  kind: 'checkout' | 'package' = detectInstall(currentModuleUrl).kind,
): AppliedHop | null {
  if (kind === 'checkout') return null;
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
