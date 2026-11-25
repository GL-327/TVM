#!/usr/bin/env node
/*
 * Copies packages/content/*.json to a build's output so the app ships with
 * the changelog, events, free channels, services, avatars and age limits.
 *
 *   node scripts/copy-content.mjs <destination dir>
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'content');
const target = process.argv[2];
if (target === undefined || target.trim() === '') {
  console.error('usage: node scripts/copy-content.mjs <destination dir>');
  process.exit(1);
}
const destination = resolve(process.cwd(), target);
mkdirSync(destination, { recursive: true });
const files = readdirSync(source).filter((name) => name.endsWith('.json') && name !== 'package.json');
for (const name of files) copyFileSync(join(source, name), join(destination, name));
console.log(`Copied ${files.length} content files to ${destination}`);
