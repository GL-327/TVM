/**
 * Rasterize TVM chrome for SceneGraph: ribbon/player icons, vignettes, app tiles.
 * Also tries to fetch Inter (SIL OFL) so the channel can approximate desktop type.
 */
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const images = join(root, "images");
const fontsDir = join(root, "fonts");

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let b = 0; b < 8; b += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, "ascii");
  const crcBuf = Buffer.concat([header.subarray(4, 8), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([header, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function canvas(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

function setPx(c, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height || a <= 0) return;
  const i = (y * c.width + x) * 4;
  const srcA = a / 255;
  const dstA = c.data[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  c.data[i] = Math.round((r * srcA + c.data[i] * dstA * (1 - srcA)) / outA);
  c.data[i + 1] = Math.round((g * srcA + c.data[i + 1] * dstA * (1 - srcA)) / outA);
  c.data[i + 2] = Math.round((b * srcA + c.data[i + 2] * dstA * (1 - srcA)) / outA);
  c.data[i + 3] = Math.round(outA * 255);
}

function fillRect(c, x, y, w, h, r, g, b, a) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(c.width, Math.ceil(x + w));
  const y1 = Math.min(c.height, Math.ceil(y + h));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) setPx(c, px, py, r, g, b, a);
  }
}

function fillCircle(c, cx, cy, radius, r, g, b, a) {
  const rad = Math.ceil(radius);
  for (let y = -rad; y <= rad; y += 1) {
    for (let x = -rad; x <= rad; x += 1) {
      if (x * x + y * y <= radius * radius) setPx(c, Math.round(cx + x), Math.round(cy + y), r, g, b, a);
    }
  }
}

function strokeCircle(c, cx, cy, radius, width, r, g, b, a) {
  const rad = Math.ceil(radius + width);
  const inner = radius - width / 2;
  const outer = radius + width / 2;
  for (let y = -rad; y <= rad; y += 1) {
    for (let x = -rad; x <= rad; x += 1) {
      const d = Math.sqrt(x * x + y * y);
      if (d >= inner && d <= outer) setPx(c, Math.round(cx + x), Math.round(cy + y), r, g, b, a);
    }
  }
}

function drawLine(c, x0, y0, x1, y1, width, r, g, b, a) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    fillCircle(c, x0 + dx * t, y0 + dy * t, width / 2, r, g, b, a);
  }
}

function roundRect(c, x, y, w, h, radius, r, g, b, a, fill) {
  if (fill) {
    fillRect(c, x + radius, y, w - radius * 2, h, r, g, b, a);
    fillRect(c, x, y + radius, w, h - radius * 2, r, g, b, a);
    fillCircle(c, x + radius, y + radius, radius, r, g, b, a);
    fillCircle(c, x + w - radius, y + radius, radius, r, g, b, a);
    fillCircle(c, x + radius, y + h - radius, radius, r, g, b, a);
    fillCircle(c, x + w - radius, y + h - radius, radius, r, g, b, a);
  } else {
    const wdt = 3;
    fillRect(c, x + radius, y, w - radius * 2, wdt, r, g, b, a);
    fillRect(c, x + radius, y + h - wdt, w - radius * 2, wdt, r, g, b, a);
    fillRect(c, x, y + radius, wdt, h - radius * 2, r, g, b, a);
    fillRect(c, x + w - wdt, y + radius, wdt, h - radius * 2, r, g, b, a);
  }
}

function save(c, rel) {
  const path = join(images, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(c.width, c.height, c.data));
}

function icon(draw) {
  const c = canvas(64, 64);
  draw(c);
  return c;
}

const W = 255;
function whiteIcon(draw) {
  return icon((c) => draw(c, W, W, W, 255));
}

