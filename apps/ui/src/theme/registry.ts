export type ThemeId = 'default' | 'light' | 'dark' | 'happy' | 'sunset' | 'heather' | 'glass' | 'synthwave';

export interface ThemeSpec {
  id: ThemeId;
  name: string;
  /** Paid cosmetic pack. Unlocks via checkout or developer mode. */
  premium?: boolean;
}

export const DEFAULT_THEME: ThemeId = 'default';

export const SYNTHWAVE_THEME_NAME = 'Colourcast';

/** Default is mint-and-navy. Colourcast is a paid 1970s/80s broadcast pack. */
export const THEMES: readonly ThemeSpec[] = [
  { id: 'default', name: 'Default' },
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
  { id: 'happy', name: 'Happy' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'heather', name: 'Heather' },
  { id: 'glass', name: 'Liquid Glass' },
  { id: 'synthwave', name: SYNTHWAVE_THEME_NAME, premium: true },
];

export const SYNTHWAVE_THEME: ThemeId = 'synthwave';

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
