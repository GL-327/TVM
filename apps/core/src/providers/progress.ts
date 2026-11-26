import { syncStoreChanged } from '../sync/storeEvents.ts';
import { progressPath } from '../update/paths.ts';
import { readPrivateJson } from './privateJson.ts';
import { writeSealed } from './vault.ts';

export interface ProgressEntry {
  position: number;
  duration: number;
  updated: string;
  hiddenFromContinueWatching?: boolean;
  completedAt?: string;
  completions?: number;
  completedTitle?: string;
  completedYear?: number | null;
}

export type ProgressMap = Record<string, ProgressEntry>;

export function readProgress(dataDir: string): ProgressMap {
  try {
    return readPrivateJson<ProgressMap>(dataDir, progressPath(dataDir)) ?? {};
  } catch {
    return {};
  }
}

export function writeProgress(dataDir: string, id: string, position: number, duration: number): ProgressMap {
  const all = readProgress(dataDir);
  const previous = Object.hasOwn(all, id) ? all[id] : undefined;
  const updated = new Date().toISOString();
  const finished = isFinished({ position, duration });
  const firstCrossing = finished && !isFinished(previous);
  Object.defineProperty(all, id, { configurable: true, enumerable: true, writable: true, value: { ...previous, position, duration, updated, hiddenFromContinueWatching: false,
    ...(finished ? { completedAt: firstCrossing ? updated : previous?.completedAt ?? updated } : {}),
    completions: (previous?.completions ?? (previous?.completedAt || isFinished(previous) ? 1 : 0)) + (firstCrossing ? 1 : 0),
  } });
  save(dataDir, all);
  return all;
}

function save(dataDir: string, progress: ProgressMap): void {
  writeSealed(dataDir, progressPath(dataDir), progress);
  syncStoreChanged(dataDir);
}

export function removeContinueWatching(dataDir: string, id: string): void {
  const all = readProgress(dataDir);
  let changed = false;
  for (const [key, entry] of Object.entries(all)) {
    if ((key === id || key.startsWith(id + ':')) && !entry.hiddenFromContinueWatching && !isFinished(entry)) {
      entry.hiddenFromContinueWatching = true;
      entry.updated = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) save(dataDir, all);
}

export function setWatched(dataDir: string, id: string, watched: boolean): void {
  const all = readProgress(dataDir);
  const old = Object.hasOwn(all, id) ? all[id] : undefined;
  if (watched) {
    if (isFinished(old)) return;
    const duration = old?.duration && old.duration > 0 ? old.duration : 1;
    writeProgress(dataDir, id, duration, duration);
  } else if (old) {
    const { completedAt: _at, completedTitle: _title, completedYear: _year, ...history } = old;
    all[id] = { ...history, position: 0, updated: new Date().toISOString() };
    save(dataDir, all);
  }
}

export function isFinished(entry: { position: number; duration: number } | undefined): boolean {
  return !!entry && Number.isFinite(entry.position) && Number.isFinite(entry.duration) && entry.duration > 0 && entry.position / entry.duration > 0.96;
}

export function ratio(entry: ProgressEntry | undefined): number | undefined {
  if (entry === undefined || entry.duration < 60 || entry.position < 30) return undefined;
  const value = entry.position / entry.duration;
  if (value > 0.96) return undefined;
  return Math.min(1, Math.max(0, value));
}

export function resumePosition(entry: ProgressEntry | undefined): number | undefined {
  const value = ratio(entry);
  if (value === undefined || entry === undefined) return undefined;
  return entry.position;
}

export function pickContinueWatching<T extends { id: string; title: string; showTitle?: string; progress?: number }>(
  library: readonly T[],
  progress: ProgressMap,
): T[] {
  const ranked = library
    .filter((item) => item.progress !== undefined)
    .sort((left, right) => (progress[right.id]?.updated ?? '').localeCompare(progress[left.id]?.updated ?? ''));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of ranked) {
    const key = (item.showTitle ?? item.title).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 16) break;
  }
  return out;
}

/** Preserve names after catalog rotation; only confirmed completed entries can be archived. */
export function finishedTitles(dataDir: string, items: readonly { id: string; title: string; year: number | null }[], progress: ProgressMap): Array<{ id: string; title: string; year: number | null }> {
  const current = readProgress(dataDir);
  let changed = false;
  const byId = new Map(items.map(item => [item.id, item]));
  for (const [id, entry] of Object.entries(progress)) {
    if ((!isFinished(entry) && !entry.completedAt) || entry.completedTitle) continue;
    let key = id;
    while (!byId.has(key) && key.includes(':')) key = key.slice(0, key.lastIndexOf(':'));
    const item = byId.get(key);
    if (!item) continue;
    const episode = id.slice(key.length).replace(/^:/, '');
    const latest = Object.hasOwn(current, id) ? current[id] : undefined;
    if (!latest || JSON.stringify(latest) !== JSON.stringify(entry)) continue;
    entry.completedTitle = latest.completedTitle = episode ? `${item.title} · episode ${episode}` : item.title;
    entry.completedYear = latest.completedYear = item.year;
    entry.completedAt = latest.completedAt = entry.completedAt ?? entry.updated;
    changed = true;
  }
  if (changed) save(dataDir, current);
  return Object.entries(progress).filter(([,entry]) => !!entry.completedTitle && (isFinished(entry) || !!entry.completedAt))
    .sort(([,a],[,b]) => (b.completedAt ?? b.updated).localeCompare(a.completedAt ?? a.updated))
    .map(([id,entry]) => ({ id, title: entry.completedTitle!, year: entry.completedYear ?? null }));
}
