import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatSubtitleLanguagesSummary,
  hydratePrefs,
  normalizeSubtitleLangCode,
  normalizeSubtitleLanguageList,
  readPrefs,
  readProfileSubtitleLanguage,
  savePrefs,
  saveProfileSubtitleLanguage,
  subtitleLanguagesMatch,
} from './prefs';

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('extras prefs and subtitle language preferences', () => {
  const origStorage = globalThis.localStorage;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeMemoryStorage(),
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: origStorage,
      configurable: true,
    });
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('defaults extras prefs cleanly', () => {
    expect(readPrefs()).toMatchObject({
      skipSegments: 'button',
      autoplayNext: true,
      subtitleLanguages: ['eng'],
      heroPreviews: true,
    });
  });

  it('saves and hydrates extras prefs with /api/prefs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          language: 'en',
          autoUpdate: true,
          skipSegments: 'auto',
          autoplayNext: false,
          subtitleLanguages: ['spa', 'eng'],
          heroPreviews: false,
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const saved = await savePrefs({
      skipSegments: 'auto',
      autoplayNext: false,
      subtitleLanguages: ['es', 'en'],
      heroPreviews: false,
    });
    expect(saved.skipSegments).toBe('auto');
    expect(saved.autoplayNext).toBe(false);
    expect(saved.subtitleLanguages).toEqual(['spa', 'eng']);
    expect(saved.heroPreviews).toBe(false);

    localStorage.clear();
    const hydrated = await hydratePrefs();
    expect(hydrated.skipSegments).toBe('auto');
    expect(hydrated.autoplayNext).toBe(false);
    expect(hydrated.subtitleLanguages).toEqual(['spa', 'eng']);
    expect(hydrated.heroPreviews).toBe(false);
  });

  it('normalizes and matches ISO 639-1 and ISO 639-2 subtitle language codes', () => {
    expect(normalizeSubtitleLangCode('en-US')).toBe('eng');
    expect(normalizeSubtitleLangCode('pob')).toBe('por');
    expect(normalizeSubtitleLanguageList(['en', 'es', 'eng'])).toEqual(['eng', 'spa']);
    expect(subtitleLanguagesMatch('en', 'eng')).toBe(true);
    expect(subtitleLanguagesMatch('pob', 'por')).toBe(true);
    expect(subtitleLanguagesMatch('fra', 'eng')).toBe(false);
    expect(formatSubtitleLanguagesSummary(['spa', 'eng'])).toBe('Spanish, English');
  });

  it('remembers chosen subtitle language per profile', () => {
    saveProfileSubtitleLanguage('profile-1', 'spa');
    saveProfileSubtitleLanguage('profile-2', 'jpn');
    expect(readProfileSubtitleLanguage('profile-1')).toBe('spa');
    expect(readProfileSubtitleLanguage('profile-2')).toBe('jpn');
    saveProfileSubtitleLanguage('profile-1', null);
    expect(readProfileSubtitleLanguage('profile-1')).toBeNull();
  });
});
