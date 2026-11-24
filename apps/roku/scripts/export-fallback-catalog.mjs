#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..', '..', '..');
const SOURCE = join(REPO, 'apps', 'ui', 'src', 'data', 'catalog.ts');
const DEST = join(ROOT, '..', 'source', 'data', 'fallbackCatalog.json');

const text = readFileSync(SOURCE, 'utf8');
const start = text.indexOf('export const TITLES');
if (start < 0) {
  console.error('TITLES export not found in catalog.ts');
  process.exit(1);
}
const assign = text.indexOf('= [', start);
const bracket = assign >= 0 ? assign + 2 : -1;
let depth = 0;
let end = -1;
for (let i = bracket; i < text.length; i += 1) {
  if (text[i] === '[') depth += 1;
  else if (text[i] === ']') {
    depth -= 1;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}
if (end < 0) {
  console.error('Could not parse TITLES array');
  process.exit(1);
}

const titles = Function(
  'art',
  `"use strict"; return (${text.slice(bracket, end)});`,
)((size, path) => `https://image.tmdb.org/t/p/${size}${path}`);
const imdbMap = JSON.parse(readFileSync(join(REPO, 'apps', 'ui', 'src', 'data', 'fallback-imdb.json'), 'utf8'));
const items = titles.map((title) => ({
  id: imdbMap[title.id] ?? title.id,
  title: title.title,
  year: title.year > 0 ? title.year : null,
  kind: title.kind,
  synopsis: title.synopsis ?? '',
  poster: title.poster ?? '',
  backdrop: title.backdrop ?? '',
  genres: [...(title.genres ?? [])],
  rating: title.rating ?? '',
  runtime: title.runtime ?? '',
  playable: true,
}));

mkdirSync(dirname(DEST), { recursive: true });
writeFileSync(DEST, `${JSON.stringify({ items })}\n`);
console.log(`wrote ${items.length} fallback titles -> ${DEST}`);
