import { describe, expect, it } from 'vitest';
import { downloadLanguageMatches, languageFit, validDownloadPreferences } from './downloadPreferences.ts';
import { parseDebridStream } from './torrentio.ts';

describe('download preferences', () => {
  it('reads multiline language metadata, and never takes a multilingual release for one language', () => {
    const stream = parseDebridStream({ title: 'Film.1080p.mkv\nAudio: 🇬🇧 English / 🇯🇵 Japanese', url: 'https://cdn.example/file.mkv' })!;
    // Both are on it, but either could be the first track, so neither download takes it.
    expect(languageFit(stream.description!, 'en')).toBe(1);
    expect(languageFit(stream.description!, 'ja')).toBe(1);
    expect(downloadLanguageMatches(stream.description!, 'en')).toBe(false);
    expect(downloadLanguageMatches(stream.description!, 'de')).toBe(false);
    expect(downloadLanguageMatches('unknown', 'original')).toBe(true);
    expect(downloadLanguageMatches('Audio: Japanese\nSubtitles: English', 'en')).toBe(false);
    expect(downloadLanguageMatches('Film.JPN.English.Subs.mkv', 'en')).toBe(false);
  });

  it('counts an unmarked release as English and refuses anything marked as another language', () => {
    // Torrentio flags only the languages that are not English.
    expect(downloadLanguageMatches('Torrentio\n4k Home.2015.2160p.UHD.BluRay.x265\n👤 40 💾 18 GB', 'en')).toBe(true);
    expect(downloadLanguageMatches('Home.2015.1080p.BluRay.Multi-Sub', 'en')).toBe(true);
    expect(downloadLanguageMatches('Home.2015.MULTi.TRUEFRENCH.2160p\n🇫🇷', 'en')).toBe(false);
    expect(downloadLanguageMatches('Home 2015 2160p\n🇬🇧 / 🇫🇷', 'en')).toBe(false);
    expect(downloadLanguageMatches('Home.2015.FRENCH.1080p.WEB', 'en')).toBe(false);
    expect(downloadLanguageMatches('Home.2015.1080p.MULTi', 'en')).toBe(false);
    expect(downloadLanguageMatches('Home.2015.1080p\n🇷🇺', 'en')).toBe(false);
    // Any other language has to be marked, since an unmarked name is English.
    expect(downloadLanguageMatches('Home.2015.FRENCH.1080p.WEB', 'fr')).toBe(true);
    expect(downloadLanguageMatches('Home.2015.1080p', 'fr')).toBe(false);
  });

  it('rejects unsupported settings and prototype keys', () => {
    expect(validDownloadPreferences({ language: 'en', maxHeight: 1080 })).toBe(true);
    expect(validDownloadPreferences({ language: 'en', maxHeight: 9999 })).toBe(false);
    expect(validDownloadPreferences({ language: 'constructor', maxHeight: 1080 })).toBe(false);
    expect(validDownloadPreferences(null)).toBe(false);
  });
});
