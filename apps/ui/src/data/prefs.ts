import { applyLanguage, DEFAULT_LANGUAGE, isLanguageId, readStoredLanguage } from '../i18n/locale';
import { mergePolishPrefs, readPolishPrefs, storePolishPrefs, type PolishPrefs } from './polishPrefs';
import { apiFetch } from './media';

export const AUTO_UPDATE_STORAGE_KEY = 'tvm.autoUpdate';
export const SKIP_SEGMENTS_STORAGE_KEY = 'tvm.skipSegments';
export const AUTOPLAY_NEXT_STORAGE_KEY = 'tvm.autoplayNext';
export const SUBTITLE_LANGUAGES_STORAGE_KEY = 'tvm.subtitleLanguages';
export const HERO_PREVIEWS_STORAGE_KEY = 'tvm.heroPreviews';
export const PREFS_CHANGED_EVENT = 'tvm:prefs';

export type SkipSegmentsMode = 'off' | 'button' | 'auto';

export interface SubtitleLanguageChoice {
  code: string;
  label: string;
}

export const SUBTITLE_LANGUAGE_OPTIONS: readonly SubtitleLanguageChoice[] = [
  { code: 'eng', label: 'English' },
  { code: 'spa', label: 'Spanish' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'ita', label: 'Italian' },
  { code: 'por', label: 'Portuguese' },
  { code: 'jpn', label: 'Japanese' },
  { code: 'kor', label: 'Korean' },
  { code: 'zho', label: 'Chinese' },
  { code: 'ara', label: 'Arabic' },
  { code: 'hin', label: 'Hindi' },
  { code: 'rus', label: 'Russian' },
  { code: 'nld', label: 'Dutch' },
  { code: 'pol', label: 'Polish' },
  { code: 'tur', label: 'Turkish' },
];

export const DEFAULT_SUBTITLE_LANGUAGES: readonly string[] = ['eng'];

const LANG_ALIASES: Readonly<Record<string, string>> = {
  en: 'eng',
  eng: 'eng',
  es: 'spa',
  spa: 'spa',
  fr: 'fra',
  fre: 'fra',
  fra: 'fra',
  de: 'deu',
  ger: 'deu',
  deu: 'deu',
  it: 'ita',
  ita: 'ita',
  pt: 'por',
  pob: 'por',
  por: 'por',
  ja: 'jpn',
  jp: 'jpn',
  jpn: 'jpn',
  ko: 'kor',
  kor: 'kor',
  zh: 'zho',
  chi: 'zho',
  zho: 'zho',
  ar: 'ara',
  ara: 'ara',
  hi: 'hin',
  hin: 'hin',
  ru: 'rus',
  rus: 'rus',
  nl: 'nld',
  dut: 'nld',
  nld: 'nld',
  pl: 'pol',
  pol: 'pol',
  tr: 'tur',
  tur: 'tur',
};

