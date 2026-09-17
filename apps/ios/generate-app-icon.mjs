#!/usr/bin/env node
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, '..', 'brand', 'tvm-icon.png');
const DEST_DIR = join(ROOT, 'TVM', 'Assets.xcassets', 'AppIcon.appiconset');

mkdirSync(DEST_DIR, { recursive: true });
copyFileSync(SRC, join(DEST_DIR, 'AppIcon.png'));
console.log(`wrote ${join(DEST_DIR, 'AppIcon.png')}`);
