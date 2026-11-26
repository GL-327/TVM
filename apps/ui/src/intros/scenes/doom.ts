/**
 * Doomsday intro: a green-black metal wall, crackling mystic arcs and rune
 * rings, a riveted mask that closes from two plates, a shockwave, and a heavy
 * metallic title. Drawn entirely with canvas paths; no logo art.
 */
import {
  type IntroScene,
  type Pt,
  type Rgb,
  type SceneOptions,
  TAU,
  clamp01,
  cubic,
  drawSprite,
  easeInOutCubic,
  easeOutCubic,
  easeOutExpo,
  fillTracked,
  fitLines,
  glowSprite,
  hexRgb,
  lerp,
  makeCanvas,
  measureTracked,
  mix,
  polyPath,
  ramp,
  rgba,
  rng,
  smooth,
  vignette,
} from './common';

const BURST_AT = 2000;
const SLAM_AT = 2380;
const SLAM_MS = 260;


/** The right half of the faceplate, top centre down to the chin. */
function faceHalf(): Pt[] {
  const top: Pt = [0, -0.66];
  return [
    top,
    ...cubic(top, [0.2, -0.67], [0.4, -0.54], [0.45, -0.3], 10),
    ...cubic([0.45, -0.3], [0.48, -0.12], [0.44, 0.12], [0.38, 0.27], 10),
    ...cubic([0.38, 0.27], [0.33, 0.43], [0.16, 0.56], [0, 0.61], 10),
  ];
}

function hoodHalf(): Pt[] {
  const top: Pt = [0, -1.02];
  return [
    top,
    ...cubic(top, [0.5, -1.0], [0.84, -0.62], [0.86, -0.12], 14),
    ...cubic([0.86, -0.12], [0.88, 0.3], [1.0, 0.62], [1.12, 1.1], 12),
    [1.3, 1.95],
    [0, 1.95],
  ];
}

const FACE = faceHalf();
const HOOD = hoodHalf();
const EYE: Pt[] = [[0.06, -0.12], [0.33, -0.25], [0.37, -0.17], [0.09, -0.04]];
const NOSE: Pt[] = [[0.0, -0.06], [0.045, 0.03], [0.07, 0.19], [0.0, 0.23]];
const BROW: Pt[] = [[0.03, -0.32], [0.41, -0.41], [0.43, -0.35], [0.05, -0.26]];
const RIVETS: Pt[] = [[0.36, -0.44], [0.435, -0.2], [0.37, 0.18], [0.27, 0.4], [0.12, 0.54], [0.14, -0.57], [0.3, -0.52], [0.06, 0.37]];

/** A made-up rune: a few strokes through a 3x5 grid. */
function runeGlyphs(count: number, seed: number): Pt[][] {
  const rand = rng(seed);
  const out: Pt[][] = [];
  for (let i = 0; i < count; i += 1) {
    const pts: Pt[] = [];
    const n = 3 + Math.floor(rand() * 3);
    let gx = Math.floor(rand() * 3);
    let gy = Math.floor(rand() * 5);
    pts.push([gx / 2, gy / 4]);
    for (let s = 1; s < n; s += 1) {
      const nx = Math.floor(rand() * 3);
      const ny = Math.floor(rand() * 5);
      if (nx === gx && ny === gy) continue;
      gx = nx;
      gy = ny;
      pts.push([gx / 2, gy / 4]);
    }
    out.push(pts);
  }
  return out;
}

/** A soft ring of light: transparent at both edges, brightest just inside the outer edge. */
function band(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, half: number, color: Rgb, hotColor: Rgb, alpha: number): void {
  if (alpha <= 0.004) return;
  const inner = Math.max(0, r - half);
  const outer = r + half;
  const g = ctx.createRadialGradient(x, y, inner, x, y, outer);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.55, rgba(color, 0.35));
  g.addColorStop(0.8, rgba(hotColor, 1));
  g.addColorStop(0.9, rgba(color, 0.3));
  g.addColorStop(1, rgba(color, 0));
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, outer, 0, TAU);
  ctx.arc(x, y, inner, 0, TAU, true);
  ctx.fill();
}

interface Bolt { pts: Pt[]; a: number; width: number }

