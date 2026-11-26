/**
 * Hunger Games intro: embers rise and swirl, sparks gather into a golden ring
 * and a bird with spread wings, the pin bursts into flame-coloured light, and
 * the title settles in gold serif. A procedural Mockingjay-pin feel, no logo art.
 */
import {
  type IntroScene,
  type Pt,
  type SceneOptions,
  TAU,
  clamp01,
  cloudSprite,
  cubic,
  drawSprite,
  easeInOutCubic,
  easeOutCubic,
  fillTracked,
  fitLines,
  glowSprite,
  hexRgb,
  lerp,
  makeCanvas,
  mix,
  polyPath,
  ramp,
  rgba,
  rng,
  smooth,
  vignette,
} from './common';

const RING_R = 0.82;
const BURST_AT = 2050;
const TITLE_AT = 2250;

interface Bird {
  /** Closed or open outlines in unit space, used for the draw-on stroke. */
  strokes: { points: Pt[]; closed: boolean; length: number }[];
  /** Filled shapes. */
  fills: Pt[][];
  /** Evenly spaced points on every outline, where sparks land. */
  samples: Pt[];
}

const mirror = (points: Pt[]): Pt[] => points.map(([x, y]): Pt => [-x, y]);

function pathLength(points: Pt[], closed: boolean): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Pt;
    const b = points[i] as Pt;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (closed && points.length > 1) {
    const a = points[points.length - 1] as Pt;
    const b = points[0] as Pt;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

function densify(points: Pt[], closed: boolean, spacing: number): Pt[] {
  const out: Pt[] = [];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i += 1) {
    const a = points[i] as Pt;
    const b = points[(i + 1) % points.length] as Pt;
    const steps = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing));
    for (let s = 0; s < steps; s += 1) out.push([lerp(a[0], b[0], s / steps), lerp(a[1], b[1], s / steps)]);
  }
  return out;
}

/** One feather: a slim leaf shape from `root` out along `angle`, bowed slightly downward. */
function feather(root: Pt, angle: number, length: number, width: number, bow = 0.1): Pt[] {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const at = (along: number, side: number): Pt => {
    const curve = bow * length * along * along;
    return [
      root[0] + ca * along * length - sa * (side + curve),
      root[1] + sa * along * length + ca * (side + curve),
    ];
  };
  const out: Pt[] = [at(0, 0)];
  const prof = (k: number): number => width * Math.sin(Math.PI * Math.min(1, k * 0.9 + 0.08)) ** 0.8;
  for (let i = 1; i <= 8; i += 1) out.push(at(i / 9, -prof(i / 9) / 2));
  out.push(at(1, 0));
  for (let i = 8; i >= 1; i -= 1) out.push(at(i / 9, prof(i / 9) / 2));
  return out;
}