const icons = {
  profile: icon((c) => {
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const dx = x - 32;
        const dy = y - 32;
        if (dx * dx + dy * dy > 31 * 31) continue;
        const t = (x + y) / 128;
        setPx(c, x, y, Math.round(192 - t * 70), Math.round(132 - t * 40), 252, 255);
      }
    }
    fillCircle(c, 24, 26, 3, 42, 18, 72, 255);
    fillCircle(c, 40, 26, 3, 42, 18, 72, 255);
    drawLine(c, 22, 40, 32, 44, 3, 42, 18, 72, 255);
    drawLine(c, 32, 44, 42, 40, 3, 42, 18, 72, 255);
  }),
  inputs: whiteIcon((c, r, g, b, a) => {
    roundRect(c, 12, 18, 40, 28, 5, r, g, b, a, false);
    drawLine(c, 26, 32, 44, 32, 3, r, g, b, a);
    drawLine(c, 38, 26, 46, 32, 3, r, g, b, a);
    drawLine(c, 38, 38, 46, 32, 3, r, g, b, a);
  }),
  search: whiteIcon((c, r, g, b, a) => {
    strokeCircle(c, 28, 28, 13, 3, r, g, b, a);
    drawLine(c, 38, 38, 50, 50, 3, r, g, b, a);
  }),
  home: whiteIcon((c, r, g, b, a) => {
    drawLine(c, 14, 32, 32, 16, 3, r, g, b, a);
    drawLine(c, 32, 16, 50, 32, 3, r, g, b, a);
    drawLine(c, 18, 30, 18, 50, 3, r, g, b, a);
    drawLine(c, 46, 30, 46, 50, 3, r, g, b, a);
    drawLine(c, 18, 50, 46, 50, 3, r, g, b, a);
    fillRect(c, 26, 38, 12, 12, r, g, b, a);
  }),
  live: whiteIcon((c, r, g, b, a) => {
    roundRect(c, 10, 18, 44, 28, 4, r, g, b, a, false);
    drawLine(c, 22, 52, 42, 52, 3, r, g, b, a);
    drawLine(c, 24, 14, 32, 20, 3, r, g, b, a);
    drawLine(c, 40, 14, 32, 20, 3, r, g, b, a);
  }),
  watchlist: whiteIcon((c, r, g, b, a) => {
    drawLine(c, 18, 12, 46, 12, 3, r, g, b, a);
    drawLine(c, 18, 12, 18, 52, 3, r, g, b, a);
    drawLine(c, 46, 12, 46, 52, 3, r, g, b, a);
    drawLine(c, 18, 52, 32, 42, 3, r, g, b, a);
    drawLine(c, 46, 52, 32, 42, 3, r, g, b, a);
  }),
  apps: whiteIcon((c, r, g, b, a) => {
    roundRect(c, 12, 12, 16, 16, 3, r, g, b, a, false);
    roundRect(c, 36, 12, 16, 16, 3, r, g, b, a, false);
    roundRect(c, 12, 36, 16, 16, 3, r, g, b, a, false);
    roundRect(c, 36, 36, 16, 16, 3, r, g, b, a, false);
  }),
  settings: whiteIcon((c, r, g, b, a) => {
    strokeCircle(c, 32, 32, 7, 3, r, g, b, a);
    for (let i = 0; i < 8; i += 1) {
      const ang = (i * Math.PI) / 4;
      drawLine(c, 32 + Math.cos(ang) * 12, 32 + Math.sin(ang) * 12, 32 + Math.cos(ang) * 20, 32 + Math.sin(ang) * 20, 3, r, g, b, a);
    }
  }),
  play: whiteIcon((c, r, g, b, a) => {
    for (let y = 14; y <= 50; y += 1) {
      const t = (y - 14) / 36;
      const x0 = 18;
      const x1 = 18 + (1 - Math.abs(t * 2 - 1)) * 28;
      drawLine(c, x0, y, x1, y, 1.6, r, g, b, a);
    }
  }),
  pause: whiteIcon((c, r, g, b, a) => {
    fillRect(c, 18, 14, 10, 36, r, g, b, a);
    fillRect(c, 36, 14, 10, 36, r, g, b, a);
  }),
  rewind: whiteIcon((c, r, g, b, a) => {
    for (let y = 16; y <= 48; y += 1) {
      const t = (y - 16) / 32;
      const span = (1 - Math.abs(t * 2 - 1)) * 14;
      drawLine(c, 30, y, 30 - span, y, 1.6, r, g, b, a);
      drawLine(c, 52, y, 52 - span, y, 1.6, r, g, b, a);
    }
  }),
  forward: whiteIcon((c, r, g, b, a) => {
    for (let y = 16; y <= 48; y += 1) {
      const t = (y - 16) / 32;
      const span = (1 - Math.abs(t * 2 - 1)) * 14;
      drawLine(c, 12, y, 12 + span, y, 1.6, r, g, b, a);
      drawLine(c, 34, y, 34 + span, y, 1.6, r, g, b, a);
    }
  }),
  back: whiteIcon((c, r, g, b, a) => {
    drawLine(c, 40, 16, 22, 32, 3.2, r, g, b, a);
    drawLine(c, 22, 32, 40, 48, 3.2, r, g, b, a);
  }),
};

for (const [name, c] of Object.entries(icons)) save(c, `icons/${name}.png`);

function vignette(width, height, fn) {
  const c = canvas(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = fn(x / (width - 1), y / (height - 1));
      if (a <= 0) continue;
      setPx(c, x, y, 11, 11, 11, Math.round(Math.min(1, a) * 255));
    }
  }
  return c;
}

