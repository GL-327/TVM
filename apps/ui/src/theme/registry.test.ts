import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, parseTheme, resolveTheme, themeName, THEMES } from './registry';

describe('theme registry', () => {
  it('ships Cinematic first and keeps every earlier theme selectable', () => {
    // The look changed; the catalogue did not. Someone who preferred the
    // mint-and-navy isle must still be able to choose it.
    expect(DEFAULT_THEME).toBe('cinematic');
    expect(THEMES.map((theme) => theme.id)).toEqual([
      'cinematic',
      'default',
      'light',
      'dark',
      'happy',
      'sunset',
      'heather',
      'glass',
      'anime',
      'synthwave',
    ]);
    expect(themeName('cinematic')).toBe('Cinematic');
    expect(themeName('default')).toBe('Original');
    expect(themeName('happy')).toBe('Happy');
    expect(themeName('glass')).toBe('Liquid Glass');
    expect(themeName('synthwave')).toBe('Retro');
  });

  it('resolves unknown values to default', () => {
    expect(parseTheme('glass')).toBe('glass');
    expect(parseTheme('happy')).toBe('happy');
    expect(parseTheme('sunset')).toBe('sunset');
    expect(parseTheme('synthwave')).toBe('synthwave');
    expect(parseTheme('cinematic')).toBe('cinematic');
    // 'cinema' is a plan style, not a theme, and must stay unrecognised here.
    expect(parseTheme('cinema')).toBeNull();
    expect(resolveTheme(null)).toBe('cinematic');
    expect(resolveTheme('midnight')).toBe('cinematic');
  });
});
