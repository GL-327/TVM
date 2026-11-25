#!/usr/bin/env node
/*
 * Checks packages/content/changelog.json against CHANGELOG-RULES.md:
 * the shape every app reads, the newest release matching package.json,
 * versions newest first, and copy that reads like a person wrote it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (message) => errors.push(message);

const PLATFORMS = new Set(['windows', 'web', 'desktop', 'ios', 'android', 'roku']);
const BANNED = [
  'seamless', 'seamlessly', 'effortless', 'effortlessly', 'robust', 'enhanced', 'elevate', 'elevated', 'delightful',
  'unleash', 'supercharge', 'supercharged', 'game-changing', 'game changer', 'streamlined', 'leverage', 'comprehensive',
  'cutting-edge', "we're excited", 'we are excited', "we've", 'various improvements', 'bug fixes and improvements',
];
const EMOJI = /\p{Extended_Pictographic}/u;
const LINE_MAX = 110;

function copyProblems(text, where) {
  if (typeof text !== 'string' || text.trim() === '') return fail(`${where}: empty`);
  if (text.length > LINE_MAX) fail(`${where}: ${text.length} characters (max ${LINE_MAX})`);
  if (text.includes('!')) fail(`${where}: no exclamation marks`);
  if (EMOJI.test(text)) fail(`${where}: no emoji`);
  const lower = text.toLowerCase();
  for (const word of BANNED) {
    const pattern = new RegExp(`(^|[^a-z])${word.replace(/[-]/g, '\\-')}([^a-z]|$)`);
    if (pattern.test(lower)) fail(`${where}: "${word}" reads like filler, say what changed`);
  }
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
  return match === null ? null : match.slice(1).map(Number);
}

function compare(a, b) {
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'));
let changelog;
try {
  changelog = JSON.parse(readFileSync(resolve(repo, 'packages/content/changelog.json'), 'utf8'));
} catch (error) {
  console.error(`changelog.json does not parse: ${error.message}`);
  process.exit(1);
}

if (changelog.schema !== 1) fail('schema must be 1');
const releases = Array.isArray(changelog.releases) ? changelog.releases : [];
if (releases.length === 0) fail('releases must not be empty');

let previous = null;
const seen = new Set();
releases.forEach((release, index) => {
  const where = `releases[${index}] (${release?.version ?? '?'})`;
  const version = parseVersion(release?.version);
  if (version === null) return fail(`${where}: version must be x.y.z`);
  if (seen.has(release.version)) fail(`${where}: duplicate version`);
  seen.add(release.version);
  if (previous !== null && compare(version, previous) >= 0) fail(`${where}: releases must be newest first`);
  previous = version;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(release.date))) fail(`${where}: date must be YYYY-MM-DD`);
  copyProblems(release.title, `${where} title`);
  if (typeof release.title === 'string' && release.title.length > 60) fail(`${where} title: keep it under 60 characters`);
  const highlights = Array.isArray(release.highlights) ? release.highlights : [];
  if (highlights.length === 0 || highlights.length > 4) fail(`${where}: 1 to 4 highlights`);
  highlights.forEach((line, at) => copyProblems(line, `${where} highlights[${at}]`));
  const changes = Array.isArray(release.changes) ? release.changes : [];
  if (changes.length === 0) fail(`${where}: changes must not be empty`);
  changes.forEach((change, at) => {
    const spot = `${where} changes[${at}]`;
    if (typeof change?.area !== 'string' || change.area.trim() === '' || change.area.length > 20) fail(`${spot}: area is a short name`);
    copyProblems(change?.text, spot);
    if (change?.platforms !== undefined) {
      if (!Array.isArray(change.platforms) || change.platforms.length === 0) fail(`${spot}: platforms must be a non-empty list`);
      else for (const platform of change.platforms) if (!PLATFORMS.has(platform)) fail(`${spot}: unknown platform "${platform}"`);
    }
  });
});

if (releases[0]?.version !== pkg.version) {
  fail(`package.json is ${pkg.version} but the newest changelog release is ${releases[0]?.version}: add the release notes`);
}

if (errors.length > 0) {
  console.error(`Changelog check failed (see CHANGELOG-RULES.md):\n - ${errors.join('\n - ')}`);
  process.exit(1);
}
console.log(`Changelog ok: ${releases.length} releases, newest ${releases[0].version}.`);
