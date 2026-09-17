#!/usr/bin/env node
/*
 * Stamps a built interface bundle with what it is.
 *
 *   build-info.json   commit, build time, content hash, native API level
 *   changelog.json    recent interface changes, newest first
 *   CHANGELOG.md      the same, for the release page
 *
 * The phones read build-info.json to decide whether a published bundle is
 * newer than the one they are running, and whether their native code is new
 * enough for it. The same stamp goes into the bundle inside the app and into
 * the bundle on the update feed, so the two compare like for like.
 *
 * Usage: node scripts/stamp-ui-bundle.mjs <bundle dir> <ios|android>
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHANNEL_PATHS, changelogEntries, contentHash, currentCommit, nativeApi } from './update-feed-lib.mjs';

const PLAYERS = { ios: 'MobileVLCKit-3.6.0', android: 'Media3-1.4.1' };

export function stampBundle(dir, platform) {
  if (!Object.hasOwn(PLAYERS, platform)) throw new Error(`unknown platform "${platform}" — expected ios or android`);
  if (!existsSync(resolve(dir, 'index.html'))) throw new Error(`${dir} has no index.html; build the interface first`);
  const commit = currentCommit();
  const entries = changelogEntries(CHANNEL_PATHS[`${platform}-ui`], 12);
  const info = {
    commit,
    builtAt: new Date().toISOString(),
    run: process.env.GITHUB_RUN_ID ?? null,
    platform,
    nativeApi: nativeApi(platform),
    contentHash: contentHash(dir),
    player: PLAYERS[platform],
  };
  writeFileSync(resolve(dir, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
  writeFileSync(resolve(dir, 'changelog.json'), `${JSON.stringify({ commit, generatedAt: info.builtAt, entries }, null, 2)}\n`);
  const title = platform === 'ios' ? 'iOS interface (rolling)' : 'Android interface (rolling)';
  writeFileSync(
    resolve(dir, 'CHANGELOG.md'),
    [title, '', entries.length === 0 ? 'Latest interface from GitHub main.' : entries.map((entry) => `- ${entry.title}`).join('\n'), ''].join('\n'),
  );
  return info;
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  const [dir, platform] = process.argv.slice(2);
  if (dir === undefined || platform === undefined) {
    console.error('usage: node scripts/stamp-ui-bundle.mjs <bundle dir> <ios|android>');
    process.exit(1);
  }
  const info = stampBundle(resolve(dir), platform);
  console.log(`stamped ${dir}: ${info.commit.slice(0, 7) || 'no commit'} native ${info.nativeApi} content ${info.contentHash.slice(0, 12)}`);
  // Keep the file readable in CI logs.
  console.log(readFileSync(resolve(dir, 'CHANGELOG.md'), 'utf8'));
}
