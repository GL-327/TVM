import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PREFS, readDevicePrefs, readSyncPrefs, saveSyncPrefs, syncPrefsPath, syncPrefValues } from '../prefs.ts';
import { readPrivateJson } from '../providers/privateJson.ts';
import { readProgress, type ProgressEntry } from '../providers/progress.ts';
import { defaultProfile, loadProfiles, profileKind, profileMaxAge, writeProfileRegistry, type Profile } from '../providers/profiles.ts';
import { writeSealed } from '../providers/vault.ts';
import { readWatchlist, type WatchlistItem } from '../providers/watchlist.ts';
import { prefsPath, profileDir, profilesPath, progressPath, watchlistPath } from '../update/paths.ts';
import { MAX_VALUE_BYTES, parseSyncItem, profileId, publicSyncArtwork, syncValueBytes, type SyncItem } from './schema.ts';

export const itemId = (item: Pick<SyncItem, 'kind' | 'key'>) => item.kind + ':' + item.key;

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const object = entry as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]]));
  });
}

export const valueHash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('base64url');

function modified(path: string): number {
  return Math.floor(statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0);
}

const STRICT_ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/;
function isoTimestamp(raw: string | undefined, fallbackMs: number): string {
  if (typeof raw === 'string' && STRICT_ISO.test(raw) && Number.isFinite(Date.parse(raw))) return raw;
  const parsed = typeof raw === 'string' ? Date.parse(raw) : NaN;
  return new Date(Number.isFinite(parsed) ? parsed : fallbackMs).toISOString();
}

function untouchedProfile(row: Profile): boolean {
  return row.name === 'Profile 1' && row.hue === 221 && !row.avatar && !row.pin
    && profileKind(row) === 'standard' && profileMaxAge(row) === 18;
}

export function initializeStores(directory: string, legacy?: string): void {
  if (!legacy) { loadProfiles(directory); return; }
  const registry = loadProfiles(legacy);
  writeProfileRegistry(directory, registry);
  for (const profile of registry.profiles) {
    if (!profileId(profile.id)) continue;
    const from = profileDir(legacy, profile.id);
    const to = profileDir(directory, profile.id);
    const progress = readProgress(from);
    if (Object.keys(progress).length) writeSealed(to, progressPath(to), progress);
    const watchlist = readWatchlist(from);
    if (watchlist.length) writeSealed(to, watchlistPath(to), watchlist);
    const history = readPrivateJson<unknown>(from, join(from, 'extras-history.json'));
    if (history !== null) writeSealed(to, join(to, 'extras-history.json'), history);
    const services = join(from, 'services.json');
    if (modified(services)) {
      mkdirSync(to, { recursive: true });
      copyFileSync(services, join(to, 'services.json'));
    }
  }
  const values = syncPrefValues(readDevicePrefs(legacy));
  const defaults = syncPrefValues(DEFAULT_PREFS);
  const lastSubtitle = readPrivateJson<{ language: string }>(profileDir(legacy, registry.activeId),
    join(profileDir(legacy, registry.activeId), 'extras-subtitle.json'))?.language;
  if (typeof lastSubtitle === 'string' && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(lastSubtitle)) {
    values['subtitleLanguages'] = [...new Set([lastSubtitle, ...(values['subtitleLanguages'] as string[])])].slice(0, 20);
  }
  const chosen = Object.fromEntries(Object.entries(values).filter(([key, value]) => canonical(value) !== canonical(defaults[key])));
  if (Object.keys(chosen).length) saveSyncPrefs(directory, chosen);
}

export interface SnapshotItem { item: SyncItem; hash: string; changedAt: number }

