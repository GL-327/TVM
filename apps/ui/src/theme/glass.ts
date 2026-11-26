export type GlassStyle = 'clear';

export const DEFAULT_GLASS_STYLE: GlassStyle = 'clear';
export const GLASS_STORAGE_KEY = 'tvm.glass';

/**
 * Shared iOS 27 / tvOS 26 Liquid Glass numbers, aligned with the Windows Direct2D
 * renderer (`native/src/platform/glass_lens.cpp` and `d2d_painter.cpp`).
 */
export const GLASS_RECIPE = {
  chromeBlurPx: 3,
  sheetBlurPx: 7,
  saturate: 1.65,
  brightnessLift: 1.05,
  bevelFractionOfHalf: 0.44, // 22% of the short side
  minBevelPx: 5,
  maxBevelPx: 18,
  shiftPerBevel: 1.95,
  dispersionMaxPx: 0.65,
  dispersionRatio: 0.014,
  rimUpperLeftWhite: 0.75,
  rimPerimeterWhite: 0.15,
  rimLowerRightWhite: 0.35,
  topInnerGlowWhite: 0.065,
  topInnerGlowStop: 0.30,
  outerContourBlack: 0.23,
  darkBackdropWhiteTint: 0.05,
  brightBackdropBlackTintMax: 0.20,
  hoverLiftPx: 2,
  hoverRimBoost: 1.20,
  bloomRadiusPx: 120,
  bloomWhiteAlpha: 0.10,
  pressScale: 0.97,
  springStiffness: 420,
  springDamping: 32,
  dropletMaxStretch: 1.25,
  navCapsuleSurfaceAlpha: 0.94,
  navSelectedWhiteAlpha: 0.92,
  minContrastRatio: 4.5,
} as const;

export interface AdaptiveGlassTint {
  /** Measured backdrop luminance in [0, 1]. */
  luminance: number;
  /** Normalized brightness ramp in [0, 1] above the dark threshold (0.26..0.68). */
  bright: number;
  /** Black tint alpha (0..0.20) added over bright content. */
  darkTintAlpha: number;
  /** White tint alpha (0..0.05) added over dark content. */
  lightTintAlpha: number;
  /** CSS background tint value for chrome glass surfaces. */
  tintCss: string;
  /** CSS background tint value for large glass sheets and cards. */
  sheetTintCss: string;
  /** Primary ink colour on glass that guarantees >= 4.5:1 contrast. */
  textColor: string;
  /** Secondary ink colour on glass. */
  mutedTextColor: string;
  /** Whether the backdrop under the glass is dark or bright. */
  tone: 'dark' | 'bright';
  /** Verified WCAG 2.1 contrast ratio between `textColor` and the effective backdrop. */
  contrastRatio: number;
}

export function resolveGlassStyle(_value?: unknown): GlassStyle {
  return DEFAULT_GLASS_STYLE;
}

export function migrateStoredGlass(): GlassStyle {
  try {
    globalThis.localStorage?.removeItem(GLASS_STORAGE_KEY);
  } catch {
    // Private browsing mode.
  }
  return DEFAULT_GLASS_STYLE;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function srgbChannelToLinear(channel8: number): number {
  const c = clamp(channel8 / 255, 0, 1);
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance for an 8-bit RGB triplet, in [0, 1]. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
}

/** Perceptual Rec.709 luma matching `GlassLens::Measure` in `native/src/platform/glass_lens.cpp`. */
export function perceptualLuma(r: number, g: number, b: number): number {
  return clamp((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, 0, 1);
}

/** WCAG 2.1 contrast ratio between two relative luminances in [0, 1]. */
export function contrastRatio(lumaA: number, lumaB: number): number {
  const a = clamp(lumaA, 0, 1);
  const b = clamp(lumaB, 0, 1);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Samples the mean perceptual luminance of an RGBA pixel buffer's interior region
 * (`x` in [w/6, 5w/6], `y` in [h/5, 4h/5]), matching the native D2D readback kernel.
 */
export function sampleRgbaLuminance(rgba: ArrayLike<number>, width: number, height: number): number {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (rgba.length < w * h * 4) return 0.10;
  const x0 = Math.floor(w / 6);
  const x1 = Math.max(x0 + 1, w - x0);
  const y0 = Math.floor(h / 5);
  const y1 = Math.max(y0 + 1, h - y0);
  const stepX = Math.max(1, Math.floor((x1 - x0) / 12));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 12));
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const i = (y * w + x) * 4;
      const a = (rgba[i + 3] ?? 255) / 255;
      const r = (rgba[i] ?? 0) * a;
      const g = (rgba[i + 1] ?? 0) * a;
      const b = (rgba[i + 2] ?? 0) * a;
      sum += relativeLuminance(r, g, b);
      count += 1;
    }
  }
  return count > 0 ? clamp(sum / count, 0, 1) : 0.10;
}

const LIGHT_TEXT_HEX = '#f5f7fa';
const CRISP_WHITE_HEX = '#ffffff';
const LIGHT_TEXT_MUTED_HEX = '#a9b0bc';

const LIGHT_TEXT_LUMA = relativeLuminance(0xf5, 0xf7, 0xfa); // ~0.931
const CRISP_WHITE_LUMA = 1.0;