save(
  vignette(980, 720, (x) => (1 - x) * 0.78),
  "chrome/hero-vignette-left.png",
);
save(
  vignette(1920, 320, (_x, y) => y * 0.94),
  "chrome/hero-vignette-bottom.png",
);
save(
  vignette(1100, 1080, (x) => (1 - x) * 0.92),
  "chrome/details-vignette-left.png",
);
save(
  vignette(1920, 420, (_x, y) => Math.max(0, y * 1.05 - 0.05)),
  "chrome/details-vignette-bottom.png",
);

function roundedMask(width, height, radius) {
  const c = canvas(width, height);
  roundRect(c, 0, 0, width, height, radius, 255, 255, 255, 255, true);
  return c;
}

save(roundedMask(275, 412, 20), "chrome/poster-mask.png");
save(roundedMask(396, 223, 20), "chrome/poster-mask-wide.png");
save(roundedMask(284, 155, 22), "chrome/app-tile-mask.png");

function lockupMark() {
  const size = 64;
  const c = canvas(size, size);
  const cx = 32;
  const cy = 32;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / 20;
      const glow = Math.max(0, 1 - d);
      if (glow > 0) setPx(c, x, y, 0, 168, 225, Math.round(glow * glow * 150));
    }
  }
  const inner = 20;
  const x0 = (size - inner) / 2;
  const y0 = (size - inner) / 2;
  const radius = 5;
  for (let y = 0; y < inner; y += 1) {
    for (let x = 0; x < inner; x += 1) {
      const lx = x + 0.5;
      const ly = y + 0.5;
      const dx = lx < radius ? radius - lx : lx > inner - radius ? lx - (inner - radius) : 0;
      const dy = ly < radius ? radius - ly : ly > inner - radius ? ly - (inner - radius) : 0;
      if (dx * dx + dy * dy > radius * radius) continue;
      const t = (x + y) / (inner * 2);
      const r = Math.round(122 * (1 - t) + 0 * t);
      const g = Math.round(215 * (1 - t) + 95 * t);
      const b = Math.round(255 * (1 - t) + 134 * t);
      setPx(c, Math.round(x0 + x), Math.round(y0 + y), r, g, b, 255);
    }
  }
  return c;
}

save(lockupMark(), "chrome/lockup-mark.png");

const APPS = [
  { id: "tvm-stream", color: [91, 61, 255] },
  { id: "netflix", color: [229, 9, 20] },
  { id: "prime", color: [15, 23, 30] },
  { id: "freevee", color: [17, 17, 17] },
  { id: "youtube", color: [255, 255, 255] },
  { id: "disney", color: [17, 60, 140] },
  { id: "hulu", color: [11, 11, 11] },
  { id: "max", color: [5, 30, 90] },
  { id: "iplayer", color: [255, 77, 36] },
  { id: "appletv", color: [20, 20, 20] },
  { id: "peacock", color: [0, 0, 0] },
  { id: "paramount", color: [0, 98, 180] },
  { id: "tubi", color: [250, 56, 47] },
  { id: "pluto", color: [0, 0, 0] },
  { id: "starz", color: [18, 18, 18] },
  { id: "fox", color: [0, 0, 0] },
];

for (const app of APPS) {
  const c = canvas(400, 240);
  fillRect(c, 0, 0, 400, 240, app.color[0], app.color[1], app.color[2], 255);
  save(c, `apps/${app.id}.png`);
}

async function fetchFont(url, dest) {
  if (existsSync(dest)) return true;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok || response.body === null) return false;
    mkdirSync(dirname(dest), { recursive: true });
    await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
    return true;
  } catch {
    return false;
  }
}

const regular = join(fontsDir, "Inter-Regular.ttf");
const bold = join(fontsDir, "Inter-Bold.ttf");
const regularOk = await fetchFont(
  "https://github.com/rsms/inter/raw/v3.19/docs/font-files/Inter-Regular.otf",
  join(fontsDir, "Inter-Regular.otf"),
);
const boldOk = await fetchFont(
  "https://github.com/rsms/inter/raw/v3.19/docs/font-files/Inter-Bold.otf",
  join(fontsDir, "Inter-Bold.otf"),
);

if (regularOk && !existsSync(regular)) {
  // Roku prefers TTF; keep OTF as the packaged face if TTF is unavailable.
}
if (boldOk && !existsSync(bold)) {
  // same
}

console.log("Wrote Roku chrome assets.");
if (!regularOk || !boldOk) console.log("Inter download skipped or failed; channel will use system fonts.");
