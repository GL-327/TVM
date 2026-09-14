#!/usr/bin/env node
/*
 * Build apps/ui and copy the production files into the iOS bundle folder.
 * CI runs this before xcodebuild. A Mac can run it locally the same way.
 * Windows can run the copy of an already-built dist, but cannot compile the IPA.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..', '..');
const DEST = join(ROOT, 'TVM', 'BundledUI');
const DIST = join(REPO, 'apps', 'ui', 'dist');
const skipBuild = process.argv.includes('--copy-only');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
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
writeFileSync(join(DEST, '.standalone'), 'tvm-ios-bundled-ui\n');
writeFileSync(
  join(DEST, 'README.txt'),
  'Production build of apps/ui, served by the on-device TVM core. Not a web clip.\n',
);

console.log(`bundled UI -> ${DEST}`);
