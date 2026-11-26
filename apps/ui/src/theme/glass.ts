export type GlassStyle = 'clear';

export const DEFAULT_GLASS_STYLE: GlassStyle = 'clear';
export const GLASS_STORAGE_KEY = 'tvm.glass';

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
