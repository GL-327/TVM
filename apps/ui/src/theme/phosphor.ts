/** 1970s/80s CRT phosphor: many snapped colours, black void, chunky cells, scanlines. */

export type Rgb = readonly [number, number, number];

export const VOID: Rgb = [0, 0, 0];
export const CREAM: Rgb = [255, 245, 214];
export const WHITE: Rgb = [236, 232, 220];
export const GOLD: Rgb = [255, 211, 25];
export const AMBER: Rgb = [255, 122, 24];
export const ORANGE: Rgb = [255, 88, 32];
export const RED: Rgb = [210, 36, 28];
export const PINK: Rgb = [232, 96, 140];
export const MAGENTA: Rgb = [255, 43, 214];
export const VIOLET: Rgb = [122, 28, 255];
export const NAVY: Rgb = [32, 48, 128];
export const BLUE: Rgb = [48, 104, 210];
export const CYAN: Rgb = [18, 247, 255];
export const TEAL: Rgb = [24, 140, 148];
export const GREEN: Rgb = [46, 168, 88];
export const LIME: Rgb = [148, 204, 56];
export const OLIVE: Rgb = [96, 120, 48];
export const SKIN: Rgb = [224, 168, 122];
export const TAN: Rgb = [176, 112, 64];
export const BROWN: Rgb = [96, 52, 28];
export const CHARCOAL: Rgb = [52, 52, 56];
export const GRAY: Rgb = [128, 124, 118];
export const SILVER: Rgb = [188, 186, 178];

export const PHOSPHOR: readonly Rgb[] = [
  CREAM,
  WHITE,
  GOLD,
  AMBER,
  ORANGE,
  RED,
  PINK,
  MAGENTA,
  VIOLET,
  NAVY,
  BLUE,
  CYAN,
  TEAL,
  GREEN,
  LIME,
  OLIVE,
  SKIN,
  TAN,
  BROWN,
  CHARCOAL,
  GRAY,
  SILVER,
];

export const CELL = 1;
const PALETTE_CAP = 12;

export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function dist2(a: Rgb, b: Rgb): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

export function nearestColor(r: number, g: number, b: number, palette: readonly Rgb[]): Rgb {
  let best = palette[0] ?? VOID;
  let bestD = Infinity;
  for (const colour of palette) {
    const d = dist2([r, g, b], colour);
    if (d < bestD) {
      bestD = d;
      best = colour;
    }
  }
  return best;
}

export function nearestPhosphor(r: number, g: number, b: number): Rgb {
  return nearestColor(r, g, b, PHOSPHOR);
}

export function averageBright(data: Uint8ClampedArray): Rgb | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 16) continue;
    const y = luma(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    if (y < 10) continue;
    r += data[i] ?? 0;
    g += data[i + 1] ?? 0;
    b += data[i + 2] ?? 0;
    n += 1;
  }
  if (n === 0) return null;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

export function mostCommonPhosphor(data: Uint8ClampedArray): Rgb {
  const ranked = rankPhosphor(data);
  return ranked[0]?.colour ?? GOLD;
}

function rankPhosphor(data: Uint8ClampedArray): Array<{ colour: Rgb; n: number }> {
  const counts = new Map<string, { colour: Rgb; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const y = luma(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    if (y < 10) continue;
    const colour = nearestPhosphor(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    const key = `${colour[0]},${colour[1]},${colour[2]}`;
    const slot = counts.get(key);
    if (slot !== undefined) slot.n += 1;
    else counts.set(key, { colour, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n);
}

export function paletteFromImage(data: Uint8ClampedArray): Rgb[] {
  const ranked = rankPhosphor(data);
  const picked: Rgb[] = [VOID];
  for (const slot of ranked) {
    if (picked.length >= PALETTE_CAP) break;
    if (picked.some((colour) => dist2(colour, slot.colour) < 900)) continue;
    picked.push(slot.colour);
  }
  const avg = averageBright(data);
  if (avg !== null && luma(avg[0], avg[1], avg[2]) > 160 && !picked.some((c) => dist2(c, CREAM) < 4000)) {
    picked.splice(1, 0, CREAM);
  }
  if (picked.length < 3) picked.push(CREAM, GOLD);
  return picked.slice(0, PALETTE_CAP);
}

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number): Rgb {
  const i = (y * width + x) * 4;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
}

function writePixel(data: Uint8ClampedArray, width: number, x: number, y: number, colour: Rgb): void {
  const i = (y * width + x) * 4;
  data[i] = colour[0];
  data[i + 1] = colour[1];
  data[i + 2] = colour[2];
  data[i + 3] = 255;
}

function modeRgb(colours: Rgb[]): Rgb {
  const counts = new Map<string, { colour: Rgb; n: number }>();
  for (const colour of colours) {
    const key = `${colour[0]},${colour[1]},${colour[2]}`;
    const slot = counts.get(key);
    if (slot !== undefined) slot.n += 1;
    else counts.set(key, { colour, n: 1 });
  }
  let best = colours[0] ?? VOID;
  let n = 0;
  for (const slot of counts.values()) {
    if (slot.n > n) {
      n = slot.n;
      best = slot.colour;
    }
  }
  return best;
}

/** Quantize to the picture's own phosphor set, then fill each cell with its mode. */
export function stylizePixels(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const palette = paletteFromImage(data);
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y += CELL) {
    for (let x = 0; x < width; x += CELL) {
      const maxX = Math.min(x + CELL, width);
      const maxY = Math.min(y + CELL, height);
      const area = (maxX - x) * (maxY - y);
      let dark = 0;
      const colours: Rgb[] = [];
      for (let cy = y; cy < maxY; cy += 1) {
        for (let cx = x; cx < maxX; cx += 1) {
          const pixel = pixelAt(data, width, cx, cy);
          if (luma(pixel[0], pixel[1], pixel[2]) < 10) {
            dark += 1;
            continue;
          }
          colours.push(nearestColor(pixel[0], pixel[1], pixel[2], palette));
        }
      }
      const fill = dark >= area * 0.8 || colours.length === 0 ? VOID : modeRgb(colours);
      for (let cy = y; cy < maxY; cy += 1) {
        for (let cx = x; cx < maxX; cx += 1) writePixel(out, width, cx, cy, fill);
      }
    }
  }

  for (let y = 5; y < height; y += 6) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      out[i] = Math.round((out[i] ?? 0) * 0.85);
      out[i + 1] = Math.round((out[i + 1] ?? 0) * 0.85);
      out[i + 2] = Math.round((out[i + 2] ?? 0) * 0.85);
    }
  }
  return out;
}

export function posterSize(kind: 'poster' | 'backdrop' | 'logo'): { width: number; height: number } {
  if (kind === 'backdrop') return { width: 128, height: 72 };
  if (kind === 'logo') return { width: 64, height: 64 };
  return { width: 96, height: 144 };
}
