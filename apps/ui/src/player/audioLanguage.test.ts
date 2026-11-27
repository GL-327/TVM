import { describe, expect, it } from 'vitest';
import { nativeAudioLanguage } from './audioLanguage';

describe('nativeAudioLanguage', () => {
  it('uses the original language when Settings says original', () => {
    expect(nativeAudioLanguage('original', 'jpn')).toBe('jpn');
  });
  it('falls back to English, never the file default, when the original is unknown', () => {
    expect(nativeAudioLanguage('original', null)).toBe('eng');
    expect(nativeAudioLanguage(undefined, undefined)).toBe('eng');
    expect(nativeAudioLanguage('original', 'not a code')).toBe('eng');
  });
  it('plays a dub only when Settings picks that language', () => {
    expect(nativeAudioLanguage('rus', 'eng')).toBe('rus');
  });
});
