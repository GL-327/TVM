#!/usr/bin/env node
/*
 * Build apps/ui and copy the production files into the Android asset folder.
 *
 * The Android app serves these from a loopback HTTP server rather than
 * file:// — the interface uses ES modules and fetches its own API, and a
 * file:// origin is opaque to both. Same arrangement as apps/ios/bundle-ui.mjs.
 *
 * `--copy-only` skips the build and copies whatever is already in apps/ui/dist,
 * which is what Windows uses when the UI was just built by another step.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..', '..');
const DEST = join(ROOT, 'app', 'src', 'main', 'assets', 'ui');
const DIST = join(REPO, 'apps', 'ui', 'dist');
const skipBuild = process.argv.includes('--copy-only');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!skipBuild) {
  run('corepack', ['pnpm', '--filter', '@tvm/ui', 'run', 'build']);
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('apps/ui/dist/index.html is missing. Run: corepack pnpm --filter @tvm/ui run build');
  process.exit(1);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(DIST, DEST, { recursive: true });
writeFileSync(join(DEST, '.standalone'), 'tvm-android-bundled-ui\n');
writeFileSync(
  join(DEST, 'README.txt'),
  'Production build of apps/ui, served by the on-device TVM core over loopback. Not a web clip.\n',
);

console.log(`bundled UI -> ${DEST}`);
