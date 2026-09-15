#!/usr/bin/env node
/*
 * Writes BundledUI/changelog.json (and a markdown notes file) from recent git
 * history so iPhone hot-updates can show "what's new" even if GitHub's commit
 * API is rate-limited at apply time.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..', '..');
const DEST = join(ROOT, 'TVM', 'BundledUI');

function gitLog() {
  const result = spawnSync(
    'git',
    ['log', '-15', `--pretty=format:%H%x09%cI%x09%s`],
    { cwd: REPO, encoding: 'utf8' },
  );
  if (result.status !== 0) return [];
  return (result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [sha = '', date = '', ...rest] = line.split('\t');
      return { sha, date, title: rest.join('\t').trim() };
    })
    .filter((row) => row.title !== '' && !/^(merge (pull request|branch)\b)/i.test(row.title))
    .slice(0, 12)
    .map((row) => ({
      sha: row.sha.slice(0, 7),
      title: row.title.slice(0, 160),
      body: '',
      date: row.date || null,
    }));
}

const commit = (process.env.GITHUB_SHA ?? '').trim();
const entries = gitLog();
const payload = {
  commit,
  generatedAt: new Date().toISOString(),
  entries,
};

if (!existsSync(DEST)) mkdirSync(DEST, { recursive: true });
writeFileSync(join(DEST, 'changelog.json'), `${JSON.stringify(payload, null, 2)}\n`);

const md = [
  'iOS UI (rolling)',
  '',
  entries.length === 0 ? 'Latest interface from GitHub main.' : entries.map((entry) => `- ${entry.title}`).join('\n'),
  '',
].join('\n');
writeFileSync(join(DEST, 'CHANGELOG.md'), md);
