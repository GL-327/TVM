#!/usr/bin/env node
/*
 * The tab bar's icons, for the app's own (Liquid Glass) bar on iOS: the very
 * SVGs the shared phone look draws (tvm-android.css, --tvma-icon-*), written
 * as vector template images in the asset catalog. Run after changing them there.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(ROOT, '..', 'android', 'app', 'src', 'main', 'assets', 'android-shell', 'tvm-android.css'), 'utf8');
const NAMES = { home: 'TabHome', search: 'TabSearch', live: 'TabLive', list: 'TabList' };
let written = 0;
for (const [key, asset] of Object.entries(NAMES)) {
  for (const on of [false, true]) {
    const variable = `--tvma-icon-${key}${on ? '-on' : ''}`;
    const match = new RegExp(`${variable}: url\\("data:image/svg\\+xml,([^"]+)"\\);`).exec(CSS);
    if (!match) throw new Error(`${variable} is missing from tvm-android.css`);
    const svg = decodeURIComponent(match[1]).replace("viewBox='0 0 24 24'", "viewBox='0 0 24 24' width='24' height='24'");
    const name = asset + (on ? 'On' : '');
    const dir = join(ROOT, 'TVM', 'Assets.xcassets', `${name}.imageset`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.svg`), svg + '\n');
    writeFileSync(join(dir, 'Contents.json'), JSON.stringify({
      images: [{ filename: `${name}.svg`, idiom: 'universal' }],
      info: { author: 'xcode', version: 1 },
      properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' },
    }, null, 2) + '\n');
    written++;
  }
}
console.log(`tab icons -> ${written} image sets`);
