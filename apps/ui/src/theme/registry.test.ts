import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, parseTheme, resolveTheme, themeName, THEMES } from './registry';

describe('theme registry', () => {
  it('defaults to the mint-and-navy isle look and lists the free themes', () => {
    expect(DEFAULT_THEME).toBe('default');
    expect(THEMES.map((theme) => theme.id)).toEqual([
      'default',
      'light',
      'dark',
      'happy',
      'sunset',
      'heather',
      'glass',
      'synthwave',
    ]);
    expect(themeName('default')).toBe('Default');
    expect(themeName('happy')).toBe('Happy');
    expect(themeName('glass')).toBe('Liquid Glass');
    expect(themeName('synthwave')).toBe('Colourcast');
  });

  it('resolves unknown values to default', () => {
    expect(parseTheme('glass')).toBe('glass');
    expect(parseTheme('happy')).toBe('happy');
    expect(parseTheme('sunset')).toBe('sunset');
    expect(parseTheme('synthwave')).toBe('synthwave');
    expect(parseTheme('cinema')).toBeNull();
    expect(resolveTheme(null)).toBe('default');
    expect(resolveTheme('midnight')).toBe('default');
  });
});
