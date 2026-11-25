import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { prefsPath } from './update/paths.ts';

const LANGUAGES = new Set(['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh']);

export interface CorePrefs {
  language: string;
  autoUpdate: boolean;
  skipSegments: 'off' | 'button' | 'auto';
  autoplayNext: boolean;
  subtitleLanguages: string[];
  heroPreviews: boolean;
}

export const DEFAULT_PREFS: CorePrefs = {
  language: 'en', autoUpdate: true, skipSegments: 'button', autoplayNext: true,
  subtitleLanguages: ['eng'], heroPreviews: true,
};

function normalizePrefs(raw: Partial<CorePrefs>, current: CorePrefs): CorePrefs {
  const subtitleLanguages = Array.isArray(raw.subtitleLanguages)
    ? [...new Set(raw.subtitleLanguages.filter((v): v is string => typeof v === 'string' && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(v)))].slice(0, 20)
    : current.subtitleLanguages;
  return {
    language: typeof raw.language === 'string' && LANGUAGES.has(raw.language) ? raw.language : current.language,
    autoUpdate: typeof raw.autoUpdate === 'boolean' ? raw.autoUpdate : current.autoUpdate,
    skipSegments: raw.skipSegments === 'off' || raw.skipSegments === 'button' || raw.skipSegments === 'auto' ? raw.skipSegments : current.skipSegments,
    autoplayNext: typeof raw.autoplayNext === 'boolean' ? raw.autoplayNext : current.autoplayNext,
    subtitleLanguages: subtitleLanguages.length ? [...subtitleLanguages] : [...current.subtitleLanguages],
    heroPreviews: typeof raw.heroPreviews === 'boolean' ? raw.heroPreviews : current.heroPreviews,
  };
}

export function readPrefs(dataDir: string): CorePrefs {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(dataDir), 'utf8')) as Partial<CorePrefs>;
    return normalizePrefs(raw, DEFAULT_PREFS);
  } catch {
    return { ...DEFAULT_PREFS, subtitleLanguages: [...DEFAULT_PREFS.subtitleLanguages] };
  }
}

export function writePrefs(dataDir: string, patch: Partial<CorePrefs>): CorePrefs {
  const current = readPrefs(dataDir);
  const next = normalizePrefs(patch, current);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(prefsPath(dataDir), JSON.stringify(next));
  return next;
}

export function prefsFileExists(dataDir: string): boolean {
  return existsSync(prefsPath(dataDir));
}
