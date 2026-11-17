// Deterministic 3840-canvas materials, 2x 1080p with 4x4 supersampling.
// SDF edges, premultiplied integration and one upper-left light source.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'images', 'glass');
const SUPERSAMPLE = 4;
const clamp = v => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const white = a => [255, 255, 255, a];
const black = a => [0, 0, 0, a];
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
export function encodePng(width, height, rgba) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const pixels = Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4);
    pixels.copy(rows, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function canvas(width, height) { return { width, height, data: Buffer.alloc(width * height * 4) }; }
function over(layers) {
  let r = 0, g = 0, b = 0, a = 0;
  for (const [lr, lg, lb, alpha] of layers) {
    const la = clamp(alpha);
    r = lr * la + r * (1 - la);
    g = lg * la + g * (1 - la);
    b = lb * la + b * (1 - la);
    a = la + a * (1 - la);
  }
  return [r, g, b, a];
}
function raster(w, h, sample) {
  const img = canvas(w, h);
  const count = SUPERSAMPLE ** 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const p = sample(x + (sx + 0.5) / SUPERSAMPLE, y + (sy + 0.5) / SUPERSAMPLE);
          for (let c = 0; c < 4; c++) sum[c] += p[c];
        }
      }
      const i = (y * w + x) * 4;
      if (sum[3] > 0) {
        for (let c = 0; c < 3; c++) img.data[i + c] = Math.round(sum[c] / sum[3]);
      }
      img.data[i + 3] = Math.round(sum[3] / count * 255);
    }
  }
  return img;
}
function roundedRect(x, y, w, h, radius) {
  const qx = Math.abs(x - w / 2) - (w / 2 - radius);
  const qy = Math.abs(y - h / 2) - (h / 2 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}
// Android/Roku black stretch/content guides with transparent corner pixels.
function nine(art, insetX, insetY) {
  const img = canvas(art.width + 2, art.height + 2);
  for (let y = 0; y < art.height; y++) {
    art.data.copy(img.data, ((y + 1) * img.width + 1) * 4, y * art.width * 4, (y + 1) * art.width * 4);
  }
  const mark = (x, y) => img.data.set([0, 0, 0, 255], (y * img.width + x) * 4);
  for (let x = insetX; x < art.width - insetX; x++) {
    mark(x + 1, 0);
    mark(x + 1, img.height - 1);
  }
  for (let y = insetY; y < art.height - insetY; y++) {
    mark(0, y + 1);
    mark(img.width - 1, y + 1);
  }
  return img;
}
const files = {};
for (const [shape, w, h, radius] of [
  ['panel', 256, 256, 80],
  ['pill', 288, 144, 72],
  ['tab', 224, 112, 56],
  ['chip', 120, 60, 30],
  ['card', 128, 128, 36],
]) {
  const shapeImage = (sample, margin = 0) => {
    const art = raster(w + margin * 2, h + margin * 2, (px, py) => {
      const x = px - margin;
      const y = py - margin;
      return over(sample(x, y, roundedRect(x, y, w, h, radius)));
    });
    const insetY = Math.min(radius + margin - 2, Math.floor(h / 2 + margin) - 2);
    return nine(art, radius + margin + 2, insetY);
  };
  files[`${shape}-fill.9.png`] = shapeImage((x, y, d) => [white(d <= 0 ? 1 : 0)]);
  files[`${shape}-body.9.png`] = shapeImage((x, y, d) => [white(d <= 0 ? 0.16 * (1 - clamp(y / h)) + 0.03 * clamp(y / h) : 0)]);
  files[`${shape}-gloss.9.png`] = shapeImage((x, y, d) => {
    const u = (x - w * 0.43) / (w * 0.79);
    const edgeY = h * (-0.5 + 0.95 * Math.sqrt(Math.max(0, 1 - u * u)));
    const gloss = (0.26 - 0.24 * clamp(y / (h * 0.45))) * (1 - smooth(edgeY - 3, edgeY + 1, y));
    return [white(d <= 0 ? gloss : 0)];
  });
  function rim(x, y, d, focus) {
    if (d > 0) return [];
    const depth = -d;
    const light = clamp(1 - (x / w * 0.42 + y / h * 0.58));
    const stroke = (focus ? 0.55 + 0.4 * light : 0.15 + 0.6 * light) * (1 - smooth(2, 3.5, depth));
    const dark = 0.18 * smooth(2.5, 3.5, depth) * (1 - smooth(4.5, 5.5, depth));
    const refraction = 0.08 * Math.exp(-(((depth - 8) / 6) ** 2)) * smooth(0.55, 1, y / h);
    return [white(refraction), black(dark), white(stroke)];
  }
  files[`${shape}.9.png`] = shapeImage((x, y, d) => rim(x, y, d, false));
  files[`${shape}-focus.9.png`] = shapeImage((x, y, d) => rim(x, y, d, true));
  files[`${shape}-shadow.9.png`] = shapeImage((x, y) => {
    const d = roundedRect(x, y - 12, w, h, radius);
    return [black(0.33 * Math.exp(-(Math.max(0, d) ** 2) / (2 * 18 ** 2)))];
  }, 72);
  files[`${shape}-focus-glow.9.png`] = shapeImage((x, y, d) => [white(d > 0 ? 0.3 * Math.exp(-d * d / (2 * 12 ** 2)) : 0)], 48);
}
// Existing callers reserve 16 units around the focus rim.
files['focus-ring.9.png'] = nine(raster(160, 160, (x, y) => {
  const d = roundedRect(x - 16, y - 16, 128, 128, 36);
  return over([white(d > 0 ? 0.22 * Math.exp(-d * d / 80) : 0), white(d <= 0 && d > -3 ? 0.95 : 0)]);
}), 54, 54);
files['focus-glow.9.png'] = files['card-focus-glow.9.png'];
files['progress.9.png'] = nine(raster(32, 8, (x, y) => over([white(roundedRect(x, y, 32, 8, 4) <= 0 ? 1 : 0)])), 5, 3);
for (const warm of [false, true]) {
  const size = 512;
  files[warm ? 'orb-account.png' : 'orb.png'] = raster(size, size, (x, y) => {
    const nx = (x - 256) / 256, ny = (y - 256) / 256;
    const r = Math.hypot(nx, ny);
    if (r >= 1) return [0, 0, 0, 0];
    const depth = (1 - r) * 256;
    const body = 0.06 + 0.2 * Math.exp(-((nx + 0.12) ** 2 / 0.72 + (ny + 0.54) ** 2 / 0.5));
    const hotspotRadius = Math.hypot((nx + 0.4) / 0.59, (ny + 0.65) / 0.28);
    const hotspot = 0.85 * Math.max(0, 1 - hotspotRadius) ** 1.6;
    const crescent = 0.35 * Math.exp(-(((depth - 9) / 7) ** 2)) * clamp((nx + ny + 0.3) / 1.5);
    const rim = (0.15 + 0.65 * clamp(0.5 - nx * 0.35 - ny * 0.45)) * (1 - smooth(1.5, 4, depth));
    const reflection = 0.07 * Math.exp(-(((ny - 0.57 - nx * 0.06) / 0.055) ** 2)) * (1 - r);
    const tint = warm ? [245, 231, 213, body] : [214, 231, 245, body];
    return over([tint, white(0.14 * r ** 7), black(0.18 * Math.exp(-(((depth - 5) / 2) ** 2))), white(reflection), white(hotspot), [255, 241, 224, crescent], white(rim)]);
  });
}
files['orb-halo.png'] = raster(640, 640, (x, y) => {
  const d = Math.hypot(x - 320, y - 320) - 256;
  return over([[255, 237, 215, d > 0 ? 0.3 * Math.exp(-d * d / (2 * 16 ** 2)) : 0], white(Math.abs(d) < 1.5 ? 0.95 : 0)]);
});
files['ellipse.png'] = raster(1024, 512, (x, y) => {
  const nx = (x - 512) / 512, ny = (y - 256) / 256;
  const r = Math.hypot(nx, ny), depth = (1 - r) * 256;
  if (r > 1) return [0, 0, 0, 0];
  const rim = (0.15 + 0.4 * clamp(0.5 - ny * 0.5 - nx * 0.15)) * (1 - smooth(0.4, 1.8, depth));
  return over([white(0.05), white(0.035 * (1 - r) * (1 - ny) / 2), white(rim)]);
});
files['spoke.png'] = raster(512, 24, (x, y) => {
  const d = Math.abs(y - 12), ends = smooth(0, 28, x) * smooth(0, 28, 512 - x);
  return over([white(0.15 * Math.exp(-d * d / 22) * ends), white(0.75 * (1 - smooth(2.5, 3.5, d)) * ends)]);
});
files['highlight.png'] = files['pill-gloss.9.png'];
files['dot.png'] = raster(32, 32, (x, y) => over([white(Math.hypot(x - 16, y - 16) <= 16 ? 1 : 0)]));
for (const [name, w, h, radius] of [
  ['mask-wide.png', 800, 450, 40],
  ['mask-portrait.png', 560, 840, 36],
  ['mask-avatar.png', 144, 144, 72],
]) {
  files[name] = raster(w, h, (x, y) => over([white(roundedRect(x, y, w, h, radius) <= 0 ? 1 : 0)]));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(outDir, { recursive: true });
  for (const [name, img] of Object.entries(files)) {
    const png = encodePng(img.width, img.height, img.data);
    writeFileSync(join(outDir, name), png);
    console.log(`${name} ${img.width}x${img.height} ${png.length} bytes`);
  }
}
