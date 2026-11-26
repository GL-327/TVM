import { describe, expect, it } from 'vitest';
import {
  applyBackdropLuminance,
  computeAdaptiveGlassTint,
  contrastRatio,
  DEFAULT_GLASS_STYLE,
  GLASS_RECIPE,
  GLASS_STORAGE_KEY,
  migrateStoredGlass,
  perceptualLuma,
  relativeLuminance,
  resolveGlassStyle,
  sampleRgbaLuminance,
} from './glass';

describe('Liquid Glass recipe and adaptive tint (spec 3.1)', () => {
  it('enforces a single clear glass style and migrates legacy stored values', () => {
    expect(DEFAULT_GLASS_STYLE).toBe('clear');
    expect(resolveGlassStyle('default')).toBe('clear');
    expect(resolveGlassStyle('tinted')).toBe('clear');
    expect(resolveGlassStyle('clear')).toBe('clear');
    expect(resolveGlassStyle(undefined)).toBe('clear');

    const store = new Map<string, string>([[GLASS_STORAGE_KEY, 'tinted']]);
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, val: string) => store.set(key, val),
        removeItem: (key: string) => store.delete(key),
      },
    });
    try {
      expect(migrateStoredGlass()).toBe('clear');
      expect(store.has(GLASS_STORAGE_KEY)).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  it('applies ~5% white tint over dark content and up to 20% black tint over bright content', () => {
    const dark = computeAdaptiveGlassTint(0.08, 'dark');
    expect(dark.bright).toBe(0);
    expect(dark.lightTintAlpha).toBeCloseTo(0.05, 3);
    expect(dark.darkTintAlpha).toBe(0);
    expect(dark.tintCss).toBe('rgba(255, 255, 255, 0.05)');
    expect(dark.textColor).toBe('#f5f7fa');
    expect(dark.contrastRatio).toBeGreaterThanOrEqual(4.5);

    const bright = computeAdaptiveGlassTint(0.85, 'dark');
    expect(bright.bright).toBe(1);
    expect(bright.darkTintAlpha).toBeCloseTo(0.20, 3);
    expect(bright.lightTintAlpha).toBe(0);
    expect(bright.tintCss).toBe('rgba(0, 0, 0, 0.2)');
    expect(bright.textColor).toBe('#ffffff');
    expect(bright.contrastRatio).toBeGreaterThanOrEqual(4.5);
  });

  it('maintains WCAG contrast >= 4.5:1 across the entire [0, 1] backdrop luminance range', () => {
    for (let step = 0; step <= 100; step += 2) {
      const luma = step / 100;
      const darkSolved = computeAdaptiveGlassTint(luma, 'dark');
      expect(darkSolved.contrastRatio).toBeGreaterThanOrEqual(GLASS_RECIPE.minContrastRatio);

      const lightSolved = computeAdaptiveGlassTint(luma, 'light');
      expect(lightSolved.contrastRatio).toBeGreaterThanOrEqual(GLASS_RECIPE.minContrastRatio);
    }
  });

  it('samples interior RGBA luminance and writes CSS custom properties to a root element', () => {
    const w = 16;
    const h = 16;
    const darkBuffer = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < darkBuffer.length; i += 4) {
      darkBuffer[i] = 12;
      darkBuffer[i + 1] = 14;
      darkBuffer[i + 2] = 20;
      darkBuffer[i + 3] = 255;
    }
    const darkLuma = sampleRgbaLuminance(darkBuffer, w, h);
    expect(darkLuma).toBeLessThan(0.05);

    const brightBuffer = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < brightBuffer.length; i += 4) {
      brightBuffer[i] = 240;
      brightBuffer[i + 1] = 244;
      brightBuffer[i + 2] = 250;
      brightBuffer[i + 3] = 255;
    }
    const brightLuma = sampleRgbaLuminance(brightBuffer, w, h);
    expect(brightLuma).toBeGreaterThan(0.85);

    expect(perceptualLuma(255, 255, 255)).toBeCloseTo(1, 4);
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 2);

    const properties = new Map<string, string>();
    const fakeRoot = {
      dataset: { theme: 'dark' } as DOMStringMap,
      style: {
        setProperty: (key: string, value: string) => properties.set(key, value),
      },
    } as unknown as HTMLElement;

    const applied = applyBackdropLuminance(0.9, fakeRoot);
    expect(applied.tone).toBe('bright');
    expect(fakeRoot.dataset.backdropTone).toBe('bright');
    expect(properties.get('--tvm-material-tint')).toBe('rgba(0, 0, 0, 0.2)');
    expect(properties.get('--tvm-glass-ink')).toBe('#ffffff');
  });
});
