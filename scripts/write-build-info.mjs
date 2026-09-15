#!/usr/bin/env node
/*
 * Stamps the commit a phone build came from into a bundled asset.
 *
 * A sideloaded app cannot update itself — Apple does not allow it, and an APK
 * installed by hand has no store behind it. What it *can* do is tell you that a
 * newer build exists, which is the half of "auto update" that is actually
 * achievable. That needs the app to know which commit it is, and neither
 * CFBundleVersion nor versionName carries that: both are hand-set and stale.
 *
 * Releases are tagged `mobile-<short sha>`, so the app compares this sha with
 * the newest release tag on GitHub. Without this file the app reports "unknown"
 * and says so rather than claiming to be up to date.
 *
 * Usage: node scripts/write-build-info.mjs ios|android|both
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = (process.argv[2] ?? 'both').toLowerCase();

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

// GitHub Actions leaves the checkout at a detached head; GITHUB_SHA is the
// authoritative commit there and `git rev-parse` agrees, but the env var
// survives even when the runner uses a shallow clone with no history.
const sha = (process.env.GITHUB_SHA ?? git('rev-parse', 'HEAD')).slice(0, 7);
const info = {
  commit: sha === '' ? 'unknown' : sha,
  builtAt: new Date().toISOString(),
  // Tag scheme of the mobile releases, so the app can compare like for like.
  releaseTagPrefix: 'mobile-',
};

const DESTS = {
  ios: join(ROOT, 'apps', 'ios', 'TVM', 'BuildInfo.json'),
  android: join(ROOT, 'apps', 'android', 'app', 'src', 'main', 'assets', 'BuildInfo.json'),
};

const chosen = target === 'both' ? Object.keys(DESTS) : [target];
for (const key of chosen) {
  const dest = DESTS[key];
  if (dest === undefined) {
    console.error(`unknown target "${key}" — expected ios, android or both`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(info, null, 2)}\n`);
  console.log(`build info (${info.commit}) -> ${dest}`);
}
