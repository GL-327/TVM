// Zero-dependency generator for the TVM Hub glyphs (node:zlib only).
//
//   node apps/roku/scripts/make-hub-glyphs.mjs
//
// White, anti-aliased, 128x128 line glyphs written to images/hub/. They are
// tinted at runtime through Poster.blendColor, so one texture serves every
// state. Platform -> glyph: roku/android-tv = tv, windows = laptop,
// web = web, android/ios = phone. Also user (account orb), dots (More
// devices), plus (Add device) and chevron (list rows).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "images", "hub");
const N = 128;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, tail]);
}

function encodePng(width, height, rgba) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const start = y * (width * 4 + 1);
    rows[start] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, start + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Signed distances (negative inside).
const sdBox = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
const sdSeg = (x, y, ax, ay, bx, by) => {
  const px = x - ax;
  const py = y - ay;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t);
};
const ring = (d, w) => Math.abs(d) - w / 2;
const line = (x, y, ax, ay, bx, by, w) => sdSeg(x, y, ax, ay, bx, by) - w / 2;

const glyphs = {
  tv: (x, y) => Math.min(ring(sdBox(x, y, 64, 54, 50, 34, 7), 7), line(x, y, 40, 104, 88, 104, 7), line(x, y, 64, 88, 64, 104, 7)),
  laptop: (x, y) => Math.min(ring(sdBox(x, y, 64, 52, 38, 30, 5), 7), line(x, y, 14, 98, 114, 98, 8)),
  phone: (x, y) => Math.min(ring(sdBox(x, y, 64, 64, 28, 50, 9), 7), line(x, y, 54, 102, 74, 102, 6)),
  web: (x, y) =>
    Math.min(
      ring(sdCircle(x, y, 64, 64, 46), 7),
      line(x, y, 18, 64, 110, 64, 6),
      ring(sdBox(x, y, 64, 64, 20, 46, 20), 6),
    ),
  user: (x, y) => Math.min(sdCircle(x, y, 64, 42, 22), sdBox(x, y, 64, 112, 42, 34, 30)),
  dots: (x, y) => Math.min(sdCircle(x, y, 24, 64, 11), sdCircle(x, y, 64, 64, 11), sdCircle(x, y, 104, 64, 11)),
  plus: (x, y) => Math.min(line(x, y, 64, 26, 64, 102, 9), line(x, y, 26, 64, 102, 64, 9)),
  chevron: (x, y) => Math.min(line(x, y, 46, 24, 84, 64, 9), line(x, y, 84, 64, 46, 104, 9)),
};

mkdirSync(outDir, { recursive: true });
for (const [name, sd] of Object.entries(glyphs)) {
  const px = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const d = sd(x + 0.5, y + 0.5);
      const a = Math.max(0, Math.min(1, 0.5 - d));
      const o = (y * N + x) * 4;
      px[o] = 255;
      px[o + 1] = 255;
      px[o + 2] = 255;
      px[o + 3] = Math.round(a * 255);
    }
  }
  writeFileSync(join(outDir, `${name}.png`), encodePng(N, N, px));
}
console.log(`Wrote ${Object.keys(glyphs).length} glyphs to ${outDir}`);
