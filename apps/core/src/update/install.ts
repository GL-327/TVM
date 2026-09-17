import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What kind of copy of TVM is running, and which commit it is.
 *
 * There are two, and they update in different ways:
 *
 *   checkout  a git clone, run from source by TVM.cmd / TVM.sh. It updates by
 *             fast-forwarding to GitHub's main, which is what a person running
 *             from a clone expects and the only thing that cannot overwrite
 *             their own work.
 *   package   the desktop tarball, the appliance image, or an applied update.
 *             It carries `build-info.json` beside Core and updates by
 *             downloading the published bundle.
 */

export type InstallKind = 'checkout' | 'package';

export interface BuildInfo {
  commit: string;
  builtAt: string | null;
  version: string | null;
}

export interface InstallInfo {
  kind: InstallKind;
  /** Repository root for a checkout. */
  root: string | null;
  /** Stamped build information for a package. */
  build: BuildInfo | null;
}

export function readBuildInfo(path: string): BuildInfo | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>;
    const commit = typeof raw['commit'] === 'string' ? raw['commit'].trim() : '';
    if (!/^[0-9a-f]{7,40}$/i.test(commit)) return null;
    return {
      commit: commit.toLowerCase(),
      builtAt: typeof raw['builtAt'] === 'string' ? raw['builtAt'] : null,
      version: typeof raw['version'] === 'string' ? raw['version'] : null,
    };
  } catch {
    return null;
  }
}

/**
 * Finds out from where this module sits.
 *
 * A package puts `build-info.json` in Core's own folder, which is at most
 * two levels above this file (`core/update/install.js`). A checkout has
 * `.git` at the repository root, four levels above `apps/core/src/update`.
 */
export function detectInstall(moduleUrl: string = import.meta.url): InstallInfo {
  let here: string;
  try {
    here = dirname(fileURLToPath(moduleUrl));
  } catch {
    return { kind: 'package', root: null, build: null };
  }
  let dir = here;
  for (let depth = 0; depth < 3; depth += 1) {
    const build = readBuildInfo(join(dir, 'build-info.json'));
    if (build !== null) return { kind: 'package', root: null, build };
    dir = dirname(dir);
  }
  dir = here;
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, '.git'))) return { kind: 'checkout', root: dir, build: null };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { kind: 'package', root: null, build: null };
}

export type GitRunner = (args: readonly string[]) => Promise<string>;

/**
 * Runs git in the checkout. Never prompts: a credential prompt in a hidden
 * console would hang the update check forever.
 */
export function gitRunner(root: string, timeoutMs = 60_000): GitRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        'git',
        [...args],
        {
          cwd: root,
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', LC_ALL: 'C' },
        },
        (error, stdout, stderr) => {
          if (error !== null) {
            const detail = String(stderr ?? '').trim().split('\n').pop() ?? '';
            reject(new Error(detail !== '' ? detail : error.message));
            return;
          }
          resolve(String(stdout ?? '').trim());
        },
      );
    });
}

/** Files whose change means the installed dependencies no longer match the code. */
export const DEPENDENCY_FILES: readonly string[] = [
  'pnpm-lock.yaml',
  'package.json',
  'pnpm-workspace.yaml',
  'apps/core/package.json',
  'apps/ui/package.json',
  'apps/shell/package.json',
  'packages/design/package.json',
  'packages/nav/package.json',
];

/** Whether this process restarts itself when its files change. */
export function runningUnderWatch(execArgv: readonly string[] = process.execArgv): boolean {
  return execArgv.some((arg) => arg === '--watch' || arg.startsWith('--watch-path'));
}