export function buildBird(): Bird {
  const deg = Math.PI / 180;
  const pivot: Pt = [0.08, -0.14];
  // A fan of primaries sweeping from the leading edge down toward the body.
  const fan: [number, number, number][] = [
    [-52, 1.0, 0.12], [-36, 1.14, 0.125], [-20, 1.14, 0.125], [-5, 1.06, 0.12], [10, 0.94, 0.115], [25, 0.8, 0.11], [41, 0.64, 0.105], [58, 0.46, 0.1],
  ];
  const wingR = fan.map(([a, l, wd]) => feather(pivot, a * deg, l, wd, 0.16));
  const wingL = wingR.map(mirror);
  // Coverts: the smooth rounded shoulder over the feather roots.
  const cover: Pt[] = [[0.0, -0.2], ...cubic([0.0, -0.2], [0.18, -0.46], [0.48, -0.52], [0.66, -0.34], 10),
    ...cubic([0.66, -0.34], [0.58, -0.2], [0.4, -0.08], [0.2, 0.0], 8), [0.0, 0.04]];
  const bodyRight: Pt[] = [[0.06, -0.27], [0.1, -0.12], [0.105, 0.06], [0.08, 0.26], [0.04, 0.38]];
  const body: Pt[] = [...bodyRight, [0, 0.42], ...mirror(bodyRight).reverse()];
  const tail = ([[90, 0.62, 0.1], [72, 0.56, 0.095], [108, 0.56, 0.095], [56, 0.4, 0.085], [124, 0.4, 0.085]] as const)
    .map(([a, l, wd]) => feather([0, 0.32], a * deg, l, wd, 0));
  const head: Pt[] = [];
  for (let i = 0; i < 20; i += 1) head.push([Math.cos((i / 20) * TAU) * 0.085, -0.34 + Math.sin((i / 20) * TAU) * 0.085]);
  const beak: Pt[] = [[-0.03, -0.405], [0.0, -0.6], [0.03, -0.405]];
  const crest: Pt[] = [[-0.01, -0.41], [-0.1, -0.52], [-0.03, -0.43]];

  const shapes: Pt[][] = [...tail, ...wingR, ...wingL, mirror(cover), cover, body, head, beak, crest];
  const strokes = shapes.map((points) => ({ points, closed: true, length: pathLength(points, true) }));
  const samples = strokes.flatMap((s) => densify(s.points, s.closed, 0.034));
  return { strokes, fills: shapes, samples };
}

const BIRD = buildBird();

interface Spark {
  x0: number; y0: number; vy: number; ph: number; fr: number; swirl: number; size: number;
  start: number; dur: number; target: Pt; curve: number; gold: boolean;
}

interface Ember {
  angle: number; speed: number; life: number; size: number; rise: number; drag: number; gold: boolean; ph: number;
}

