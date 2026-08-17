import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { progressPath } from '../update/paths.ts';

export interface ProgressEntry {
  position: number;
  duration: number;
  updated: string;
}

export type ProgressMap = Record<string, ProgressEntry>;

export function readProgress(dataDir: string): ProgressMap {
  try {
    return JSON.parse(readFileSync(progressPath(dataDir), 'utf8')) as ProgressMap;
  } catch {
    return {};
  }
}

export function writeProgress(dataDir: string, id: string, position: number, duration: number): ProgressMap {
  const all = readProgress(dataDir);
  all[id] = { position, duration, updated: new Date().toISOString() };
  mkdirSync(dirname(progressPath(dataDir)), { recursive: true });
  writeFileSync(progressPath(dataDir), JSON.stringify(all));
  return all;
}

export function ratio(entry: ProgressEntry | undefined): number | undefined {
  if (entry === undefined || entry.duration < 60 || entry.position < 30) return undefined;
  const value = entry.position / entry.duration;
  if (value < 0.04 || value > 0.96) return undefined;
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