function bolt(rand: () => number, a: Pt, b: Pt, rough: number, depth: number, out: Bolt[], alpha: number, width: number): void {
  let pts: Pt[] = [a, b];
  let jitter = rough;
  for (let d = 0; d < depth; d += 1) {
    const next: Pt[] = [pts[0] as Pt];
    for (let i = 1; i < pts.length; i += 1) {
      const p = pts[i - 1] as Pt;
      const c = pts[i] as Pt;
      const dx = c[0] - p[0];
      const dy = c[1] - p[1];
      const len = Math.hypot(dx, dy) || 1;
      const off = (rand() - 0.5) * jitter * len;
      next.push([(p[0] + c[0]) / 2 - (dy / len) * off, (p[1] + c[1]) / 2 + (dx / len) * off]);
      next.push(c);
    }
    pts = next;
    jitter *= 0.62;
  }
  out.push({ pts, a: alpha, width });
  if (width > 1 && rand() < 0.7) {
    const at = pts[Math.floor(pts.length * (0.3 + rand() * 0.4))] as Pt;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + (rand() - 0.5) * 1.6;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * (0.18 + rand() * 0.22);
    bolt(rand, at, [at[0] + Math.cos(ang) * len, at[1] + Math.sin(ang) * len], rough, Math.max(3, depth - 2), out, alpha * 0.6, width * 0.55);
  }
}

interface Mote {
  x0: number; y0: number; start: number; dur: number; target: Pt; size: number; ph: number; curve: number;
}

