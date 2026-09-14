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
for (let i = 0; i < size * size; i += 1) {
  pixels[i * 4] = 0x1e;
  pixels[i * 4 + 1] = 0x10;
  pixels[i * 4 + 2] = 0x0a;
  pixels[i * 4 + 3] = 255;
}

const inset = Math.round(size * 0.18);
const scale = (size - inset * 2) / 108;
function fillRect(x, y, width, height) {
  const x0 = Math.round(inset + x * scale);
  const y0 = Math.round(inset + y * scale);
  const x1 = Math.round(inset + (x + width) * scale);
  const y1 = Math.round(inset + (y + height) * scale);
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) {
      if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
      const index = (yy * size + xx) * 4;
      pixels[index] = 0xe0;
      pixels[index + 1] = 0xa5;
      pixels[index + 2] = 0x26;
      pixels[index + 3] = 255;
    }
  }
}

// Same T mark as the Android launcher (apps/android ic_launcher_foreground).
fillRect(34, 40, 40, 8);
fillRect(50, 48, 8, 28);

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
