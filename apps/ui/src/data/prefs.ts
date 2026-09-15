import { applyLanguage, DEFAULT_LANGUAGE, isLanguageId, readStoredLanguage } from '../i18n/locale';

export const AUTO_UPDATE_STORAGE_KEY = 'tvm.autoUpdate';

export interface AppPrefs {
  language: string;
  autoUpdate: boolean;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readAutoUpdate(): boolean {
  const stored = storage()?.getItem(AUTO_UPDATE_STORAGE_KEY);
  if (stored === '0' || stored === 'off' || stored === 'false') return false;
  return true;
}

export function applyAutoUpdate(enabled: boolean): boolean {
  try {
    storage()?.setItem(AUTO_UPDATE_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // private mode
  }
  return enabled;
}

export function readPrefs(): AppPrefs {
  return { language: readStoredLanguage(), autoUpdate: readAutoUpdate() };
}

export async function savePrefs(patch: Partial<AppPrefs>): Promise<AppPrefs> {
  const next: AppPrefs = {
    language: patch.language !== undefined && isLanguageId(patch.language) ? patch.language : readStoredLanguage(),
    autoUpdate: patch.autoUpdate ?? readAutoUpdate(),
  };
  applyLanguage(next.language);
  applyAutoUpdate(next.autoUpdate);
  try {
    await fetch('/api/prefs', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
  } catch {
    // on-device core may be restarting; localStorage already holds the choice
  }
  return next;
}

export async function hydratePrefs(): Promise<AppPrefs> {
  try {
    const response = await fetch('/api/prefs');
    if (response.ok) {
      const body = (await response.json()) as Partial<AppPrefs>;
      if (typeof body.language === 'string' && isLanguageId(body.language)) applyLanguage(body.language);
      else applyLanguage(DEFAULT_LANGUAGE);
      if (typeof body.autoUpdate === 'boolean') applyAutoUpdate(body.autoUpdate);
    } else {
      applyLanguage(readStoredLanguage());
    }
  } catch {
    applyLanguage(readStoredLanguage());
  }
  return readPrefs();
}