export function createDoomScene(opts: SceneOptions): IntroScene {
  const accent = hexRgb(opts.accent);
  const deep = hexRgb(opts.glow);
  const arc: Rgb = mix(accent, [110, 255, 150], 0.55);
  const core: Rgb = mix(arc, [235, 255, 240], 0.75);
  const sprites = {
    green: glowSprite(arc, 64, 0.7),
    white: glowSprite([225, 255, 232], 64, 0.9),
    deep: glowSprite(deep, 64, 0.2),
  };
  const runesA = runeGlyphs(34, 91);
  const runesB = runeGlyphs(46, 17);

  let w = 0;
  let h = 0;
  let u = 0;
  let q = 1;
  let bg: HTMLCanvasElement | null = null;
  let titleArt: HTMLCanvasElement | null = null;
  let work: HTMLCanvasElement | null = null;
  let titleCy = 0;
  let motes: Mote[] = [];
  let sparksOut: { a: number; sp: number; life: number; size: number }[] = [];

  function buildBackground(): void {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    if (g === null) return;
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#020504');
    base.addColorStop(0.5, '#06110c');
    base.addColorStop(1, '#030705');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const rand = rng(404);
    // Brushed steel: long faint horizontal streaks.
    for (let i = 0; i < Math.round(h * 0.9); i += 1) {
      const y = rand() * h;
      const x = rand() * w;
      const len = w * (0.15 + rand() * 0.6);
      g.fillStyle = rand() < 0.5 ? 'rgba(160,210,180,0.028)' : 'rgba(0,0,0,0.12)';
      g.fillRect(x - len / 2, y, len, 1);
    }
    // Big riveted plates with bevelled seams.
    const cols = h > w ? 2 : 4;
    const rows = h > w ? 4 : 2;
    const pw = w / cols;
    const ph = h / rows;
    for (let i = 0; i <= cols; i += 1) {
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(i * pw - 2, 0, 4, h);
      g.fillStyle = 'rgba(150,200,170,0.07)';
      g.fillRect(i * pw + 2, 0, 1.5, h);
    }
    for (let j = 0; j <= rows; j += 1) {
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(0, j * ph - 2, w, 4);
      g.fillStyle = 'rgba(150,200,170,0.07)';
      g.fillRect(0, j * ph + 2, w, 1.5);
    }
    const rivet = Math.max(2, u * 0.012);
    for (let i = 0; i < cols; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        for (const [ox, oy] of [[0.07, 0.1], [0.93, 0.1], [0.07, 0.9], [0.93, 0.9]] as const) {
          const x = i * pw + ox * pw;
          const y = j * ph + oy * ph;
          const rg = g.createRadialGradient(x - rivet * 0.3, y - rivet * 0.3, 0, x, y, rivet * 1.4);
          rg.addColorStop(0, 'rgba(170,205,185,0.38)');
          rg.addColorStop(0.6, 'rgba(40,60,50,0.4)');
          rg.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = rg;
          g.beginPath();
          g.arc(x, y, rivet * 1.4, 0, TAU);
          g.fill();
        }
      }
    }
    // Slow green wash from the middle.
    const wash = g.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.7);
    wash.addColorStop(0, rgba(accent, 0.16));
    wash.addColorStop(0.5, rgba(deep, 0.1));
    wash.addColorStop(1, rgba(deep, 0));
    g.fillStyle = wash;
    g.fillRect(0, 0, w, h);
    bg = c;
  }

  function buildTitle(): void {
    const raw = opts.title.trim().toUpperCase();
    const colon = raw.indexOf(': ');
    const kicker = colon > 0 ? raw.slice(0, colon) : '';
    const main = colon > 0 ? raw.slice(colon + 2) : raw;
    const wrap = makeCanvas(w, Math.max(160, u * 1.1));
    const g = wrap.getContext('2d');
    if (g === null) return;
    const font = (px: number): string => `800 ${px}px Geist, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    const maxW = Math.min(w * 0.9, u * 3.5);
    const fit = fitLines(g, main, font, u * 0.46, maxW, 2, (px) => px * 0.05);
    const px = fit.px;
    const tracking = px * 0.05;
    const cx = w / 2;
    const lineH = px * 1.02;
    const kick = kicker === '' ? 0 : Math.max(14, px * 0.3);
    const top = wrap.height * 0.5 - ((fit.lines.length - 1) * lineH) / 2 - (kicker === '' ? 0 : kick * 0.6);
    g.textBaseline = 'alphabetic';
    if (kicker !== '') {
      const kfit = fitLines(g, kicker, (p) => `700 ${p}px Geist, "Segoe UI", Arial, sans-serif`, kick, maxW, 1, (p) => p * 0.5);
      g.font = `700 ${kfit.px}px Geist, "Segoe UI", Arial, sans-serif`;
      g.fillStyle = rgba(mix(arc, [220, 255, 230], 0.35), 0.95);
      g.shadowColor = rgba(arc, 0.9);
      g.shadowBlur = kfit.px * 0.6;
      fillTracked(g, kfit.lines[0] ?? '', cx, top - px * 0.62, kfit.px * 0.5);
      g.shadowBlur = 0;
    }
    g.font = font(px);
    fit.lines.forEach((line, i) => {
      const y = top + px * 0.34 + i * lineH + (kicker === '' ? px * 0.3 : 0);
      // Deep extrusion, then a green halo, then the chrome face.
      g.fillStyle = '#030806';
      for (let d = Math.ceil(px * 0.06); d >= 1; d -= 1) fillTracked(g, line, cx, y + d, tracking);
      g.shadowColor = rgba(arc, 0.85);
      g.shadowBlur = px * 0.32;
      g.strokeStyle = rgba(deep, 1);
      g.lineWidth = px * 0.05;
      fillTracked(g, line, cx, y, tracking, true);
      g.shadowBlur = 0;
      g.strokeStyle = '#06100b';
      g.lineWidth = px * 0.035;
      fillTracked(g, line, cx, y, tracking, true);
      const face = g.createLinearGradient(0, y - px * 0.72, 0, y + px * 0.02);
      face.addColorStop(0, '#f6fcf8');
      face.addColorStop(0.28, '#b9c8bf');
      face.addColorStop(0.47, '#70827a');
      face.addColorStop(0.5, '#16201b');
      face.addColorStop(0.62, '#33423b');
      face.addColorStop(0.86, rgba(mix(accent, [190, 215, 200], 0.55), 1));
      face.addColorStop(1, '#4b5e55');
      g.fillStyle = face;
      fillTracked(g, line, cx, y, tracking);
      g.strokeStyle = 'rgba(225,255,236,0.5)';
      g.lineWidth = Math.max(1, px * 0.01);
      fillTracked(g, line, cx, y, tracking, true);
    });
    // Brushed grain across the letters only.
    g.globalCompositeOperation = 'source-atop';
    for (let y = 0; y < wrap.height; y += 3) {
      g.fillStyle = y % 6 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
      g.fillRect(0, y, wrap.width, 1);
    }
    g.globalCompositeOperation = 'source-over';
    titleArt = wrap;
    work = makeCanvas(wrap.width, wrap.height);
    void measureTracked;
  }

  function buildParticles(): void {
    const rand = rng(77);
    const half = faceHalf();
    const n = Math.round(150 * q);
    motes = [];
    for (let i = 0; i < n; i += 1) {
      const p = half[Math.floor(rand() * half.length)] as Pt;
      const side = rand() < 0.5 ? -1 : 1;
      const angle = rand() * TAU;
      const dist = 0.9 + rand() * 0.7;
      motes.push({
        x0: Math.cos(angle) * dist, y0: Math.sin(angle) * dist * 0.75, start: 380 + rand() * 900, dur: 700 + rand() * 500,
        target: [p[0] * side, p[1]], size: 2 + rand() * 4, ph: rand() * TAU, curve: (rand() - 0.5) * 0.8,
      });
    }
    sparksOut = [];
    for (let i = 0; i < Math.round(110 * q); i += 1) {
      sparksOut.push({ a: rand() * TAU, sp: 0.4 + rand() * 1.6, life: 700 + rand() * 1100, size: 2 + rand() * 4 });
    }
  }

  function resize(width: number, height: number): void {
    w = Math.max(2, width);
    h = Math.max(2, height);
    u = Math.min(w, h) * 0.5;
    q = Math.max(0.45, Math.min(1, (w * h) / (1280 * 720)));
    titleCy = h * (h > w ? 0.67 : 0.7);
    buildBackground();
    buildTitle();
    buildParticles();
  }

  function maskTransform(t: number): { cx: number; cy: number; s: number } {
    const move = easeInOutCubic(ramp(BURST_AT + 200, BURST_AT + 1000, t));
    const compact = h > w ? 0.86 : 0.76;
    return {
      cx: w / 2,
      cy: lerp(h * 0.49, h > w ? h * 0.33 : h * 0.325, move),
      s: u * lerp(compact, compact * (h > w ? 0.62 : 0.46), move) * (1 + Math.sin(t * 0.002) * 0.004),
    };
  }

  function eyeLevel(t: number): number {
    if (t < 1700) return 0;
    if (t < BURST_AT) {
      const k = Math.floor((t - 1700) / 38);
      return rng(k + 5)() < 0.55 + (t - 1700) / 900 ? 1 : 0.1;
    }
    return 1 - 0.1 * Math.sin(t * 0.006);
  }

  function drawMask(ctx: CanvasRenderingContext2D, t: number): void {
    const gather = easeOutCubic(ramp(850, 1750, t));
    const off = 0.62 * (1 - gather);
    const alpha = smooth(780, 1250, t);
    const hoodA = smooth(650, 1450, t);
    const eye = eyeLevel(t);
    // Hood: dark cowl with a green rim.
    ctx.globalCompositeOperation = 'source-over';
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.translate(off * 0.4, 0);
      const hood = ctx.createLinearGradient(0, -1.02, 0, 1.95);
      hood.addColorStop(0, '#0e1b16');
      hood.addColorStop(0.4, '#050a08');
      hood.addColorStop(0.6, 'rgba(3,6,5,0.88)');
      hood.addColorStop(0.76, 'rgba(2,4,3,0)');
      ctx.globalAlpha = hoodA * 0.96;
      ctx.fillStyle = hood;
      ctx.fill(polyPath(HOOD));
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.translate(off * 0.4, 0);
      const rim = ctx.createLinearGradient(0, -1.02, 0, 1.4);
      rim.addColorStop(0, rgba(arc, 1));
      rim.addColorStop(0.45, rgba(arc, 0.55));
      rim.addColorStop(0.7, rgba(arc, 0));
      ctx.strokeStyle = rim;
      ctx.lineWidth = 0.05;
      ctx.globalAlpha = hoodA * 0.12;
      ctx.stroke(polyPath(HOOD.slice(0, -2), false));
      ctx.lineWidth = 0.012;
      ctx.globalAlpha = hoodA * 0.6;
      ctx.stroke(polyPath(HOOD.slice(0, -2), false));
      ctx.restore();
    }
    // Faceplate halves slide together.
    ctx.globalCompositeOperation = 'source-over';
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.translate(off, 0);
      ctx.globalAlpha = alpha;
      const metal = ctx.createLinearGradient(0.02, -0.64, 0.46, 0.6);
      const lit = side > 0 ? 1 : 0.78;
      metal.addColorStop(0, rgba(mix([40, 50, 45], [190, 208, 198], lit), 1));
      metal.addColorStop(0.22, rgba(mix([30, 40, 36], [120, 140, 130], lit), 1));
      metal.addColorStop(0.55, rgba(mix([14, 20, 17], [52, 66, 59], lit), 1));
      metal.addColorStop(1, '#070c0a');
      const facePath = polyPath(FACE);
      ctx.fillStyle = metal;
      ctx.fill(facePath);
      // Plate bevel.
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 0.026;
      ctx.stroke(facePath);
      ctx.strokeStyle = rgba(mix([170, 205, 185], arc, 0.15), 0.55 * lit);
      ctx.lineWidth = 0.008;
      ctx.save();
      ctx.translate(-0.006, -0.006);
      ctx.stroke(facePath);
      ctx.restore();
      // Brow ridge, nose slot, mouth vents.
      ctx.fillStyle = '#0a110e';
      ctx.fill(polyPath(BROW));
      ctx.strokeStyle = 'rgba(190,225,205,0.45)';
      ctx.lineWidth = 0.006;
      ctx.stroke(polyPath(BROW.slice(0, 2), false));
      ctx.fillStyle = '#020403';
      ctx.fill(polyPath(NOSE));
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 0.016;
      ctx.beginPath();
      for (const [y, x1] of [[0.34, 0.2], [0.405, 0.17], [0.47, 0.13]] as const) {
        ctx.moveTo(0.05, y);
        ctx.lineTo(x1, y);
      }
      ctx.stroke();
      // Cheek seam.
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.moveTo(0.36, -0.1);
      ctx.quadraticCurveTo(0.33, 0.1, 0.25, 0.3);
      ctx.stroke();
      // Rivets.
      for (const [rx, ry] of RIVETS) {
        const rg = ctx.createRadialGradient(rx - 0.006, ry - 0.006, 0, rx, ry, 0.026);
        rg.addColorStop(0, 'rgba(220,240,228,0.95)');
        rg.addColorStop(0.5, 'rgba(90,110,100,0.95)');
        rg.addColorStop(1, 'rgba(10,16,13,1)');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(rx, ry, 0.026, 0, TAU);
        ctx.fill();
      }
      // Sockets.
      ctx.fillStyle = '#010302';
      ctx.fill(polyPath(EYE.map(([x, y]): Pt => [x - 0.008, y - 0.012])));
      ctx.restore();
    }
    // Eyes and the seam where the plates meet.
    ctx.globalCompositeOperation = 'lighter';
    const seam = smooth(1500, 1750, t) * (1 - smooth(2100, 2800, t) * 0.7);
    if (seam > 0.01) {
      const sg = ctx.createLinearGradient(0, -0.66, 0, 0.61);
      sg.addColorStop(0, rgba(arc, 0));
      sg.addColorStop(0.3, rgba(core, 1));
      sg.addColorStop(0.7, rgba(arc, 0.9));
      sg.addColorStop(1, rgba(arc, 0));
      ctx.fillStyle = sg;
      ctx.globalAlpha = seam * 0.85;
      ctx.fillRect(-0.007, -0.66, 0.014, 1.27);
    }
    if (eye > 0.01) {
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.scale(side, 1);
        const slit = polyPath(EYE);
        ctx.fillStyle = rgba(mix(arc, [255, 255, 255], 0.85), 1);
        ctx.globalAlpha = eye;
        ctx.fill(slit);
        ctx.strokeStyle = rgba(arc, 1);
        ctx.lineWidth = 0.045;
        ctx.globalAlpha = eye * 0.3;
        ctx.stroke(slit);
        ctx.restore();
        drawSprite(ctx, sprites.green, side * 0.215, -0.145, 0.62, eye * 0.85);
        drawSprite(ctx, sprites.white, side * 0.215, -0.145, 0.2, eye);
      }
      // Faint glow bleeding out of the nose and mouth.
      drawSprite(ctx, sprites.green, 0, 0.1, 0.5, eye * 0.2);
    }
  }

  function drawRunes(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number, s: number): void {
    const a = smooth(650, 1500, t) * (0.5 + 0.5 * smooth(BURST_AT - 100, BURST_AT + 200, t));
    if (a <= 0.01) return;
    const pulse = 0.82 + 0.18 * Math.sin(t * 0.007);
    const flash = Math.max(0, 1 - Math.abs(t - BURST_AT - 40) / 240);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const rings = [
      { glyphs: runesA, r: 1.3, size: 0.1, spin: t * 0.00009, dir: 1 },
      { glyphs: runesB, r: 1.58, size: 0.07, spin: -t * 0.00013, dir: -1 },
    ];
    for (const ring of rings) {
      const n = ring.glyphs.length;
      const R = ring.r * s;
      const gs = ring.size * s;
      ctx.strokeStyle = rgba(arc, 1);
      ctx.lineWidth = Math.max(0.8, s * 0.006);
      ctx.globalAlpha = a * 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, R - gs * 0.9, 0, TAU);
      ctx.arc(0, 0, R + gs * 1.7, 0, TAU);
      ctx.stroke();
      for (const pass of [{ lw: Math.max(2, s * 0.02), al: 0.12 }, { lw: Math.max(0.9, s * 0.0065), al: 0.85 }]) {
        ctx.lineWidth = pass.lw;
        ctx.strokeStyle = pass.lw > 3 ? rgba(arc, 1) : rgba(mix(arc, core, 0.4 + flash * 0.6), 1);
        ctx.globalAlpha = Math.min(1, a * pass.al * pulse * (1 + flash * 0.8));
        ctx.beginPath();
        for (let i = 0; i < n; i += 1) {
          // Each glyph appears in turn as the ring is conjured.
          const born = ramp(650 + (i / n) * 700, 800 + (i / n) * 700, t);
          if (born <= 0) continue;
          const ang = (i / n) * TAU + ring.spin;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const glyph = ring.glyphs[i] as Pt[];
          glyph.forEach(([gx, gy], k) => {
            const lx = (gx - 0.5) * gs * 0.7;
            const ly = (0.5 - gy) * gs * 1.4 * born;
            const rx = ca * (R + ly) - sa * lx;
            const ry = sa * (R + ly) + ca * lx;
            if (k === 0) ctx.moveTo(rx, ry);
            else ctx.lineTo(rx, ry);
          });
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawArcs(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number, s: number): void {
    const tick = Math.floor(t / 75);
    const rand = rng(tick * 7919 + 3);
    const bolts: Bolt[] = [];
    const reach = Math.hypot(w, h) * 0.6;
    const before = smooth(420, 900, t) * (1 - smooth(1750, 1960, t));
    if (before > 0.01) {
      const count = 3 + Math.round(2 * q);
      for (let i = 0; i < count; i += 1) {
        const ang = rand() * TAU;
        const from: Pt = [cx + Math.cos(ang) * reach, cy + Math.sin(ang) * reach * 0.8];
        const toAng = ang + (rand() - 0.5) * 0.9;
        const to: Pt = [cx + Math.cos(toAng) * s * (0.55 + rand() * 0.35), cy + Math.sin(toAng) * s * (0.6 + rand() * 0.3)];
        bolt(rand, from, to, 0.45, 6, bolts, before * (0.55 + rand() * 0.45), 2.2);
      }
    }
    const burst = smooth(BURST_AT - 30, BURST_AT + 40, t) * (1 - smooth(BURST_AT + 250, BURST_AT + 1100, t));
    if (burst > 0.01) {
      for (let i = 0; i < 9; i += 1) {
        const ang = (i / 9) * TAU + rand() * 0.5;
        const to: Pt = [cx + Math.cos(ang) * u * (1.2 + rand() * 1.4), cy + Math.sin(ang) * u * (0.9 + rand() * 1.1)];
        bolt(rand, [cx + Math.cos(ang) * s * 0.4, cy + Math.sin(ang) * s * 0.4], to, 0.4, 6, bolts, burst, 2.6);
      }
    }
    const idle = smooth(BURST_AT + 300, BURST_AT + 800, t) * 0.55;
    if (idle > 0.01 && rand() < 0.8) {
      const ang = rand() * TAU;
      const from: Pt = [cx + Math.cos(ang) * s * 1.05, cy + Math.sin(ang) * s * 1.05];
      const to: Pt = [cx + Math.cos(ang + 0.6 + rand() * 0.5) * s * 1.7, cy + Math.sin(ang + 0.6 + rand() * 0.5) * s * 1.7];
      bolt(rand, from, to, 0.5, 5, bolts, idle, 1.6);
    }
    if (bolts.length === 0) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const pass of [{ lw: 9, a: 0.07, c: arc }, { lw: 3.4, a: 0.35, c: arc }, { lw: 1.3, a: 0.95, c: core }]) {
      for (const b of bolts) {
        ctx.strokeStyle = rgba(pass.c, 1);
        ctx.globalAlpha = Math.min(1, b.a * pass.a);
        ctx.lineWidth = pass.lw * (b.width / 2.2) * (u / 360 + 0.35);
        ctx.beginPath();
        b.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
      }
    }
  }

  function drawMotes(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number, s: number): void {
    ctx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      const b = easeInOutCubic(ramp(m.start, m.start + m.dur, t));
      if (b >= 1 && t > BURST_AT - 200) continue;
      const sx = cx + m.x0 * u * 1.5;
      const sy = cy + m.y0 * u * 1.5;
      const tx = cx + m.target[0] * s;
      const ty = cy + m.target[1] * s;
      const dx = tx - sx;
      const dy = ty - sy;
      const bow = Math.sin(b * Math.PI) * m.curve;
      const x = lerp(sx, tx, b) - dy * bow;
      const y = lerp(sy, ty, b) + dx * bow;
      const a = smooth(300, 700, t) * (1 - smooth(1500, 1850, t)) * (0.55 + 0.45 * Math.sin(t * 0.012 + m.ph));
      drawSprite(ctx, sprites.green, x, y, m.size * 4 * (u / 360 + 0.4), a);
      drawSprite(ctx, sprites.white, x, y, m.size * 1.4, a * 0.7);
    }
  }

  function drawShock(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number, s: number): void {
    ctx.globalCompositeOperation = 'lighter';
    const flash = Math.exp(-Math.max(0, t - BURST_AT) / 160) * smooth(BURST_AT - 60, BURST_AT + 20, t);
    if (flash > 0.01) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, u * 2.4);
      g.addColorStop(0, 'rgba(235,255,240,1)');
      g.addColorStop(0.2, rgba(arc, 0.65));
      g.addColorStop(0.6, rgba(deep, 0.25));
      g.addColorStop(1, rgba(deep, 0));
      ctx.fillStyle = g;
      ctx.globalAlpha = flash;
      ctx.fillRect(0, 0, w, h);
    }
    const waves = [
      { at: BURST_AT, reach: u * 3.1, half: 0.2 }, { at: BURST_AT + 140, reach: u * 2.5, half: 0.15 },
      { at: BURST_AT + 300, reach: u * 1.9, half: 0.11 },
    ];
    for (const wave of waves) {
      const k = (t - wave.at) / 1200;
      if (k <= 0 || k >= 1) continue;
      const r = lerp(s * 0.85, wave.reach, easeOutCubic(k));
      const env = smooth(0, 0.06, k) * (1 - k) ** 1.4;
      band(ctx, cx, cy, r, wave.half * u * (1.1 - k * 0.5), arc, core, env * 0.8);
    }
    // Anamorphic flare as the title lands.
    const land = t - SLAM_AT - SLAM_MS;
    if (land > -30) {
      const fa = Math.exp(-Math.max(0, land) / 230) * smooth(-30, 20, land);
      if (fa > 0.01) {
        const fy = titleCy - u * 0.02;
        const fg = ctx.createLinearGradient(0, 0, w, 0);
        fg.addColorStop(0, rgba(arc, 0));
        fg.addColorStop(0.5, rgba(core, 1));
        fg.addColorStop(1, rgba(arc, 0));
        ctx.fillStyle = fg;
        ctx.globalAlpha = fa;
        ctx.fillRect(0, fy - 1.5, w, 3);
        ctx.globalAlpha = fa * 0.22;
        ctx.fillRect(0, fy - u * 0.05, w, u * 0.1);
      }
    }
    for (const sp of sparksOut) {
      const age = t - BURST_AT;
      if (age < 0 || age > sp.life) continue;
      const k = age / 1000;
      const dist = (1 - Math.exp(-3 * k)) * sp.sp * u * 0.9;
      const life = 1 - age / sp.life;
      drawSprite(ctx, sprites.green, cx + Math.cos(sp.a) * (s * 0.5 + dist), cy + Math.sin(sp.a) * (s * 0.5 + dist) + k * k * u * 0.25,
        sp.size * 3.6 * (u / 360 + 0.4), life * life);
    }
  }

  function drawTitle(ctx: CanvasRenderingContext2D, t: number): void {
    if (titleArt === null || work === null) return;
    const k = ramp(SLAM_AT, SLAM_AT + SLAM_MS, t);
    if (k <= 0) return;
    const g = work.getContext('2d');
    if (g === null) return;
    const tw = work.width;
    const th = work.height;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, tw, th);
    g.drawImage(titleArt, 0, 0);
    // Cold light running over the metal.
    const sweep = ramp(SLAM_AT + 500, SLAM_AT + 1300, t);
    if (sweep > 0 && sweep < 1) {
      const x = lerp(-0.2, 1.2, easeInOutCubic(sweep)) * tw;
      const band = g.createLinearGradient(x - tw * 0.06, 0, x + tw * 0.06, 0);
      band.addColorStop(0, 'rgba(180,255,205,0)');
      band.addColorStop(0.5, 'rgba(210,255,225,0.85)');
      band.addColorStop(1, 'rgba(180,255,205,0)');
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = band;
      g.fillRect(0, 0, tw, th);
      g.globalCompositeOperation = 'source-over';
    }
    const scale = lerp(1.38, 1, easeOutExpo(k));
    const flashHeat = smooth(SLAM_AT + SLAM_MS - 20, SLAM_AT + SLAM_MS + 40, t) * (1 - smooth(SLAM_AT + SLAM_MS + 40, SLAM_AT + SLAM_MS + 420, t));
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = smooth(SLAM_AT, SLAM_AT + 110, t);
    ctx.save();
    ctx.translate(w / 2, titleCy);
    ctx.scale(scale, scale);
    ctx.drawImage(work, -tw / 2, -th / 2);
    if (flashHeat > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = flashHeat * 0.6;
      ctx.drawImage(work, -tw / 2, -th / 2);
    }
    ctx.restore();
  }

  function draw(ctx: CanvasRenderingContext2D, t: number): void {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#010302';
    ctx.fillRect(0, 0, w, h);
    const kb = (t - BURST_AT) / 1000;
    const ks = (t - SLAM_AT - SLAM_MS) / 1000;
    const shake = (kb > 0 ? Math.exp(-kb * 6) * 0.02 : 0) + (ks > 0 ? Math.exp(-ks * 8) * 0.011 : 0);
    ctx.save();
    ctx.translate(Math.sin(t * 0.097) * shake * u, Math.cos(t * 0.121) * shake * u * 0.7);
    const zoom = 1.05 - 0.05 * easeOutCubic(ramp(0, 3600, t));
    ctx.translate(w / 2, h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2, -h / 2);
    if (bg !== null) ctx.drawImage(bg, 0, 0, w, h);
    const m = maskTransform(t);
    // Green light pooling behind the mask as it forms.
    ctx.globalCompositeOperation = 'lighter';
    drawSprite(ctx, sprites.deep, m.cx, m.cy, u * 3.4, smooth(300, 1700, t) * (0.7 + 0.2 * Math.sin(t * 0.004)));
    drawMotes(ctx, t, m.cx, m.cy, m.s);
    drawRunes(ctx, t, m.cx, m.cy, m.s);
    ctx.save();
    ctx.translate(m.cx, m.cy);
    ctx.scale(m.s, m.s);
    drawMask(ctx, t);
    ctx.restore();
    drawArcs(ctx, t, m.cx, m.cy, m.s);
    drawShock(ctx, t, m.cx, m.cy, m.s);
    drawTitle(ctx, t);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    vignette(ctx, w, h, 0.78);
    const bar = h * 0.055 * easeOutCubic(ramp(0, 600, t));
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
    const fade = 1 - smooth(0, 450, t);
    if (fade > 0.002) {
      ctx.globalAlpha = clamp01(fade);
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  return { resize, draw };
}
