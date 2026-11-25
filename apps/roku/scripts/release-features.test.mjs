import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { contentNames } from './sync-content.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(path, 'utf8');

// BrightScript validates direct calls, but observer callback names are strings.
// Check each component's actual XML script scope to catch missing runtime hooks.
test('component observers and field callbacks resolve in their XML script scope', () => {
  for (const name of readdirSync(join(root, 'components')).filter((name) => name.endsWith('.xml'))) {
    const path = join(root, 'components', name);
    const xml = read(path);
    const scripts = [...xml.matchAll(/<script\b[^>]*uri="([^"]+)"/g)].map(([, uri]) =>
      read(uri.startsWith('pkg:/') ? join(root, uri.slice(5)) : join(dirname(path), uri)));
    const source = scripts.join('\n');
    const functions = new Set([...source.matchAll(/^\s*(?:sub|function)\s+(\w+)\(/gim)].map((match) => match[1].toLowerCase()));
    const callbacks = [
      ...[...xml.matchAll(/onChange="([^"]+)"/g)].map((match) => match[1]),
      ...[...source.matchAll(/\.observeField\("[^"]+",\s*"([^"]+)"\)/gi)].map((match) => match[1]),
    ];
    for (const callback of callbacks) assert.ok(functions.has(callback.toLowerCase()), `${name}: missing ${callback}`);
  }
});

test('all six bundled content files match shared data and use LF', () => {
  for (const name of contentNames) {
    const bundled = read(join(root, 'source/data/content', `${name}.json`));
    const shared = read(fileURLToPath(new URL(`../../../packages/content/${name}.json`, import.meta.url)));
    assert.deepEqual(JSON.parse(bundled), JSON.parse(shared), name);
    assert.equal(JSON.parse(bundled).schema, 1, name);
    assert.ok(!bundled.includes('\r'), `${name} line endings`);
  }
});

// Run the regex patterns read from production BrightScript against a small
// multiline review. In BrightScript, a backslash is literal, unlike JavaScript.
test('production review patterns match multiline HTML and collapse whitespace', () => {
  const source = read(join(root, 'source/reviewsCore.brs'));
  function pattern(variable) {
    const line = source.split('\n').find((line) => line.trim().startsWith(`${variable} = CreateObject`));
    const expression = line.match(/CreateObject\("roRegex", (.*), "i"\)\.Match/)[1];
    return new RegExp([...expression.matchAll(/"([^"]*)"|Chr\(34\)/g)].map((match) => match[1] ?? '"').join(''), 'i');
  }
  const html = '<strong class="name">A viewer</strong>\n<span class="rating rated-9"></span>\n<div class="body-text">\n<p>A thoughtful\n film.</p>\n</div>';
  assert.equal(pattern('author').exec(html)[1], 'A viewer');
  assert.equal(Number(pattern('stars').exec(html)[1]) / 2, 4.5);
  assert.match(pattern('body').exec(html)[1], /A thoughtful\n film/);
  const whitespace = source.match(/return CreateObject\("roRegex", "([^"]+)", ""\)/)[1];
  assert.equal('A thoughtful\n   film.'.replace(new RegExp(whitespace, 'g'), ' '), 'A thoughtful film.');
});