export function createMockingjayScene(opts: SceneOptions): IntroScene {
  const accent = hexRgb(opts.accent);
  const flame = hexRgb(opts.glow);
  const hot = mix(accent, [255, 244, 214], 0.7);
  const sprites = {
    ember: glowSprite(flame, 64, 0.6),
    gold: glowSprite(accent, 64, 0.65),
    white: glowSprite([255, 236, 190], 64, 0.9),
    smoke: cloudSprite(mix(flame, [60, 30, 20], 0.55), 256),
  };

  let w = 0;
  let h = 0;
  let u = 0;
  let q = 1;
  let bg: HTMLCanvasElement | null = null;
  let titleArt: HTMLCanvasElement | null = null;
  let work: HTMLCanvasElement | null = null;
  let titleCy = 0;
  let sparks: Spark[] = [];
  let embers: Ember[] = [];
  let smokes: { x: number; y: number; s: number; ph: number }[] = [];

  function buildBackground(): void {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    if (g === null) return;
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#050202');
    base.addColorStop(0.55, '#0d0504');
    base.addColorStop(1, '#1d0b05');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const heat = g.createRadialGradient(w / 2, h * 1.08, 0, w / 2, h * 1.08, Math.max(w, h) * 0.62);
    heat.addColorStop(0, rgba(flame, 0.42));
    heat.addColorStop(0.35, rgba(flame, 0.12));
    heat.addColorStop(1, rgba(flame, 0));
    g.fillStyle = heat;
    g.fillRect(0, 0, w, h);
    const rand = rng(11);
    g.fillStyle = 'rgba(255,214,160,0.035)';
    for (let i = 0; i < Math.round((w * h) / 900); i += 1) g.fillRect(rand() * w, rand() * h, 1.2, 1.2);
    bg = c;
  }

  function buildTitle(): void {
    const parts = opts.title.trim();
    const wrap = makeCanvas(w, Math.max(120, u * 0.9));
    const g = wrap.getContext('2d');
    if (g === null) return;
    const serif = (px: number): string =>
      `700 ${px}px Cinzel, "Trajan Pro", "Palatino Linotype", "Book Antiqua", Georgia, "Times New Roman", serif`;
    const maxW = Math.min(w * 0.86, u * 3.1);
    const main = fitLines(g, 'THE HUNGER GAMES', serif, u * 0.3, maxW, 1, (px) => px * 0.16);
    const tracking = main.px * 0.16;
    const cx = w / 2;
    const baseY = wrap.height * 0.42;
    g.font = serif(main.px);
    g.textBaseline = 'alphabetic';
    // Warm underglow, then the gold face.
    g.shadowColor = rgba(flame, 0.8);
    g.shadowBlur = main.px * 0.35;
    g.fillStyle = rgba(flame, 0.9);
    fillTracked(g, main.lines[0] ?? '', cx, baseY, tracking);
    g.shadowBlur = 0;
    const face = g.createLinearGradient(0, baseY - main.px * 0.75, 0, baseY + main.px * 0.06);
    face.addColorStop(0, '#fff7d6');
    face.addColorStop(0.4, rgba(mix(accent, [255, 236, 170], 0.5), 1));
    face.addColorStop(0.58, rgba(accent, 1));
    face.addColorStop(0.62, rgba(mix(accent, [120, 55, 0], 0.4), 1));
    face.addColorStop(1, rgba(mix(accent, [150, 70, 10], 0.45), 1));
    g.fillStyle = face;
    g.strokeStyle = 'rgba(40,14,0,0.85)';
    g.lineWidth = Math.max(1, main.px * 0.018);
    fillTracked(g, main.lines[0] ?? '', cx, baseY, tracking, true);
    fillTracked(g, main.lines[0] ?? '', cx, baseY, tracking);

    // A fine rule with a diamond, then the subtitle.
    const ruleY = baseY + main.px * 0.34;
    const half = Math.min(maxW * 0.5, measureHalf(g, main.lines[0] ?? '', tracking));
    const rule = g.createLinearGradient(cx - half, 0, cx + half, 0);
    rule.addColorStop(0, rgba(accent, 0));
    rule.addColorStop(0.2, rgba(accent, 0.9));
    rule.addColorStop(0.8, rgba(accent, 0.9));
    rule.addColorStop(1, rgba(accent, 0));
    g.fillStyle = rule;
    g.fillRect(cx - half, ruleY - 0.75, half * 2, 1.5);
    g.fillStyle = rgba(hot, 1);
    g.beginPath();
    const d = main.px * 0.07;
    g.moveTo(cx, ruleY - d);
    g.lineTo(cx + d, ruleY);
    g.lineTo(cx, ruleY + d);
    g.lineTo(cx - d, ruleY);
    g.closePath();
    g.fill();
    if (parts !== '') {
      const sub = fitLines(g, parts.toUpperCase(), (px) => `600 ${px}px Geist, "Segoe UI", sans-serif`, main.px * 0.4, maxW, 2,
        (px) => px * 0.32);
      g.font = `600 ${sub.px}px Geist, "Segoe UI", sans-serif`;
      g.fillStyle = rgba(mix(accent, [255, 238, 200], 0.55), 0.96);
      g.shadowColor = rgba(flame, 0.7);
      g.shadowBlur = sub.px * 0.5;
      sub.lines.forEach((line, i) => fillTracked(g, line, cx, ruleY + main.px * 0.2 + sub.px * (1.15 + i * 1.3), sub.px * 0.32));
      g.shadowBlur = 0;
    }
    titleArt = wrap;
    work = makeCanvas(wrap.width, wrap.height);
  }

  function measureHalf(g: CanvasRenderingContext2D, text: string, tracking: number): number {
    let total = 0;
    for (const ch of text) total += g.measureText(ch).width + tracking;
    return total / 2;
  }

  function buildParticles(): void {
    const rand = rng(2026);
    const count = Math.round(260 * q);
    sparks = [];
    for (let i = 0; i < count; i += 1) {
      const onRing = rand() < 0.5;
      let target: Pt;
      if (onRing) {
        const a = rand() * TAU;
        const r = RING_R + (rand() - 0.5) * 0.035;
        target = [Math.cos(a) * r, Math.sin(a) * r];
      } else {
        target = (BIRD.samples[Math.floor(rand() * BIRD.samples.length)] as Pt);
      }
      sparks.push({
        x0: rand(), y0: rand(), vy: 0.1 + rand() * 0.3, ph: rand() * TAU, fr: 0.0008 + rand() * 0.0016,
        swirl: 0.05 + rand() * 0.16, size: 2 + rand() * 4.5, start: 650 + rand() * 850, dur: 750 + rand() * 450,
        target, curve: (rand() - 0.5) * 0.9, gold: rand() < 0.45,
      });
    }
    embers = [];
    const burst = Math.round(150 * q);
    for (let i = 0; i < burst; i += 1) {
      embers.push({
        angle: rand() * TAU, speed: 0.25 + rand() * 1.35, life: 900 + rand() * 1100, size: 2 + rand() * 6,
        rise: 0.05 + rand() * 0.25, drag: 1.6 + rand() * 2.2, gold: rand() < 0.5, ph: rand() * TAU,
      });
    }
    smokes = [];
    for (let i = 0; i < 6; i += 1) smokes.push({ x: rand(), y: 0.55 + rand() * 0.5, s: 0.8 + rand() * 1.1, ph: rand() * TAU });
  }

  function resize(width: number, height: number): void {
    w = Math.max(2, width);
    h = Math.max(2, height);
    u = Math.min(w, h) * 0.5;
    q = Math.max(0.45, Math.min(1, (w * h) / (1280 * 720)));
    titleCy = h * (h > w ? 0.66 : 0.69);
    buildBackground();
    buildTitle();
    buildParticles();
  }

  function pinTransform(t: number): { cx: number; cy: number; s: number } {
    const move = easeInOutCubic(ramp(BURST_AT + 150, BURST_AT + 950, t));
    const breathe = 1 + Math.sin(t * 0.0021) * 0.006 * smooth(1800, 2400, t);
    const compact = h > w ? 0.78 : 0.62;
    return {
      cx: w / 2,
      cy: lerp(h * 0.5, h > w ? h * 0.36 : h * 0.37, move),
      s: u * lerp(compact + 0.06, compact * 0.78, move) * breathe,
    };
  }

  function drawOutline(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number, s: number): void {
    const prog = easeOutCubic(ramp(950, 2000, t));
    if (prog <= 0) return;
    const fillA = smooth(1600, 2150, t);
    const flash = 1 + Math.max(0, 1 - Math.abs(t - BURST_AT) / 260) * 1.6;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'source-over';
    // Soft gold body behind the lines.
    if (fillA > 0) {
      const body = ctx.createLinearGradient(0, -0.7, 0, 0.9);
      body.addColorStop(0, rgba(mix(accent, [255, 246, 214], 0.65), 1));
      body.addColorStop(0.45, rgba(accent, 1));
      body.addColorStop(1, rgba(mix(flame, [90, 25, 0], 0.4), 1));
      ctx.fillStyle = body;
      ctx.globalAlpha = Math.min(1, fillA * 0.62 * flash);
      for (const shape of BIRD.fills) ctx.fill(polyPath(shape));
      // Inner feather lines carved into the wings.
      ctx.globalAlpha = fillA * 0.55;
      ctx.strokeStyle = 'rgba(70,24,0,0.8)';
      ctx.lineWidth = 0.011;
      ctx.beginPath();
      for (const side of [1, -1]) {
        for (const [x0, y0, x1, y1] of [[0.12, -0.12, 0.9, -0.2], [0.14, -0.06, 0.84, 0.0], [0.16, 0.02, 0.66, 0.13], [0.18, 0.1, 0.46, 0.23]] as const) {
          ctx.moveTo(x0 * side, y0);
          ctx.lineTo(x1 * side, y1);
        }
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const pass of [{ lw: 0.075, a: 0.1 }, { lw: 0.035, a: 0.2 }, { lw: 0.012, a: 0.9 }]) {
      ctx.strokeStyle = pass.lw > 0.02 ? rgba(flame, 1) : rgba(hot, 1);
      ctx.lineWidth = pass.lw;
      ctx.globalAlpha = Math.min(1, pass.a * flash);
      for (const st of BIRD.strokes) {
        ctx.setLineDash([st.length * prog + 0.0001, st.length * 3]);
        ctx.stroke(polyPath(st.points, st.closed));
      }
      ctx.setLineDash([]);
      // The ring draws round once, clockwise from the top.
      ctx.beginPath();
      ctx.arc(0, 0, RING_R, -Math.PI / 2, -Math.PI / 2 + TAU * smooth(850, 1800, t) + 0.0001);
      ctx.lineWidth = pass.lw * 2;
      ctx.stroke();
    }
    // Thin inner ring and arrow-fletch ticks of the pin.
    const inner = smooth(1500, 2100, t);
    if (inner > 0) {
      ctx.globalAlpha = inner * 0.7;
      ctx.strokeStyle = rgba(hot, 1);
      ctx.lineWidth = 0.008;
      ctx.beginPath();
      ctx.arc(0, 0, RING_R - 0.065, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 48; i += 1) {
        const a = (i / 48) * TAU;
        ctx.moveTo(Math.cos(a) * (RING_R + 0.045), Math.sin(a) * (RING_R + 0.045));
        ctx.lineTo(Math.cos(a) * (RING_R + (i % 4 === 0 ? 0.1 : 0.07)), Math.sin(a) * (RING_R + (i % 4 === 0 ? 0.1 : 0.07)));
      }
      ctx.lineWidth = 0.006;
      ctx.globalAlpha = inner * 0.55;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSparks(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number, s: number): void {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of sparks) {
      const b = easeInOutCubic(ramp(p.start, p.start + p.dur, t));
      // Free-floating position: rises with a slow vortex around its own centre.
      const rise = t * p.vy * u * 0.001;
      const bx = (p.x0 - 0.5) * w * 0.95 + w / 2;
      const by = h * (0.5 + p.y0 * 0.62) - rise;
      const sx = bx + Math.cos(t * p.fr + p.ph) * p.swirl * u;
      const sy = by + Math.sin(t * p.fr * 1.3 + p.ph) * p.swirl * u * 0.7;
      const tx = cx + p.target[0] * s;
      const ty = cy + p.target[1] * s;
      // Arrive along a curve, not a straight line.
      const dx = tx - sx;
      const dy = ty - sy;
      const bow = Math.sin(b * Math.PI) * p.curve;
      let x = lerp(sx, tx, b) - dy * bow;
      let y = lerp(sy, ty, b) + dx * bow;
      if (t > BURST_AT - 80) {
        x = tx;
        y = ty;
      }
      const edge = smooth(0, 500, t);
      const flick = 0.62 + 0.38 * Math.sin(t * 0.013 * (0.6 + p.fr * 500) + p.ph);
      const land = t > p.start + p.dur ? 1 - smooth(BURST_AT - 120, BURST_AT + 160, t) : 1;
      const a = edge * flick * land * (0.85 - 0.1 * b);
      if (a <= 0.01) continue;
      if (y < -20 || y > h + 20) continue;
      const sprite = p.gold ? sprites.gold : sprites.ember;
      const size = p.size * (1 + b * 0.9) * (u / 360 + 0.4);
      // A short trail while it travels.
      if (b > 0.02 && b < 0.98) {
        const k = 0.045;
        const bp = easeInOutCubic(clamp01(ramp(p.start, p.start + p.dur, t) - k));
        const px = lerp(sx, tx, bp) - dy * Math.sin(bp * Math.PI) * p.curve;
        const py = lerp(sy, ty, bp) + dx * Math.sin(bp * Math.PI) * p.curve;
        drawSprite(ctx, sprite, px, py, size * 3.4, a * 0.45);
      }
      drawSprite(ctx, sprite, x, y, size * 3.2, a);
      drawSprite(ctx, sprites.white, x, y, size * 1.3, a * 0.9);
    }
  }

  function drawBurst(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number, s: number): void {
    const k = (t - BURST_AT) / 1000;
    if (k < -0.02) return;
    ctx.globalCompositeOperation = 'lighter';
    // Light spokes.
    const env = smooth(BURST_AT - 60, BURST_AT + 160, t) * (1 - smooth(BURST_AT + 250, BURST_AT + 1000, t) * 0.9);
    if (env > 0.01) {
      const reach = u * (2.6 + k * 0.6);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
      g.addColorStop(0, rgba([255, 236, 190], 0.5));
      g.addColorStop(0.35, rgba(flame, 0.2));
      g.addColorStop(1, rgba(flame, 0));
      ctx.fillStyle = g;
      ctx.globalAlpha = env;
      ctx.beginPath();
      const spokes = 18;
      const spin = t * 0.00016;
      for (let i = 0; i < spokes; i += 1) {
        const a = (i / spokes) * TAU + spin;
        const wdt = 0.018 + (i % 3) * 0.012;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a - wdt) * reach, cy + Math.sin(a - wdt) * reach);
        ctx.lineTo(cx + Math.cos(a + wdt) * reach, cy + Math.sin(a + wdt) * reach);
        ctx.closePath();
      }
      ctx.fill();
    }
    // The flash itself.
    const flashA = Math.exp(-Math.max(0, k) * 5.5) * smooth(BURST_AT - 90, BURST_AT + 30, t);
    if (flashA > 0.01) {
      const r = u * (1.2 + k * 2);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255,248,226,1)');
      g.addColorStop(0.25, rgba(mix(accent, [255, 214, 140], 0.4), 0.75));
      g.addColorStop(0.6, rgba(flame, 0.3));
      g.addColorStop(1, rgba(flame, 0));
      ctx.fillStyle = g;
      ctx.globalAlpha = Math.min(1, flashA);
      ctx.fillRect(0, 0, w, h);
    }
    // Shock rings.
    for (let i = 0; i < 2; i += 1) {
      const kk = k - i * 0.14;
      if (kk <= 0 || kk > 1.1) continue;
      const rr = s * RING_R + easeOutCubic(kk / 1.1) * u * 2.5;
      const fall = Math.max(0, 1 - kk / 1.05);
      ctx.strokeStyle = rgba(flame, 1);
      ctx.globalAlpha = fall * (i === 0 ? 0.3 : 0.18);
      ctx.lineWidth = Math.max(1, 34 * (1 - kk / 1.1));
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = rgba(mix(accent, [255, 225, 160], 0.5), 1);
      ctx.globalAlpha = fall * (i === 0 ? 0.8 : 0.45);
      ctx.lineWidth = Math.max(0.5, (i === 0 ? 4 : 7) * (1 - kk / 1.1));
      ctx.stroke();
    }
    // Embers thrown out of the pin.
    for (const e of embers) {
      const age = t - BURST_AT;
      if (age < 0 || age > e.life) continue;
      const kk = age / 1000;
      const dist = ((1 - Math.exp(-e.drag * kk)) / e.drag) * e.speed * u * 1.6;
      const x = cx + Math.cos(e.angle) * (s * RING_R + dist);
      const y = cy + Math.sin(e.angle) * (s * RING_R * 0.98 + dist) - e.rise * u * kk * kk * 1.4;
      const life = 1 - age / e.life;
      const a = life * life * (0.6 + 0.4 * Math.sin(t * 0.02 + e.ph));
      const sprite = e.gold ? sprites.gold : sprites.ember;
      drawSprite(ctx, sprite, x, y, e.size * 3.4 * (0.4 + life) * (u / 360 + 0.4), a);
    }
  }

  function drawTitle(ctx: CanvasRenderingContext2D, t: number): void {
    if (titleArt === null || work === null) return;
    const wipe = easeOutCubic(ramp(TITLE_AT, TITLE_AT + 900, t));
    if (wipe <= 0) return;
    const g = work.getContext('2d');
    if (g === null) return;
    const tw = work.width;
    const th = work.height;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, tw, th);
    g.drawImage(titleArt, 0, 0);
    // Soft-edged reveal that opens from the middle outwards.
    const half = (tw / 2) * (0.04 + wipe * 1.1);
    const edge = Math.max(30, tw * 0.1);
    const mask = g.createLinearGradient(tw / 2 - half - edge, 0, tw / 2 + half + edge, 0);
    const lo = clamp01(edge / (half * 2 + edge * 2));
    mask.addColorStop(0, 'rgba(0,0,0,0)');
    mask.addColorStop(lo, 'rgba(0,0,0,1)');
    mask.addColorStop(1 - lo, 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = mask;
    g.fillRect(0, 0, tw, th);
    // One slow glint across the gold.
    const sweep = ramp(TITLE_AT + 650, TITLE_AT + 1500, t);
    if (sweep > 0 && sweep < 1) {
      const x = lerp(-0.15, 1.15, easeInOutCubic(sweep)) * tw;
      const band = g.createLinearGradient(x - tw * 0.07, 0, x + tw * 0.07, 0);
      band.addColorStop(0, 'rgba(255,248,225,0)');
      band.addColorStop(0.5, 'rgba(255,248,225,0.9)');
      band.addColorStop(1, 'rgba(255,248,225,0)');
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = band;
      g.fillRect(0, 0, tw, th);
    }
    g.globalCompositeOperation = 'source-over';
    const settle = 1 + (1 - easeOutCubic(ramp(TITLE_AT, TITLE_AT + 1300, t))) * 0.045;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = smooth(TITLE_AT, TITLE_AT + 350, t);
    ctx.save();
    ctx.translate(w / 2, titleCy);
    ctx.scale(settle, settle);
    ctx.drawImage(work, -tw / 2, -th * 0.42);
    ctx.restore();
  }

  function draw(ctx: CanvasRenderingContext2D, t: number): void {
    ctx.setTransform(ctx.getTransform());
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#030101';
    ctx.fillRect(0, 0, w, h);
    const k = (t - BURST_AT) / 1000;
    const shake = k > 0 ? Math.exp(-k * 6) * (u * 0.018) : 0;
    ctx.save();
    ctx.translate(Math.sin(t * 0.093) * shake, Math.cos(t * 0.117) * shake * 0.7);
    const zoom = 1.045 - 0.045 * easeOutCubic(ramp(0, 3600, t));
    ctx.translate(w / 2, h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2, -h / 2);
    if (bg !== null) ctx.drawImage(bg, 0, 0, w, h);
    // Ambient heat that breathes with the fire.
    ctx.globalCompositeOperation = 'lighter';
    for (const sm of smokes) {
      const x = sm.x * w + Math.sin(t * 0.0004 + sm.ph) * u * 0.3;
      const y = sm.y * h - t * 0.012 * sm.s;
      drawSprite(ctx, sprites.smoke, x, y, u * 2.1 * sm.s, 0.26 * smooth(0, 900, t));
    }
    const pin = pinTransform(t);
    drawSparks(ctx, t, pin.cx, pin.cy, pin.s);
    drawOutline(ctx, t, pin.cx, pin.cy, pin.s);
    drawBurst(ctx, t, pin.cx, pin.cy, pin.s);
    drawTitle(ctx, t);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    vignette(ctx, w, h, 0.7);
    // Slim letterbox bars slide in, and the whole frame comes up from black.
    const bar = h * 0.055 * easeOutCubic(ramp(0, 600, t));
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
    const fade = 1 - smooth(0, 450, t);
    if (fade > 0.002) {
      ctx.globalAlpha = fade;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  return { resize, draw };
}
