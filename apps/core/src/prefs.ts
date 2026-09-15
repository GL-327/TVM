import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { prefsPath } from './update/paths.ts';

const LANGUAGES = new Set(['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh']);

export interface CorePrefs {
  language: string;
  autoUpdate: boolean;
}

export const DEFAULT_PREFS: CorePrefs = { language: 'en', autoUpdate: true };

export function readPrefs(dataDir: string): CorePrefs {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(dataDir), 'utf8')) as Partial<CorePrefs>;
    const language = typeof raw.language === 'string' && LANGUAGES.has(raw.language) ? raw.language : DEFAULT_PREFS.language;
    const autoUpdate = raw.autoUpdate === false ? false : true;
    return { language, autoUpdate };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writePrefs(dataDir: string, patch: Partial<CorePrefs>): CorePrefs {
  const current = readPrefs(dataDir);
  const next: CorePrefs = {
    language: typeof patch.language === 'string' && LANGUAGES.has(patch.language) ? patch.language : current.language,
    autoUpdate: typeof patch.autoUpdate === 'boolean' ? patch.autoUpdate : current.autoUpdate,
  };
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(prefsPath(dataDir), JSON.stringify(next));
  return next;
}

export function prefsFileExists(dataDir: string): boolean {
  return existsSync(prefsPath(dataDir));
}