export interface AppPrefs extends PolishPrefs {
  language: string;
  autoUpdate: boolean;
  skipSegments: SkipSegmentsMode;
  autoplayNext: boolean;
  subtitleLanguages: string[];
  heroPreviews: boolean;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function isSkipSegmentsMode(value: unknown): value is SkipSegmentsMode {
  return value === 'off' || value === 'button' || value === 'auto';
}

export function normalizeSubtitleLangCode(raw: string): string {
  const base = raw.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return LANG_ALIASES[base] ?? base;
}

export function normalizeSubtitleLanguageList(input: unknown): string[] {
  if (!Array.isArray(input)) return [...DEFAULT_SUBTITLE_LANGUAGES];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const norm = normalizeSubtitleLangCode(item);
    if (norm === '' || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out.length > 0 ? out : [...DEFAULT_SUBTITLE_LANGUAGES];
}

export function subtitleLanguagesMatch(a: string, b: string): boolean {
  const na = normalizeSubtitleLangCode(a);
  const nb = normalizeSubtitleLangCode(b);
  return na !== '' && na === nb;
}

export function subtitleLanguageDisplayName(code: string): string {
  const norm = normalizeSubtitleLangCode(code);
  const known = SUBTITLE_LANGUAGE_OPTIONS.find((entry) => entry.code === norm);
  if (known !== undefined) return known.label;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(norm) ?? code;
  } catch {
    return code;
  }
}

export function formatSubtitleLanguagesSummary(codes: readonly string[]): string {
  const list = codes.map(subtitleLanguageDisplayName);
  return list.length > 0 ? list.join(', ') : 'English';
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

export function readSkipSegments(): SkipSegmentsMode {
  const stored = storage()?.getItem(SKIP_SEGMENTS_STORAGE_KEY);
  return isSkipSegmentsMode(stored) ? stored : 'button';
}

export function applySkipSegments(mode: SkipSegmentsMode): SkipSegmentsMode {
  const valid = isSkipSegmentsMode(mode) ? mode : 'button';
  try {
    storage()?.setItem(SKIP_SEGMENTS_STORAGE_KEY, valid);
  } catch {
    // private mode
  }
  return valid;
}

export function readAutoplayNext(): boolean {
  const stored = storage()?.getItem(AUTOPLAY_NEXT_STORAGE_KEY);
  if (stored === '0' || stored === 'off' || stored === 'false') return false;
  return true;
}

export function applyAutoplayNext(enabled: boolean): boolean {
  try {
    storage()?.setItem(AUTOPLAY_NEXT_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // private mode
  }
  return enabled;
}

export function readSubtitleLanguages(): string[] {
  const stored = storage()?.getItem(SUBTITLE_LANGUAGES_STORAGE_KEY);
  if (stored == null || stored === '') return [...DEFAULT_SUBTITLE_LANGUAGES];
  try {
    return normalizeSubtitleLanguageList(JSON.parse(stored) as unknown);
  } catch {
    return [...DEFAULT_SUBTITLE_LANGUAGES];
  }
}

export function applySubtitleLanguages(list: readonly string[]): string[] {
  const next = normalizeSubtitleLanguageList(list);
  try {
    storage()?.setItem(SUBTITLE_LANGUAGES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // private mode
  }
  return next;
}

export function readHeroPreviews(): boolean {
  const stored = storage()?.getItem(HERO_PREVIEWS_STORAGE_KEY);
  if (stored === '0' || stored === 'off' || stored === 'false') return false;
  return true;
}

export function applyHeroPreviews(enabled: boolean): boolean {
  try {
    storage()?.setItem(HERO_PREVIEWS_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // private mode
  }
  return enabled;
}

export function readProfileSubtitleLanguage(profileId: string): string | null {
  const key = `tvm.subtitle.lang.${profileId || 'default'}`;
  const stored = storage()?.getItem(key);
  if (stored == null || stored.trim() === '') return null;
  return stored.trim();
}

export function saveProfileSubtitleLanguage(profileId: string, language: string | null): void {
  const key = `tvm.subtitle.lang.${profileId || 'default'}`;
  try {
    if (language === null || language.trim() === '') {
      storage()?.removeItem(key);
    } else {
      storage()?.setItem(key, language.trim());
    }
  } catch {
    // private mode
  }
}

export function readPrefs(): AppPrefs {
  return {
    ...readPolishPrefs(),
    language: readStoredLanguage(),
    autoUpdate: readAutoUpdate(),
    skipSegments: readSkipSegments(),
    autoplayNext: readAutoplayNext(),
    subtitleLanguages: readSubtitleLanguages(),
    heroPreviews: readHeroPreviews(),
  };
}

function broadcastPrefs(prefs: AppPrefs): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(PREFS_CHANGED_EVENT, { detail: prefs }));
  }
}

export async function savePrefs(patch: Partial<AppPrefs>): Promise<AppPrefs> {
  const current = readPrefs();
  const next: AppPrefs = {
    ...mergePolishPrefs(current, patch),
    language: patch.language !== undefined && isLanguageId(patch.language) ? patch.language : current.language,
    autoUpdate: patch.autoUpdate ?? current.autoUpdate,
    skipSegments: patch.skipSegments !== undefined && isSkipSegmentsMode(patch.skipSegments) ? patch.skipSegments : current.skipSegments,
    autoplayNext: patch.autoplayNext ?? current.autoplayNext,
    subtitleLanguages: patch.subtitleLanguages !== undefined ? normalizeSubtitleLanguageList(patch.subtitleLanguages) : current.subtitleLanguages,
    heroPreviews: patch.heroPreviews ?? current.heroPreviews,
  };
  applyLanguage(next.language);
  applyAutoUpdate(next.autoUpdate);
  applySkipSegments(next.skipSegments);
  applyAutoplayNext(next.autoplayNext);
  applySubtitleLanguages(next.subtitleLanguages);
  applyHeroPreviews(next.heroPreviews);
  storePolishPrefs(next);
  broadcastPrefs(next);
  try {
    await apiFetch('/api/prefs', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch {
    // on-device core may be restarting; localStorage already holds the choice
  }
  return next;
}

export async function hydratePrefs(): Promise<AppPrefs> {
  try {
    const response = await apiFetch('/api/prefs');
    if (response.ok) {
      const body = (await response.json()) as Partial<AppPrefs>;
      storePolishPrefs(mergePolishPrefs(readPolishPrefs(), body));
      if (typeof body.language === 'string' && isLanguageId(body.language)) applyLanguage(body.language);
      else applyLanguage(DEFAULT_LANGUAGE);
      if (typeof body.autoUpdate === 'boolean') applyAutoUpdate(body.autoUpdate);
      if (isSkipSegmentsMode(body.skipSegments)) applySkipSegments(body.skipSegments);
      if (typeof body.autoplayNext === 'boolean') applyAutoplayNext(body.autoplayNext);
      if (Array.isArray(body.subtitleLanguages) && body.subtitleLanguages.length > 0) {
        applySubtitleLanguages(body.subtitleLanguages);
      }
      if (typeof body.heroPreviews === 'boolean') applyHeroPreviews(body.heroPreviews);
    } else {
      applyLanguage(readStoredLanguage());
    }
  } catch {
    applyLanguage(readStoredLanguage());
  }
  const hydrated = readPrefs();
  broadcastPrefs(hydrated);
  return hydrated;
}
