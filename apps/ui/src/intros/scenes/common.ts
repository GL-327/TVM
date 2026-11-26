/**
 * Shared drawing helpers for the franchise intro scenes. Everything is
 * procedural (gradients, paths, sprites made on an offscreen canvas), so the
 * intros work offline and cost nothing to download.
 */

export interface SceneOptions {
  accent: string;
  glow: string;
  /** The name drawn on the title card. */
  title: string;
  durationMs: number;
}

export interface IntroScene {
  resize(width: number, height: number): void;
  /** Draws the frame at `t` milliseconds into an already DPR-scaled context. */
  draw(ctx: CanvasRenderingContext2D, t: number): void;
}

export type Rgb = [number, number, number];
export type Pt = [number, number];

export const TAU = Math.PI * 2;

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

/** 0 before `a`, 1 after `b`, smooth in between. */
export function smooth(a: number, b: number, t: number): number {
  const k = clamp01((t - a) / (b - a));
  return k * k * (3 - 2 * k);
}

export function ramp(a: number, b: number, t: number): number {
  return clamp01((t - a) / (b - a));
}

export const easeOutCubic = (k: number): number => 1 - (1 - k) ** 3;
export const easeInOutCubic = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
export const easeOutExpo = (k: number): number => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));

/** Small deterministic generator so the same frame always draws the same way. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) return [255, 255, 255];
  const n = parseInt(m[1] ?? 'ffffff', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(rgb: Rgb, a: number): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a < 0 ? 0 : a > 1 ? 1 : a})`;
}

export function mix(a: Rgb, b: Rgb, k: number): Rgb {
  return [Math.round(lerp(a[0], b[0], k)), Math.round(lerp(a[1], b[1], k)), Math.round(lerp(a[2], b[2], k))];
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** A soft round light, white-hot in the middle and tinted at the edge. Drawn with drawImage. */
export function glowSprite(rgb: Rgb, size = 64, hot = 0.55): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  if (g === null) return c;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, rgba(mix(rgb, [255, 255, 255], hot), 1));
  grad.addColorStop(0.18, rgba(mix(rgb, [255, 255, 255], hot * 0.5), 0.85));
  grad.addColorStop(0.45, rgba(rgb, 0.28));
  grad.addColorStop(1, rgba(rgb, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Soft cloud for smoke and mist. */
export function cloudSprite(rgb: Rgb, size = 256): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  if (g === null) return c;
  const r = size / 2;
  const rand = rng(7);
  for (let i = 0; i < 14; i += 1) {
    const x = r + (rand() - 0.5) * r * 0.9;
    const y = r + (rand() - 0.5) * r * 0.9;
    const rr = r * (0.35 + rand() * 0.4);
    const grad = g.createRadialGradient(x, y, 0, x, y, rr);
    grad.addColorStop(0, rgba(rgb, 0.22));
    grad.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  return c;
}

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  size: number,
  alpha: number,
): void {
  if (alpha <= 0.003 || size <= 0.2) return;
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
}

export function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.58);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Sample a cubic bezier into `n` points (excluding the start). */
export function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 12): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

export function quad(p0: Pt, p1: Pt, p2: Pt, n = 8): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return out;
}

export function polyPath(points: Pt[], close = true): Path2D {
  const p = new Path2D();
  points.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
  if (close) p.closePath();
  return p;
}

export function measureTracked(ctx: CanvasRenderingContext2D, text: string, tracking: number): number {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + tracking;
  return w - tracking;
}

/** Break `text` into at most `maxLines` lines no wider than `maxWidth`, shrinking the font to fit. */
export function fitLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontFor: (px: number) => string,
  startPx: number,
  maxWidth: number,
  maxLines: number,
  tracking: (px: number) => number,
): { lines: string[]; px: number } {
  const words = text.split(/\s+/).filter((w) => w !== '');
  let px = startPx;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    ctx.font = fontFor(px);
    const width = (s: string): number => measureTracked(ctx, s, tracking(px));
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line === '' ? word : `${line} ${word}`;
      if (line !== '' && width(next) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line !== '') lines.push(line);
    if (lines.length <= maxLines && lines.every((l) => width(l) <= maxWidth)) return { lines, px };
    px *= 0.93;
  }
  return { lines: [text], px };
}

/** Draws text one glyph at a time with `tracking` pixels of letter spacing, centred on `cx`. */
export function fillTracked(
  ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, tracking: number, stroke = false,
): void {
  const total = measureTracked(ctx, text, tracking);
  let x = cx - total / 2;
  const align = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of text) {
    if (stroke) ctx.strokeText(ch, x, y);
    else ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + tracking;
  }
  ctx.textAlign = align;
}
