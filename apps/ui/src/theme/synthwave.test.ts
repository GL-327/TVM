import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RETRO_CHANNELS } from './SynthwaveCrt';
import { themeName } from './registry';
import { ART_STYLE_BY_THEME, artStyleFor } from './usePhosphorSrc';

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, 'synthwave.css'), 'utf8');
const crt = readFileSync(join(dir, 'SynthwaveCrt.tsx'), 'utf8');
const app = readFileSync(join(dir, '..', 'App.tsx'), 'utf8');
const applySrc = readFileSync(join(dir, 'apply.ts'), 'utf8');

/** Every `@keyframes` block, so animated properties can be audited. */
function keyframeBlocks(source: string): string[] {
  return [...source.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)].map((match) => match[1] ?? '');
}

describe('Retro aesthetic pack', () => {
  it('is sold as Retro while keeping the stored theme id', () => {
    expect(themeName('synthwave')).toBe('Retro');
    expect(css).toContain("[data-theme='synthwave']");
    expect(crt).not.toContain('Colourcast');
    expect(crt).not.toContain('COLOUR');
  });

  it('reads as a 1970s/80s television set, not a modern neon skin', () => {
    expect(css).toContain('--tvm-rt-walnut');
    expect(css).toContain('--tvm-rt-gold');
    expect(css).toContain('--tvm-rt-orange');
    expect(css).toContain('Cooper Black');
    expect(css).toContain('--tvm-rt-scanlines');
    expect(css).toContain('--tvm-rt-bleed');
    expect(css).toContain('text-transform: uppercase');
    expect(css).not.toContain('hue-rotate');
    expect(css).not.toContain('backdrop-filter');
    expect(css).not.toContain('mix-blend-mode');
  });

  it('is always in motion: sunburst, ident rings, rainbow arc, scope trace, colour bars, tracking, VCR display', () => {
    expect(app).toContain('SynthwaveCrt');
    for (const layer of ['rt-set__burst', 'rt-set__sun', 'rt-set__horizon', 'rt-set__rings', 'rt-set__arc', 'rt-set__wave', 'rt-set__bars', 'rt-set__track', 'rt-set__flicker', 'rt-set__osd', 'rt-set__scan']) {
      expect(crt).toContain(layer);
    }
    for (const name of ['rt-power-on', 'rt-burst-spin', 'rt-sun-breathe', 'rt-horizon', 'rt-ring', 'rt-arc-sway', 'rt-wave', 'rt-bars-slide', 'rt-track', 'rt-flicker', 'rt-osd-cycle', 'rt-osd-blink']) {
      expect(css).toContain(`@keyframes ${name}`);
    }
    expect(css).toMatch(/\.rt-set__arc \{[\s\S]*?opacity: 0\.88/);
    expect(css).toMatch(/\.rt-set__wave \{[\s\S]*?opacity: 0\.86/);
    expect(css).toMatch(/rt-burst-spin 24s/);
    expect(css).toMatch(/rt-arc-sway 7\.5s/);
    expect(css).toMatch(/rt-wave 5s/);
    expect(css).toMatch(/rt-bars-slide 10s/);
    expect(RETRO_CHANNELS.length).toBeGreaterThanOrEqual(3);
    expect(crt).not.toContain('setInterval');
    expect(crt).not.toContain('requestAnimationFrame');
  });

  it('has no cabinet frame around the picture', () => {
    expect(crt).not.toContain('bezel');
    expect(css).not.toContain('bezel');
    expect(css).not.toContain('border-image');
  });

  it('shows posters as a faint mosaic, never the unreadable phosphor snap', () => {
    expect(artStyleFor('synthwave', 'poster', false)).toBe('mosaic');
    expect(artStyleFor('synthwave', 'logo', false)).toBe('mosaic');
    expect(artStyleFor('synthwave', 'backdrop', false)).toBeNull();
    expect(artStyleFor('default', 'poster', false)).toBeNull();
    expect(artStyleFor('synthwave', 'poster', true)).toBeNull();
    expect(artStyleFor('synthwave', 'logo', true)).toBeNull();
    expect(Object.values(ART_STYLE_BY_THEME)).not.toContain('phosphor');
    expect(css).toMatch(/html\[data-theme='synthwave'\] \.poster__art img[\s\S]*?image-rendering: pixelated/);
  });

  it('animates only transform and opacity so the D-pad camera stays smooth', () => {
    const blocks = keyframeBlocks(css);
    expect(blocks.length).toBeGreaterThanOrEqual(10);
    for (const block of blocks) {
      const properties = [...block.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
      expect(properties.length).toBeGreaterThan(0);
      for (const property of properties) expect(['transform', 'opacity']).toContain(property);
    }
    expect(css).toContain('will-change: transform');
    expect(css).not.toMatch(/\.rt-set__sun \{[^}]*will-change/);
    expect(css).not.toMatch(/\.rt-set__horizon \{[^}]*will-change/);
    expect(css).not.toMatch(/\.rt-set__arc \{[^}]*will-change/);
    expect(css).not.toMatch(/\.rt-set__rings i \{[^}]*will-change/);
    expect(css).toContain('contain: strict');
    expect(css).not.toContain('d: path(');
    expect(css).not.toContain('mask-image');
    expect(css).not.toContain('feGaussianBlur');
    expect(crt).not.toContain('<filter');
  });

  it('draws no stray bars: no rainbow strips or tape spines under rails', () => {
    expect(css).not.toContain('rainbow');
    expect(css).not.toContain('background-size: 100% 0.72rem');
    expect(css).toMatch(/html\[data-theme='synthwave'\] \.rail__track[\s\S]*?background: transparent/);
    expect(css).toMatch(/html\[data-theme='synthwave'\] \.home__shelf[\s\S]*?background: transparent/);
  });

  it('keeps text readable on the tube', () => {
    expect(css).toContain('--tvm-text: var(--tvm-rt-cream)');
    expect(css).toContain('--tvm-text-muted: var(--tvm-rt-tan)');
    expect(css).toContain('--tvm-text-faint: var(--tvm-rt-clay)');
    expect(css).toContain('--tvm-accent-ink: var(--tvm-rt-walnut-deep)');
  });

  it('switches the set off for playback and respects reduced motion', () => {
    expect(css).toContain(":has([data-screen='player']) .rt-set");
    expect(css).toMatch(/\[data-motion='reduced'\] \.rt-set__track,[\s\S]*?display: none/);
    expect(css).toMatch(/\[data-perf='on'\] \.rt-set__track,[\s\S]*?display: none/);
    expect(css).not.toMatch(/\.player-root[^{]*\{[^}]*background:\s*(#000|#000000|black)\b/i);
  });

  it('loads after the glass pack so its tokens win', () => {
    const globAt = applySrc.indexOf("import.meta.glob('./glass/*.css'");
    const swAt = applySrc.lastIndexOf("import './synthwave.css'");
    expect(swAt).toBeGreaterThan(globAt);
  });
});
