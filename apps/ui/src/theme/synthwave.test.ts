import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MARK_ARCH,
  MARK_CRESCENT,
  MARK_DOME,
  MARK_EYE,
  MARK_LENS,
  MARK_PEANUT,
  MARK_PETAL,
  MARK_STADIUM,
  MARK_SUN,
  MARK_TALL,
  MARK_TEAR,
  MARK_WIDE,
  SINE_A,
  SINE_B,
  SINE_C,
  SINE_FLAT,
} from './SynthwaveCrt';

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, 'synthwave.css'), 'utf8');
const crt = readFileSync(join(dir, 'SynthwaveCrt.tsx'), 'utf8');
const app = readFileSync(join(dir, '..', 'App.tsx'), 'utf8');
const applySrc = readFileSync(join(dir, 'apply.ts'), 'utf8');

function cubicCount(path: string): number {
  return (path.match(/ C /g) ?? []).length;
}

describe('Colourcast aesthetic pack', () => {
  it('is a full CRT night skin, not a recolor', () => {
    expect(css).toContain("[data-theme='synthwave']");
    expect(css).toContain('Righteous');
    expect(css).toContain('repeating-linear-gradient');
    expect(css).toContain('--tvm-sw-grade');
    expect(css).toContain('.poster__art img');
    expect(css).not.toMatch(/\.player-root[^{]*\{[^}]*background:\s*(#000|#000000|black)\b/i);
    expect(css).toContain(":has([data-screen='player'])");
    expect(css).not.toContain('hue-rotate');
    expect(css).not.toMatch(/\.sw-crt__stage[^{]*\{[^}]*filter:/);
  });

  it('plays one analog ident of curves, not sliding gables or a cartoon city', () => {
    expect(app).toContain('SynthwaveCrt');
    expect(crt).toContain('sw-ident__ring');
    expect(crt).toContain('sw-ident__bow');
    expect(crt).toContain('sw-ident__sine');
    expect(crt).toContain('sw-ident__mark');
    expect(crt).toContain('sw-ident__pulse');
    expect(crt).toContain('sw-crt__burst');
    expect(crt).not.toContain('sw-id--gables');
    expect(crt).not.toContain('sw-id--street');
    expect(crt).not.toContain('sw-crt__car');
    expect(crt).not.toContain('sw-crt__grid');
    expect(css).toContain('mask-image');
    expect(css).toContain('repeating-conic-gradient');
    expect(css).toContain('stroke-linecap: round');
    expect(css).not.toContain('rotateY(26deg)');
    expect(css).not.toContain('rotateY(-8deg)');
    expect(css).not.toContain('perspective(');
    expect(css).toContain('z-index: 0');
    expect(css).not.toContain('z-index: 50');
    expect(css).not.toContain('mix-blend-mode');
    expect(css).toContain('.stage__pictures');
    expect(css).toContain('display: none');
    expect(css).toContain('.ribbon__glyph');
    expect(css).toContain('image-rendering: pixelated');
    expect(css).not.toContain('border-left-width: 0.82rem');
    expect(css).not.toContain('#2c2c2c 0 4px');
    expect(css).not.toContain('left: 0.72rem');
    expect(css).toContain('@keyframes tvm-sw-wave');
    expect(css).toContain('@keyframes tvm-sw-form-rise');
    expect(css).toContain('@keyframes tvm-sw-hold-glow');
    expect(css).toContain('@keyframes tvm-sw-scan-drift');
    expect(css).toContain('@keyframes tvm-sw-ident-life');
    expect(css).toContain('@keyframes tvm-sw-beam');
    expect(css).toContain('@keyframes tvm-sw-flyback');
    expect(css).toContain('@keyframes tvm-sw-lock');
    expect(css).toContain('@keyframes tvm-sw-sheen');
    expect(css).toContain('@keyframes tvm-sw-raster');
    expect(css).toContain('@keyframes tvm-sw-haze');
    expect(css).toContain('@keyframes tvm-sw-hand-h');
    expect(css).toContain('@keyframes tvm-sw-mark');
    expect(css).toContain('@keyframes tvm-sw-band');
    expect(css).toContain('@keyframes tvm-sw-radio');
    expect(css).toContain('@keyframes tvm-sw-bow');
    expect(css).toContain('@keyframes tvm-sw-core');
    expect(css).toContain('d: path(');
    expect(css).toContain('cubic-bezier(0.45, 0.05, 0.55, 0.95)');
    expect(crt).toContain('sw-id__beam');
    expect(crt).toContain('sw-id__lock');
    expect(crt).toContain('COLOUR');
    expect(crt).toContain('sw-id__hand');
    expect(crt).toContain('sw-crt__haze');
    expect(crt).toContain('sw-crt__raster');
    expect(crt).toContain('sw-morph__core');
    expect(crt).not.toContain('HOLD_MS');
    expect(crt).not.toContain('setInterval');
    expect(css).not.toContain('@keyframes tvm-sw-dolly');
    expect(css).not.toContain('@keyframes tvm-sw-car');
    expect(css).not.toContain('@keyframes tvm-sw-sweep');
    expect(css).toContain('z-index: 1');
    expect(css).toContain('background: transparent');
    expect(css).not.toContain('drop-shadow');
    expect(crt).toContain('sw-crt__flicker');
    expect(crt).toContain('sw-crt__mote');
    expect(crt).toContain('sw-crt__rainbow--foot');
    expect(crt).not.toContain('sw-ident__ring--halo');
    expect(crt).not.toContain('sw-ident__pulse--far');
    expect(crt).not.toContain('sw-ident__curve');
    expect(crt).not.toContain('sw-ident__sine--aux');
    expect(crt).not.toContain('sw-crt__iris');
    expect(crt).not.toContain('sw-ident__iris');
    expect(crt).not.toContain('sw-id__wipe');
    expect(crt).not.toContain('sw-id__bloom');
    expect(crt).not.toContain('sw-crt__haze--late');
    expect(css).toContain('@keyframes tvm-sw-mote');
    expect(css).toContain('@keyframes tvm-sw-rainbow-drift');
    expect(css).toContain('.home__shelf');
    expect(css).toContain('isolation: isolate');
    expect(css).toContain('contain: paint');
    expect(css).toContain('contain: strict');
    expect(css).toContain('will-change: transform');
    const art = readFileSync(join(dir, '..', 'components', 'Artwork.tsx'), 'utf8');
    expect(art).toContain('usePhosphorSrc');
  });

  it('keeps landmark and oscilloscope paths morphable (same cubic count)', () => {
    const marks = [
      MARK_SUN,
      MARK_DOME,
      MARK_WIDE,
      MARK_TALL,
      MARK_LENS,
      MARK_PETAL,
      MARK_CRESCENT,
      MARK_EYE,
      MARK_STADIUM,
      MARK_TEAR,
      MARK_PEANUT,
      MARK_ARCH,
    ];
    const cubics = cubicCount(marks[0]!);
    expect(cubics).toBeGreaterThanOrEqual(8);
    for (const path of marks) {
      expect(cubicCount(path)).toBe(cubics);
      expect(path.startsWith('M ')).toBe(true);
      expect(path.endsWith(' Z')).toBe(true);
      expect(css).toContain(`d: path('${path}')`);
    }
    const waves = [SINE_FLAT, SINE_A, SINE_B, SINE_C];
    const waveCubics = cubicCount(waves[0]!);
    expect(waveCubics).toBeGreaterThanOrEqual(8);
    for (const path of waves) {
      expect(cubicCount(path)).toBe(waveCubics);
      expect(path.startsWith('M ')).toBe(true);
    }
  });

  it('does not paint a sprocket spine bar on posters', () => {
    expect(css).not.toContain('border-left-width: 0.82rem');
    expect(css).not.toContain('border-left-color: #141414');
    expect(css).not.toContain('#101010 4px 7px');
    expect(css).not.toContain('transform-origin: left center');
    expect(css).toContain('opacity: 0.72');
    expect(css).toContain('opacity: 0.96');
  });

  it('keeps home shelves and rails transparent over the ident', () => {
    expect(css).toMatch(/html\[data-theme='synthwave'\] \.home[\s\S]*background: transparent/);
    expect(css).toMatch(/html\[data-theme='synthwave'\] \.home__shelf/);
    expect(css).toMatch(/html\[data-theme='synthwave'\] \.rail[\s\S]*background: transparent/);
    expect(css).toContain("html[data-theme='synthwave'] .rail:not(.rail--bare) .rail__track");
    expect(css).toContain('background-size: 100% 0.72rem');
    const lastShelf = css.lastIndexOf("html[data-theme='synthwave'] .home__shelf");
    const lastTrack = css.lastIndexOf("html[data-theme='synthwave'] .rail:not(.rail--bare) .rail__track");
    expect(lastShelf).toBeGreaterThan(css.indexOf('@keyframes tvm-sw-mark'));
    expect(lastTrack).toBeGreaterThan(lastShelf);
    const globAt = applySrc.indexOf("import.meta.glob('./glass/*.css'");
    const swAt = applySrc.lastIndexOf("import './synthwave.css'");
    expect(swAt).toBeGreaterThan(globAt);
  });
});
