import { describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE, isLanguageId, languageName, LANGUAGES, nextLanguage } from './locale';

describe('interface language', () => {
  it('defaults to English and only accepts the Settings list', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
    expect(isLanguageId('en')).toBe(true);
    expect(isLanguageId('fr')).toBe(true);
    expect(isLanguageId('navigator')).toBe(false);
    expect(languageName('en')).toBe('English');
  });

  it('cycles the Settings row through the catalog and back to English', () => {
    expect(nextLanguage('en')).toBe(LANGUAGES[1]?.id);
    expect(nextLanguage(LANGUAGES[LANGUAGES.length - 1]?.id ?? 'zh')).toBe('en');
  });
});
