export type GlassStyle = 'clear' | 'default' | 'tinted';

export const GLASS_STYLES: readonly { id: GlassStyle; label: string }[] = [
  { id: 'clear', label: 'Clear' },
  { id: 'default', label: 'Default' },
  { id: 'tinted', label: 'Tinted' },
];

export const DEFAULT_GLASS_STYLE: GlassStyle = 'default';
export const GLASS_STORAGE_KEY = 'tvm.glass';
// PyGlass-calibrated optical targets: convex bevel refraction, visible rim RGB dispersion, low interior tint wash.
export const GLASS_MATERIAL_TUNING = {
  bevelFraction: 0.5,
  shiftPerBevel: 2.35,
  rimDispersionPx: 2.4,
  vibrancySaturation: 1.82,
} as const;

const listeners = new Set<(style: GlassStyle) => void>();

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function resolveGlassStyle(value: unknown): GlassStyle {
  if (value === 'clear' || value === 'default' || value === 'tinted') return value;
  return DEFAULT_GLASS_STYLE;
}

export function readStoredGlass(): GlassStyle {
  return resolveGlassStyle(storage()?.getItem(GLASS_STORAGE_KEY));
}

export function subscribeGlassStyle(listener: (style: GlassStyle) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function applyGlassStyle(style: GlassStyle | string): GlassStyle {
  const resolved = resolveGlassStyle(style);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.glass = resolved;
  }
  try {
    storage()?.setItem(GLASS_STORAGE_KEY, resolved);
  } catch {
    // Private browsing mode; dataset attribute still applies for this session.
  }
  for (const listener of listeners) {
    try {
      listener(resolved);
    } catch {
      // One failing listener should not interrupt others.
    }
  }
  return resolved;
}

export function applyStoredGlass(): GlassStyle {
  return applyGlassStyle(readStoredGlass());
}