export function snapshot(directory: string, now: number, legacy?: string, knownProfiles = new Set<string>()): Map<string, SnapshotItem> {
  const result = new Map<string, SnapshotItem>();
  const registry = loadProfiles(directory, Infinity);
  const mediaProfiles = new Set<string>();
  function add(kind: SyncItem['kind'], key: string, value: unknown, initial: number, changedAt: number): void {
    const item = parseSyncItem({ kind, key, value, updatedAt: Math.max(0, Math.min(initial, now)) }, now);
    if (item && syncValueBytes(value) <= MAX_VALUE_BYTES) {
      result.set(itemId(item), { item, hash: valueHash(value), changedAt });
      if (kind === 'progress' || kind === 'watchlist') mediaProfiles.add(key.split('/')[0]!);
    }
  }

  for (const dir of readdirSync(join(directory, 'profiles'), { withFileTypes: true })) {
    if (!dir.isDirectory() || !profileId(dir.name)) continue;
    const scope = profileDir(directory, dir.name);
    const progressTime = modified(progressPath(scope));
    for (const [id, entry] of Object.entries(readProgress(scope))) {
      // Pick the known fields explicitly. Older files may have carried provider metadata.
      const updated = Date.parse(entry.updated) || progressTime;
      const value = {
        position: entry.position, duration: entry.duration, updated: isoTimestamp(entry.updated, updated),
        hiddenFromContinueWatching: entry.hiddenFromContinueWatching,
        completedAt: entry.completedAt === undefined ? undefined : isoTimestamp(entry.completedAt, updated),
        completions: entry.completions, completedTitle: entry.completedTitle, completedYear: entry.completedYear,
      };
      add('progress', dir.name + '/' + id, value, updated, updated);
    }
    const watchlistTime = modified(watchlistPath(scope));
    for (const entry of readWatchlist(scope)) {
      const added = Date.parse(entry.added) || watchlistTime;
      const value = {
        ...entry,
        added: isoTimestamp(entry.added, added),
        poster: publicSyncArtwork(entry.poster),
        backdrop: publicSyncArtwork(entry.backdrop),
      };
      add('watchlist', dir.name + '/' + entry.id, value, added, added);
    }
  }

  const profileTime = modified(profilesPath(directory));
  const legacyProfileTime = legacy ? modified(profilesPath(legacy)) : profileTime;
  for (const row of registry.profiles) {
    const untouched = untouchedProfile(row);
    if (untouched && !mediaProfiles.has(row.id) && !knownProfiles.has(row.id)) continue;
    const value = {
      id: row.id, name: row.name, hue: row.hue, created: isoTimestamp(row.created, profileTime), avatar: row.avatar ?? null,
      kind: profileKind(row), maxAge: profileMaxAge(row),
      pin: row.pin ? { hash: row.pin.hash, salt: row.pin.salt, iter: row.pin.iter } : null,
    };
    add('profile', row.id, value, untouched ? 0 : legacyProfileTime, profileTime);
  }

  const preferenceTime = modified(syncPrefsPath(directory));
  const legacyPreferenceTime = legacy ? modified(prefsPath(legacy)) : preferenceTime;
  for (const [key, value] of Object.entries(readSyncPrefs(directory))) {
    add('preference', key, value, legacyPreferenceTime, preferenceTime);
  }
  return result;
}

export function applyItems(directory: string, items: SyncItem[], reloadProfiles: () => void): void {
  const groups = new Map<string, SyncItem[]>();
  for (const item of items) {
    const key = item.kind === 'progress' || item.kind === 'watchlist'
      ? item.kind + ':' + item.key.split('/')[0] : item.kind;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  for (const [key, group] of groups) {
    const kind = group[0]!.kind;
    if (kind === 'profile') {
      const registry = loadProfiles(directory, Infinity);
      const rows = new Map(registry.profiles.map(row => [row.id, row]));
      for (const item of group) {
        if (item.deleted) rows.delete(item.key);
        else rows.set(item.key, item.value as Profile);
      }
      // A fresh install's empty placeholder is local until somebody uses it.
      const previous = registry.profiles[0];
      if (rows.size > 1 && registry.profiles.length === 1 && previous && untouchedProfile(previous)
        && !group.some(item => item.key === previous.id)
        && !Object.keys(readProgress(profileDir(directory, previous.id))).length
        && !readWatchlist(profileDir(directory, previous.id)).length) rows.delete(previous.id);
      const profiles = [...rows.values()].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
      if (!profiles.length) profiles.push({ ...defaultProfile(), id: 'profile-' + randomUUID() });
      const activeId = profiles.some(row => row.id === registry.activeId) ? registry.activeId
        : (profiles.find(row => !row.pin) ?? profiles[0]!).id;
      writeProfileRegistry(directory, { activeId, profiles });
      reloadProfiles();
    } else if (kind === 'preference') {
      const prefs = readSyncPrefs(directory);
      for (const item of group) {
        if (item.deleted) delete prefs[item.key];
        else prefs[item.key] = item.value;
      }
      saveSyncPrefs(directory, prefs);
    } else {
      const scope = profileDir(directory, key.slice(key.indexOf(':') + 1));
      mkdirSync(scope, { recursive: true });
      if (kind === 'progress') {
        const progress = new Map(Object.entries(readProgress(scope)));
        for (const item of group) {
          const id = item.key.slice(item.key.indexOf('/') + 1);
          if (item.deleted) progress.delete(id);
          else progress.set(id, item.value as ProgressEntry);
        }
        writeSealed(scope, progressPath(scope), Object.fromEntries(progress));
      } else {
        const watchlist = new Map(readWatchlist(scope).map(item => [item.id, item]));
        for (const item of group) {
          const id = item.key.slice(item.key.indexOf('/') + 1);
          if (item.deleted) watchlist.delete(id);
          else watchlist.set(id, item.value as WatchlistItem);
        }
        const ordered = [...watchlist.values()].sort((a, b) => Date.parse(b.added) - Date.parse(a.added) || a.id.localeCompare(b.id));
        writeSealed(scope, watchlistPath(scope), ordered);
      }
    }
  }
}
