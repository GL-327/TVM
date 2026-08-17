/**
 * Typed mirror of tokens.css. Import the stylesheet for the custom properties;
 * import these when a value is needed in TypeScript (canvas, animations, tests).
 */

export const color = {
  bg: 'var(--tvm-bg)',
  bgDeep: 'var(--tvm-bg-deep)',
  bgElevated: 'var(--tvm-bg-elevated)',
  surface: 'var(--tvm-surface)',
  surfaceHover: 'var(--tvm-surface-hover)',
  surfaceGlass: 'var(--tvm-surface-glass)',
  border: 'var(--tvm-border)',
  borderSoft: 'var(--tvm-border-soft)',
  text: 'var(--tvm-text)',
  textMuted: 'var(--tvm-text-muted)',
  textFaint: 'var(--tvm-text-faint)',
  accent: 'var(--tvm-accent)',
  accentStrong: 'var(--tvm-accent-strong)',
  accentBlue: 'var(--tvm-accent-blue)',
  accentInk: 'var(--tvm-accent-ink)',
  danger: 'var(--tvm-danger)',
  success: 'var(--tvm-success)',
  warning: 'var(--tvm-warning)',
  info: 'var(--tvm-info)',
} as const;

export const fontSize = {
  caption: 'var(--tvm-font-size-caption)',
  body: 'var(--tvm-font-size-body)',
  bodyLg: 'var(--tvm-font-size-body-lg)',
  title: 'var(--tvm-font-size-title)',
  display: 'var(--tvm-font-size-display)',
} as const;

export const space = {
  1: 'var(--tvm-space-1)',
  2: 'var(--tvm-space-2)',
  3: 'var(--tvm-space-3)',
  4: 'var(--tvm-space-4)',
  5: 'var(--tvm-space-5)',
  6: 'var(--tvm-space-6)',
  7: 'var(--tvm-space-7)',
} as const;

export const motion = {
  fast: 'var(--tvm-motion-fast)',
  base: 'var(--tvm-motion-base)',
  slow: 'var(--tvm-motion-slow)',
  ease: 'var(--tvm-motion-ease)',
} as const;

/** Milliseconds, for timers that must stay in step with the CSS transitions. */
export const motionMs = {
  fast: 160,
  base: 220,
  slow: 280,
} as const;

export type ColorToken = keyof typeof color;
export type SpaceToken = keyof typeof space;
