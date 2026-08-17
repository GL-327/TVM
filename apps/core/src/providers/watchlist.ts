import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { watchlistPath } from '../update/paths.ts';
import type { MediaItem } from './types.ts';

const MAX_ITEMS = 200;

export type WatchlistItem = MediaItem & { added: string };

function asItem(value: unknown): WatchlistItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Partial<WatchlistItem>;
  if (typeof item.id !== 'string' || item.id.trim() === '') return null;
  if (typeof item.title !== 'string' || item.title.trim() === '') return null;
  return {
    id: item.id,
    title: item.title,
    year: typeof item.year === 'number' ? item.year : null,
    kind: item.kind === 'series' || item.kind === 'file' ? item.kind : 'movie',
    synopsis: typeof item.synopsis === 'string' ? item.synopsis : '',
    poster: typeof item.poster === 'string' ? item.poster : '',
    backdrop: typeof item.backdrop === 'string' ? item.backdrop : '',
    genres: Array.isArray(item.genres) ? item.genres.filter((entry): entry is string => typeof entry === 'string') : [],
    rating: typeof item.rating === 'string' ? item.rating : '',
    playable: item.playable === true,
    hue: typeof item.hue === 'number' ? item.hue : 220,
    added: typeof item.added === 'string' ? item.added : new Date().toISOString(),
  };
}

export function readWatchlist(dataDir: string): WatchlistItem[] {
  try {
    const parsed = JSON.parse(readFileSync(watchlistPath(dataDir), 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(asItem).filter((item): item is WatchlistItem => item !== null);
  } catch {
    return [];
  }
}

function persist(dataDir: string, items: WatchlistItem[]): WatchlistItem[] {
  mkdirSync(dirname(watchlistPath(dataDir)), { recursive: true });
  writeFileSync(watchlistPath(dataDir), JSON.stringify(items.slice(0, MAX_ITEMS)));
  return items;
}

export function addWatchlist(dataDir: string, item: unknown): WatchlistItem[] {
  const next = asItem(item);
  if (next === null) return readWatchlist(dataDir);
  const current = readWatchlist(dataDir).filter((entry) => entry.id !== next.id);
  return persist(dataDir, [{ ...next, added: new Date().toISOString() }, ...current]);
}

export function removeWatchlist(dataDir: string, id: string): WatchlistItem[] {
  return persist(
    dataDir,
    readWatchlist(dataDir).filter((entry) => entry.id !== id),
  );
}
