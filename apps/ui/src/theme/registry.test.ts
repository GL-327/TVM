import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, parseTheme, resolveTheme, themeName, THEMES } from './registry';

describe('theme registry', () => {
  it('offers only Light and Dark', () => {
    expect(DEFAULT_THEME).toBe('dark');
    expect(THEMES.map((theme) => theme.id)).toEqual(['light', 'dark']);
    expect(themeName('light')).toBe('Light');
    expect(themeName('dark')).toBe('Dark');
  });

  it('migrates retired themes to Dark', () => {
    for (const old of ['cinematic', 'default', 'happy', 'sunset', 'heather', 'glass', 'anime', 'synthwave']) {
      expect(parseTheme(old)).toBeNull();
      expect(resolveTheme(old)).toBe('dark');
    }
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(resolveTheme(null)).toBe('dark');
  });
});
