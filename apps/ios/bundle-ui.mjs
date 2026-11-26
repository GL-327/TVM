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

// The phone look shared with Android (one source: the Android app's overlay)
// and the iPhone's own layer. TVMShell.swift injects them from the app bundle,
// so a newer interface from the update feed keeps them.
const SHELL = join(DEST, 'shell');
mkdirSync(SHELL, { recursive: true });
const ANDROID_SHELL = join(REPO, 'apps', 'android', 'app', 'src', 'main', 'assets', 'android-shell');
for (const [from, name] of [
  [join(ANDROID_SHELL, 'tvm-android.js'), 'tvm-android.js'],
  [join(ANDROID_SHELL, 'tvm-android.css'), 'tvm-android.css'],
  [join(ROOT, 'shell', 'tvm-ios.js'), 'tvm-ios.js'],
  [join(ROOT, 'shell', 'tvm-ios.css'), 'tvm-ios.css'],
]) {
  if (!existsSync(from)) { console.error(`missing ${from}`); process.exit(1); }
  cpSync(from, join(SHELL, name));
}
writeFileSync(
  join(DEST, 'README.txt'),
  'Production build of apps/ui, served by the on-device TVM core. Not a web clip.\n',
);

// Keep bundled shared content JSONs synchronized with packages/content/.
const CONTENT_SRC = join(REPO, 'packages', 'content');
for (const name of ['avatars.json', 'changelog.json', 'events.json', 'free-channels.json', 'intros.json', 'parental.json', 'services.json']) {
  const from = join(CONTENT_SRC, name);
  if (existsSync(from)) {
    cpSync(from, join(ROOT, 'TVM', name));
  }
}

console.log(`bundled UI -> ${DEST}`);
