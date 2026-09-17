/*
 * Shared pieces of the update feed, used by stamp-ui-bundle.mjs,
 * write-update-feed.mjs and apps/ios/write-changelog.mjs.
 *
 * The manifest format is read by apps/core/src/update/feed.ts, by
 * TVMUpdater.swift and by TvmUpdater.kt. Change one, change all four.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The native API each phone build provides, and each interface bundle needs. */
export function nativeApi(platform) {
  const levels = JSON.parse(readFileSync(join(REPO, 'scripts', 'native-api.json'), 'utf8'));
  const level = levels[platform];
  if (!Number.isInteger(level) || level < 1) throw new Error(`scripts/native-api.json has no level for "${platform}"`);
  return level;
}

/** Files that describe a bundle rather than make it up. */
export const STAMP_FILES = new Set(['build-info.json', 'changelog.json', 'CHANGELOG.md']);

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** GITHUB_SHA on a runner, otherwise the checkout's HEAD. */
export function currentCommit() {
  const fromEnv = (process.env.GITHUB_SHA ?? '').trim();
  const commit = fromEnv !== '' ? fromEnv : git('rev-parse', 'HEAD');
  return /^[0-9a-f]{40}$/i.test(commit) ? commit.toLowerCase() : '';
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/**
 * A hash of what the bundle contains, ignoring the stamp files.
 *
 * The feed is rebuilt for every push, and most pushes do not change the
 * interface at all. Two bundles with the same content hash are the same
 * bundle, so a phone can skip the download no matter which commit built it.
 */
export function contentHash(dir) {
  const rows = walk(dir)
    .map((path) => relative(dir, path).split('\\').join('/'))
    .filter((name) => !STAMP_FILES.has(name))
    .sort()
    .map((name) => `${name}\0${sha256(readFileSync(join(dir, name)))}`);
  return sha256(Buffer.from(rows.join('\n'), 'utf8'));
}

const FIELD = '\u001f';
const RECORD = '\u001e';

function parseMessage(raw) {
  const text = raw.replace(/\r\n/g, '\n').trim();
  const nl = text.indexOf('\n');
  const title = (nl === -1 ? text : text.slice(0, nl)).trim().slice(0, 160);
  const body = (nl === -1 ? '' : text.slice(nl).trim()).slice(0, 600);
  return { title, body };
}

/**
 * Commits that changed `paths`, newest first, as changelog entries.
 * Merge commits are left out: their title says nothing to a viewer.
 */
export function changelogEntries(paths, limit = 30) {
  const out = git('log', '--no-merges', `-n${limit}`, `--format=%H${FIELD}%cI${FIELD}%B${RECORD}`, 'HEAD', '--', ...paths);
  const entries = [];
  for (const record of out.split(RECORD)) {
    const trimmed = record.replace(/^\s+/, '');
    if (trimmed === '') continue;
    const [sha = '', date = '', ...message] = trimmed.split(FIELD);
    const { title, body } = parseMessage(message.join(FIELD));
    if (title === '' || /^merge (pull request|branch)\b/i.test(title)) continue;
    entries.push({ sha: sha.slice(0, 7), title, body, date: date === '' ? null : date });
  }
  return entries;
}

/**
 * Every recent commit, newest first, short form.
 *
 * Lets a phone tell which of the entries above are newer than the build it is
 * running, even when its own commit changed nothing it would display.
 */
export function history(limit = 200) {
  return git('log', '--first-parent', `-n${limit}`, '--format=%h', '--abbrev=7', 'HEAD')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[0-9a-f]{7,}$/.test(line))
    .map((line) => line.slice(0, 7));
}

/** Paths whose commits count as a change to each channel. */
export const CHANNEL_PATHS = {
  'ios-ui': ['apps/ui', 'packages'],
  'android-ui': ['apps/ui', 'packages'],
  desktop: ['apps/core', 'apps/ui', 'packages'],
};
