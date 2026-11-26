import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentSyncDirectory } from './requestContext.ts';
import { readSealed, writeSealed } from './providers/vault.ts';
import { SYNC_PREFS } from './sync/schema.ts';
import { syncStoreChanged } from './sync/storeEvents.ts';
import { prefsPath } from './update/paths.ts';

const LANGUAGES = new Set(['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh']);

export const EXTRA_DEFAULTS = {
  onlineSubtitles: true, trailers: true, trailerBackdrops: true, collections: true,
  comingUp: true, watchStats: true, animeTitles: true, ratings: true, qualityBadges: true,
  versionPicker: true, chapters: true, seekPreviews: true, themeSongs: false,
  spoilerBlur: false, surpriseMe: true, autoCollections: true, sleepTimer: true,
  nightMode: false, pauseOnMinimize: true, shortcutsOverlay: true, webhook: false, announcements: true,
};
type Extras = typeof EXTRA_DEFAULTS;
export type Quality = 'original' | '2160' | '1080' | '720' | 'saver';
export interface SubtitleStyle {
  size: 's' | 'm' | 'l' | 'xl';
  color: 'white' | 'yellow' | 'cyan';
  background: 'shadow' | 'box' | 'none';
}

export interface CorePrefs {
  language: string;
  autoUpdate: boolean;
  skipSegments: 'off' | 'button' | 'auto';
  autoplayNext: boolean;
  subtitleLanguages: string[];
  heroPreviews: boolean;
  quality: Quality;
  audioLanguage: string;
  skipUpscaled: boolean;
  subtitleMode: 'off' | 'foreign' | 'always';
  subtitleStyle: SubtitleStyle;
  extras: Extras;
  webhookUrl: string | null;
  homeSections: { id: string; visible: boolean }[];
}

export type PrefsPatch = Partial<Omit<CorePrefs, 'extras' | 'subtitleStyle'>> & {
  extras?: Partial<Extras>;
  subtitleStyle?: Partial<SubtitleStyle>;
};

export const DEFAULT_PREFS: CorePrefs = {
  language: 'en', autoUpdate: true, skipSegments: 'button', autoplayNext: true,
  subtitleLanguages: ['eng'], heroPreviews: true,
  quality: 'original', audioLanguage: 'original', skipUpscaled: true, subtitleMode: 'foreign',
  subtitleStyle: { size: 'm', color: 'white', background: 'shadow' },
  extras: EXTRA_DEFAULTS, webhookUrl: null, homeSections: [],
};

function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function normalizePrefs(raw: PrefsPatch, current: CorePrefs): CorePrefs {
  const subtitleLanguages = Array.isArray(raw.subtitleLanguages)
    ? [...new Set(raw.subtitleLanguages.filter((v): v is string => typeof v === 'string' && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(v)))].slice(0, 20)
    : current.subtitleLanguages;
  const extras = { ...current.extras };
  for (const id of Object.keys(EXTRA_DEFAULTS) as (keyof Extras)[]) {
    const value = raw.extras?.[id];
    if (typeof value === 'boolean') extras[id] = value;
  }
  let webhookUrl = current.webhookUrl;
  if (raw.webhookUrl === null || raw.webhookUrl === '') webhookUrl = null;
  if (typeof raw.webhookUrl === 'string' && raw.webhookUrl.length <= 2048) {
    try {
      const url = new URL(raw.webhookUrl);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) webhookUrl = url.href;
    } catch { /* Retain the current URL. */ }
  }
  const sections = new Map<string, boolean>();
  if (Array.isArray(raw.homeSections)) {
    for (const row of raw.homeSections.slice(0, 100)) {
      if (row && typeof row.id === 'string' && /^[a-z\d][a-z\d-]{0,63}$/i.test(row.id) && typeof row.visible === 'boolean') {
        sections.set(row.id, row.visible);
      }
    }
  }
  return {
    language: typeof raw.language === 'string' && LANGUAGES.has(raw.language) ? raw.language : current.language,
    autoUpdate: typeof raw.autoUpdate === 'boolean' ? raw.autoUpdate : current.autoUpdate,
    skipSegments: raw.skipSegments === 'off' || raw.skipSegments === 'button' || raw.skipSegments === 'auto' ? raw.skipSegments : current.skipSegments,
    autoplayNext: typeof raw.autoplayNext === 'boolean' ? raw.autoplayNext : current.autoplayNext,
    subtitleLanguages: subtitleLanguages.length ? [...subtitleLanguages] : [...current.subtitleLanguages],
    heroPreviews: typeof raw.heroPreviews === 'boolean' ? raw.heroPreviews : current.heroPreviews,
    quality: choice(raw.quality, ['original', '2160', '1080', '720', 'saver'], current.quality),
    audioLanguage: typeof raw.audioLanguage === 'string' && /^(original|[a-z]{3})$/.test(raw.audioLanguage)
      ? raw.audioLanguage : current.audioLanguage,
    skipUpscaled: typeof raw.skipUpscaled === 'boolean' ? raw.skipUpscaled : current.skipUpscaled,
    subtitleMode: choice(raw.subtitleMode, ['off', 'foreign', 'always'], current.subtitleMode),
    subtitleStyle: {
      size: choice(raw.subtitleStyle?.size, ['s', 'm', 'l', 'xl'], current.subtitleStyle.size),
      color: choice(raw.subtitleStyle?.color, ['white', 'yellow', 'cyan'], current.subtitleStyle.color),
      background: choice(raw.subtitleStyle?.background, ['shadow', 'box', 'none'], current.subtitleStyle.background),
    },
    extras, webhookUrl,
    homeSections: Array.isArray(raw.homeSections) ? [...sections].map(([id, visible]) => ({ id, visible })) : [...current.homeSections],
  };
}

