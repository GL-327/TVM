#!/usr/bin/env node
/*
 * Writes the manifest that sits next to a bundle on its release.
 *
 *   node scripts/write-update-feed.mjs --channel ios-ui --asset dist/tvm-ios-ui.tar.gz \
 *     --out dist/tvm-ios-ui.json [--bundle apps/ios/TVM/BundledUI]
 *
 * --bundle points at the stamped bundle the asset was packed from, so the
 * manifest carries the same content hash and native level as the bundle
 * itself. The desktop channel has no native half and passes no bundle.
 *
 * Read by apps/core/src/update/feed.ts, TVMUpdater.swift and TvmUpdater.kt.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { CHANNEL_PATHS, REPO, changelogEntries, currentCommit, history, sha256 } from './update-feed-lib.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index]?.replace(/^--/, ''), process.argv[index + 1]);
}
const channel = args.get('channel');
const asset = args.get('asset');
const out = args.get('out');
if (!channel || !asset || !out || !Object.hasOwn(CHANNEL_PATHS, channel)) {
  console.error('usage: node scripts/write-update-feed.mjs --channel <ios-ui|android-ui|desktop> --asset <file> --out <file> [--bundle <dir>]');
  process.exit(1);
}

const bytes = readFileSync(resolve(asset));
const bundle = args.get('bundle');
const stamp = bundle === undefined ? {} : JSON.parse(readFileSync(resolve(bundle, 'build-info.json'), 'utf8'));
const commit = currentCommit();
if (commit === '') {
  console.error('no commit: run inside the git checkout or set GITHUB_SHA');
  process.exit(1);
}
if (stamp.commit !== undefined && stamp.commit !== commit) {
  console.error(`bundle was stamped at ${stamp.commit} but this is ${commit}`);
  process.exit(1);
}

const manifest = {
  schema: 1,
  channel,
  commit,
  version: JSON.parse(readFileSync(resolve(REPO, 'package.json'), 'utf8')).version,
  builtAt: stamp.builtAt ?? new Date().toISOString(),
  asset: basename(asset),
  sha256: sha256(bytes),
  size: statSync(resolve(asset)).size,
  nativeApi: typeof stamp.nativeApi === 'number' ? stamp.nativeApi : 0,
  contentHash: typeof stamp.contentHash === 'string' ? stamp.contentHash : '',
  entries: changelogEntries(CHANNEL_PATHS[channel], 30),
  history: history(200),
};
writeFileSync(resolve(out), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${channel}: ${commit.slice(0, 7)} ${manifest.asset} ${manifest.sha256.slice(0, 12)} native ${manifest.nativeApi}, ${manifest.entries.length} entries`);
