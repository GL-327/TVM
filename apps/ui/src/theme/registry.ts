// Keep retired IDs in the type for old data and compatibility code. Only
// values in THEMES are accepted by parseTheme or rendered by the app.
export type ThemeId = 'light' | 'dark' | 'cinematic' | 'default' | 'happy' | 'sunset' | 'heather' | 'glass' | 'synthwave' | 'anime';

export interface ThemeSpec {
  id: ThemeId;
  name: string;
  /** Paid cosmetic pack. Unlocks via checkout or developer mode. */
  premium?: boolean;
}

export const DEFAULT_THEME: ThemeId = 'dark';

export const THEMES: readonly ThemeSpec[] = [
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
];

const IDS: ReadonlySet<string> = new Set(THEMES.map((theme) => theme.id));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && IDS.has(value);
}

export function parseTheme(value: unknown): ThemeId | null {
  return isThemeId(value) ? value : null;
}

export function resolveTheme(value: unknown): ThemeId {
  return parseTheme(value) ?? DEFAULT_THEME;
}

export function themeName(id: ThemeId): string {
  return THEMES.find((theme) => theme.id === id)?.name ?? THEMES[0]!.name;
}
