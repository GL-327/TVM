/**
 * Interface language. Default is English even when the phone/OS is not —
 * WKWebView and Intl otherwise follow the device locale. A Settings row
 * stores an override in localStorage and mirrors it to `/api/prefs`.
 */

export const LANGUAGE_STORAGE_KEY = 'tvm.language';
export const DEFAULT_LANGUAGE = 'en';

export interface LanguageOption {
  id: string;
  name: string;
}

export const LANGUAGES: readonly LanguageOption[] = [
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' },
  { id: 'fr', name: 'Français' },
  { id: 'de', name: 'Deutsch' },
  { id: 'it', name: 'Italiano' },
  { id: 'pt', name: 'Português' },
  { id: 'ja', name: '日本語' },
  { id: 'ko', name: '한국어' },
  { id: 'zh', name: '中文' },
];

const ALLOWED = new Set(LANGUAGES.map((row) => row.id));

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function isLanguageId(value: unknown): value is string {
  return typeof value === 'string' && ALLOWED.has(value);
}

export function languageName(id: string): string {
  return LANGUAGES.find((row) => row.id === id)?.name ?? 'English';
}

export function readStoredLanguage(): string {
  const stored = storage()?.getItem(LANGUAGE_STORAGE_KEY);
  return isLanguageId(stored) ? stored : DEFAULT_LANGUAGE;
}

export function applyLanguage(id: string): string {
  const language = isLanguageId(id) ? id : DEFAULT_LANGUAGE;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
    document.documentElement.dataset.lang = language;
  }
  try {
    storage()?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // private mode — attribute still applies for this session
  }
  return language;
}

export function applyStoredLanguage(): string {
  return applyLanguage(readStoredLanguage());
}

export function nextLanguage(current: string): string {
  const index = LANGUAGES.findIndex((row) => row.id === current);
  const next = LANGUAGES[(index + 1) % LANGUAGES.length];
  return next?.id ?? DEFAULT_LANGUAGE;
}

export function formatAppDate(value: string | number | Date, language = readStoredLanguage()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  } catch {
    return date.toISOString();
  }
}
