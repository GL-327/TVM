// Draws the three white, transparent shapes the franchise intros tint at run time:
// a thin glowing ring, a horizontal light beam and a soft ember. Shapes only, no logos
// or film imagery. Rebuild with: node apps/roku/scripts/make-intro-art.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'images', 'intro');
const clamp = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length);
  head.write(type, 4, 'ascii');
  let crc = 0xffffffff;
  for (const b of Buffer.concat([head.subarray(4), data])) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([head, data, tail]);
}
export function encodePng(width, height, alpha) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * (width * 4 + 1) + 1 + x * 4;
      rows[o] = rows[o + 1] = rows[o + 2] = 255;
      rows[o + 3] = Math.round(clamp(alpha(x, y)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Ring: a 6 px core at 0.92 of the radius with a wide soft halo either side.
const R = 256;
const ring = encodePng(512, 512, (x, y) => {
  const d = Math.hypot(x + 0.5 - R, y + 0.5 - R) / R;
  const off = Math.abs(d - 0.9);
  return Math.max(1 - smooth(0.004, 0.014, off), 0.45 * (1 - smooth(0.0, 0.07, off))) * (1 - smooth(0.96, 1, d));
});
// Beam: bright thin core, soft falloff in height, fading out at both ends.
const beam = encodePng(1024, 64, (x, y) => {
  const dy = Math.abs(y + 0.5 - 32) / 32;
  const dx = Math.abs(x + 0.5 - 512) / 512;
  return Math.max(1 - smooth(0.02, 0.1, dy), 0.5 * (1 - smooth(0, 1, dy))) * (1 - smooth(0.35, 1, dx));
});
// Ember: a small hot core inside a round soft glow.
const ember = encodePng(64, 64, (x, y) => {
  const d = Math.hypot(x + 0.5 - 32, y + 0.5 - 32) / 32;
  return Math.max(1 - smooth(0.1, 0.32, d), 0.55 * (1 - smooth(0, 1, d)));
});
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'ring.png'), ring);
writeFileSync(join(outDir, 'beam.png'), beam);
writeFileSync(join(outDir, 'ember.png'), ember);
console.log('intro art written to', outDir);
