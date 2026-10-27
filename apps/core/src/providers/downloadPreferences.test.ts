import { describe, expect, it } from 'vitest';
import { downloadLanguageMatches, validDownloadPreferences } from './downloadPreferences.ts';
import { parseDebridStream } from './torrentio.ts';

describe('download preferences', () => {
  it('keeps multiline language metadata, including multilingual releases', () => {
    const stream = parseDebridStream({ title: 'Film.1080p.mkv\nAudio: 🇬🇧 English / 🇯🇵 Japanese', url: 'https://cdn.example/file.mkv' })!;
    expect(downloadLanguageMatches(stream.description!, 'en')).toBe(true);
    expect(downloadLanguageMatches(stream.description!, 'ja')).toBe(true);
    expect(downloadLanguageMatches(stream.description!, 'de')).toBe(false);
    expect(downloadLanguageMatches('unknown', 'original')).toBe(true);
    expect(downloadLanguageMatches('unknown', 'en')).toBe(false);
    expect(downloadLanguageMatches('Audio: Japanese\nSubtitles: English', 'en')).toBe(false);
    expect(downloadLanguageMatches('Film.JPN.English.Subs.mkv', 'en')).toBe(false);
  });
  it('rejects unsupported settings and prototype keys', () => {
    expect(validDownloadPreferences({ language: 'en', maxHeight: 1080 })).toBe(true);
    expect(validDownloadPreferences({ language: 'en', maxHeight: 9999 })).toBe(false);
    expect(validDownloadPreferences({ language: 'constructor', maxHeight: 1080 })).toBe(false);
    expect(validDownloadPreferences(null)).toBe(false);
  });
});