export function readDevicePrefs(dataDir: string): CorePrefs {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(dataDir), 'utf8')) as Partial<CorePrefs>;
    return normalizePrefs(raw, DEFAULT_PREFS);
  } catch {
    return normalizePrefs({}, DEFAULT_PREFS);
  }
}

export function syncPrefValues(prefs: CorePrefs): Record<string, unknown> {
  return Object.fromEntries(SYNC_PREFS.map(key => [key, key.startsWith('extras.')
    ? prefs.extras[key.slice(7) as keyof Extras] : prefs[key as keyof CorePrefs]]));
}

export function syncPrefsPath(scope: string): string {
  return join(scope, 'sync-prefs.enc');
}

export function readSyncPrefs(scope: string): Record<string, unknown> {
  return readSealed<Record<string, unknown>>(scope, syncPrefsPath(scope)) ?? {};
}

export function saveSyncPrefs(scope: string, values: Record<string, unknown>): void {
  writeSealed(scope, syncPrefsPath(scope), values);
}

export function readPrefs(dataDir: string): CorePrefs {
  const device = readDevicePrefs(dataDir);
  const scope = currentSyncDirectory(dataDir);
  if (!scope) return device;
  const synced = { ...syncPrefValues(DEFAULT_PREFS), ...readSyncPrefs(scope) };
  const extras = { ...EXTRA_DEFAULTS };
  for (const id of Object.keys(extras) as (keyof Extras)[]) {
    const value = synced['extras.' + id];
    if (typeof value === 'boolean') extras[id] = value;
  }
  return normalizePrefs({ ...synced as PrefsPatch, extras }, { ...device, subtitleLanguages: DEFAULT_PREFS.subtitleLanguages });
}

export function writePrefs(dataDir: string, patch: PrefsPatch): CorePrefs {
  const scope = currentSyncDirectory(dataDir);
  const current = readPrefs(dataDir);
  const next = normalizePrefs(patch, current);
  const device = scope ? readDevicePrefs(dataDir) : next;
  if (scope) {
    const values = readSyncPrefs(scope);
    const before = syncPrefValues(current);
    const after = syncPrefValues(next);
    let changed = false;
    for (const key of SYNC_PREFS) {
      if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
      values[key] = after[key];
      changed = true;
    }
    if (changed) {
      saveSyncPrefs(scope, values);
      syncStoreChanged(scope);
    }
    // Use the original device values for account fields so another account never inherits this patch.
    Object.assign(device, {
      language: next.language, autoUpdate: next.autoUpdate, heroPreviews: next.heroPreviews, quality: next.quality,
      skipUpscaled: next.skipUpscaled, subtitleMode: next.subtitleMode, webhookUrl: next.webhookUrl,
    });
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(prefsPath(dataDir), JSON.stringify(device));
  return next;
}

export function prefsFileExists(dataDir: string): boolean {
  return existsSync(prefsPath(dataDir));
}