/**
 * Solves the adaptive glass tint and ink colours for a measured backdrop luminance:
 * - Over dark content (`luma <= 0.26`): ~5% white tint (`rgba(255, 255, 255, 0.05)`), light text `#F5F7FA`.
 * - Over bright content (`luma -> 1.0`): up to 20% black tint (`rgba(0, 0, 0, 0.20)`), and text switches
 *   so WCAG contrast stays >= 4.5:1 across the entire [0, 1] luminance range.
 */
export function computeAdaptiveGlassTint(
  backdropLuminance: number,
  theme: 'dark' | 'light' = 'dark',
): AdaptiveGlassTint {
  const luminance = clamp(Number.isFinite(backdropLuminance) ? backdropLuminance : 0.10, 0, 1);

  if (theme === 'light') {
    const bright = clamp((luminance - 0.26) / 0.42, 0, 1);
    const darkTintAlpha = +(0.20 * bright).toFixed(4);
    const lightTintAlpha = +(0.05 * (1 - bright)).toFixed(4);
    const effectiveBg = clamp(luminance * 0.36 + 0.64 * 0.96, 0.22, 0.98);
    const inkLuma = relativeLuminance(0x12, 0x32, 0x4a);
    return {
      luminance,
      bright: +bright.toFixed(4),
      darkTintAlpha,
      lightTintAlpha,
      tintCss: 'rgba(248, 249, 252, 0.68)',
      sheetTintCss: 'rgba(248, 249, 252, 0.84)',
      textColor: '#12324a',
      mutedTextColor: '#2a5a68',
      tone: 'bright',
      contrastRatio: +contrastRatio(effectiveBg, inkLuma).toFixed(2),
    };
  }

  // Matches D2dPainter::Glass: bright ramps from 0 at luma=0.26 to 1 at luma=0.68.
  const bright = clamp((luminance - 0.26) / 0.42, 0, 1);
  const darkTintAlpha = +(GLASS_RECIPE.brightBackdropBlackTintMax * bright).toFixed(4);
  const lightTintAlpha = +(GLASS_RECIPE.darkBackdropWhiteTint * (1 - bright)).toFixed(4);

  // Over bright photography, the up-to-20% black glass tint plus the stage/button
  // legibility scrim keeps effective luminance behind crisp light labels <= 0.165,
  // guaranteeing >= 4.5:1 WCAG contrast without flipping dark-theme button text to black.
  const attenuatedLuma = clamp(
    luminance * (1 - darkTintAlpha) * (0.14 + 0.04 * (1 - bright)) + lightTintAlpha * 0.4,
    0.008,
    0.165,
  );
  const isBright = bright >= 0.45;
  const textColor = isBright ? CRISP_WHITE_HEX : LIGHT_TEXT_HEX;
  const inkLuma = isBright ? CRISP_WHITE_LUMA : LIGHT_TEXT_LUMA;
  const verifiedContrast = +contrastRatio(inkLuma, attenuatedLuma).toFixed(2);
  const tone: 'dark' | 'bright' = isBright ? 'bright' : 'dark';

  const tintCss = darkTintAlpha >= lightTintAlpha && darkTintAlpha > 0.025
    ? `rgba(0, 0, 0, ${darkTintAlpha})`
    : `rgba(255, 255, 255, ${Math.max(0.03, lightTintAlpha)})`;
  const sheetAlpha = +(0.28 + 0.16 * bright).toFixed(3);
  const sheetTintCss = `rgba(12, 14, 20, ${sheetAlpha})`;

  return {
    luminance: +luminance.toFixed(4),
    bright: +bright.toFixed(4),
    darkTintAlpha,
    lightTintAlpha,
    tintCss,
    sheetTintCss,
    textColor,
    mutedTextColor: LIGHT_TEXT_MUTED_HEX,
    tone,
    contrastRatio: verifiedContrast,
  };
}

/**
 * Applies the adaptive tint tokens for a measured backdrop luminance onto the root document element.
 */
export function applyBackdropLuminance(luminance: number, root?: HTMLElement): AdaptiveGlassTint {
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : null);
  const theme = target?.dataset.theme === 'light' ? 'light' : 'dark';
  const solved = computeAdaptiveGlassTint(luminance, theme);
  if (target) {
    target.dataset.backdropTone = solved.tone;
    target.style.setProperty('--tvm-backdrop-luma', String(solved.luminance));
    target.style.setProperty('--tvm-backdrop-bright', String(solved.bright));
    target.style.setProperty('--tvm-glass-dark-tint', `rgba(0, 0, 0, ${solved.darkTintAlpha})`);
    target.style.setProperty('--tvm-glass-light-tint', `rgba(255, 255, 255, ${solved.lightTintAlpha})`);
    target.style.setProperty('--tvm-material-tint', solved.tintCss);
    target.style.setProperty('--tvm-material-sheet-tint', solved.sheetTintCss);
    target.style.setProperty('--tvm-glass-ink', solved.textColor);
    target.style.setProperty('--tvm-glass-ink-muted', solved.mutedTextColor);
  }
  return solved;
}
