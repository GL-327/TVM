#!/usr/bin/env node
/*
 * Release notes from packages/content/changelog.json, for update manifests
 * and the TVM Downloads page.
 *
 *   node scripts/release-notes.mjs --markdown [version]   the "What's new" section for a release page
 *   node scripts/release-notes.mjs --roku <out.json>      the manifest the Roku channel checks for updates
 *
 * Imported by write-update-feed.mjs for the `notes` field of every channel.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function readChangelog() {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, 'packages/content/changelog.json'), 'utf8'));
}

export function packageVersion() {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')).version;
}

/** The release for `version` (default: package.json), or null. */
export function releaseNotes(version = packageVersion(), platform = null) {
  const release = (readChangelog().releases ?? []).find((entry) => entry.version === version);
  if (release === undefined) return null;
  const changes = (release.changes ?? []).filter(
    (change) => platform === null || !Array.isArray(change.platforms) || change.platforms.includes(platform),
  );
  return { version: release.version, date: release.date, title: release.title, highlights: release.highlights ?? [], changes };
}

export function markdownNotes(version = packageVersion()) {
  const notes = releaseNotes(version);
  if (notes === null) return '';
  const lines = [`## What's new in ${notes.version}: ${notes.title}`, ''];
  for (const change of notes.changes) lines.push(`- **${change.area}:** ${change.text}`);
  return `${lines.join('\n')}\n`;
}

function rokuManifest(repo) {
  const version = packageVersion();
  const notes = releaseNotes(version, 'roku');
  return {
    schema: 1,
    channel: 'roku',
    version,
    commit: process.env.GITHUB_SHA ?? '',
    builtAt: new Date().toISOString(),
    asset: 'TVM-roku.zip',
    url: `https://github.com/${repo}/releases/download/devices/TVM-roku.zip`,
    page: `https://github.com/${repo}/releases/tag/devices`,
    notes: notes === null ? null : { title: notes.title, highlights: notes.highlights.slice(0, 4) },
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, arg] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY ?? 'GL-327/TVM';
  if (mode === '--markdown') {
    process.stdout.write(markdownNotes(arg ?? packageVersion()));
  } else if (mode === '--roku' && arg !== undefined) {
    const manifest = rokuManifest(repo);
    writeFileSync(resolve(arg), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`roku.json: ${manifest.version}, ${manifest.notes?.highlights.length ?? 0} highlights`);
  } else {
    console.error('usage: node scripts/release-notes.mjs --markdown [version] | --roku <out.json>');
    process.exit(1);
  }
}
