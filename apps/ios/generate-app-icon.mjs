#!/usr/bin/env node
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEST_DIR = join(ROOT, 'TVM', 'Assets.xcassets', 'AppIcon.appiconset');

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const tag = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[(width * 4 + 1) * y] = 0;
    rgba.copy(raw, (width * 4 + 1) * y + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const size = 1024;
const pixels = Buffer.alloc(size * size * 4);
// A cinematic screen and luminous play aperture. Opaque, full-bleed artwork;
// iOS supplies the launcher corner mask. Render at 2x coverage for crisp edges.
const clamp = (x) => Math.max(0, Math.min(1, x));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function roundBox(x, y, w, h, r) {
  const dx = Math.abs(x) - w / 2 + r;
  const dy = Math.abs(y) - h / 2 + r;
  return Math.hypot(Math.max(0, dx), Math.max(0, dy)) + Math.min(Math.max(dx, dy), 0) - r;
}
function color(x, y) {
  const halo = Math.exp(-((x - 520) ** 2 + (y - 480) ** 2) / 230000);
  let c = mix([7, 10, 18], [48, 32, 28], halo * 0.75);
  const edge = roundBox(x - 512, y - 490, 720, 548, 150);
  const glow = Math.exp(-Math.abs(edge) / 24) * 0.3;
  c = mix(c, [230, 92, 39], glow);
  if (edge < 0) c = mix([17, 19, 29], [35, 29, 29], clamp(1 - y / 1024));
  if (edge < 0 && edge > -20) c = mix([255, 205, 110], [243, 82, 55], clamp((x + y - 350) / 1300));
  // Forward aperture, inset well clear of the iOS corner mask.
  const triangle = x >= 405 && x <= 706 && Math.abs(y - 490) <= (706 - x) * 0.61;
  if (triangle) c = mix([255, 237, 184], [255, 130, 63], clamp((x + y - 680) / 610));
  // Three illuminated ticks echo a film-strip without small launcher text.
  for (let i = 0; i < 3; i++) {
    if (roundBox(x - (462 + i * 50), y - 820, 28, 10, 5) < 0) c = mix([251, 175, 91], [246, 94, 53], i / 2);
  }
  return c;
}
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const samples = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].map(([dx, dy]) => color(x + dx, y + dy));
    const offset = (y * size + x) * 4;
    for (let ch = 0; ch < 3; ch++) pixels[offset + ch] = Math.round(samples.reduce((sum, c) => sum + c[ch], 0) / 4);
    pixels[offset + 3] = 255;
  }
}

mkdirSync(DEST_DIR, { recursive: true });
writeFileSync(join(DEST_DIR, 'AppIcon.png'), encodePng(size, size, pixels));
writeFileSync(
  join(DEST_DIR, 'Contents.json'),
  `${JSON.stringify(
    {
      images: [{ filename: 'AppIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
      info: { author: 'xcode', version: 1 },
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${join(DEST_DIR, 'AppIcon.png')}`);
