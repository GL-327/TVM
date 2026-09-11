import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { artworkCachePath } from '../update/paths.ts';
import { artworkFor, type ArtworkUrls } from './artwork.ts';
import type { MediaItem } from './types.ts';

const MAX_ENTRIES = 1_024;
const MISS_TTL_MS = 60_000;

/** Shared by one library, so episodes reuse lookups without leaking across core instances. */
export function createLibraryArtwork(dataDir: string, fetchImpl: typeof fetch) {
  const cache = new Map<string, ArtworkUrls>();
  const misses = new Map<string, number>();
  const pending = new Map<string, Promise<ArtworkUrls | null>>();
  let generation = 0;
  let dirty = false;
  const keyFor = (title: string): string => title.toLowerCase().replace(/\s+/g, ' ').trim();

  try {
    const raw: unknown = JSON.parse(readFileSync(artworkCachePath(dataDir), 'utf8'));
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [title, value] of Object.entries(raw).slice(-MAX_ENTRIES)) {
        if (value === null || typeof value !== 'object') continue;
        const art = value as Partial<ArtworkUrls>;
        if (typeof art.poster !== 'string' || typeof art.backdrop !== 'string') continue;
        if (art.poster !== '' || art.backdrop !== '') cache.set(keyFor(title), { poster: art.poster, backdrop: art.backdrop });
      }
    }
  } catch {
    // First run or a corrupt optional cache.
  }

  const lookup = async (title: string): Promise<ArtworkUrls | null> => {
    const key = keyFor(title);
    const cached = cache.get(key);
    if (cached !== undefined) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    if ((misses.get(key) ?? 0) > Date.now()) return null;
    misses.delete(key);
    const inflight = pending.get(key);
    if (inflight !== undefined) return inflight;
    const version = generation;
    const promise = artworkFor(title, fetchImpl).then((art) => {
      if (version !== generation) return art;
      if (art === null) {
        if (misses.size >= MAX_ENTRIES) misses.delete(misses.keys().next().value!);
        misses.set(key, Date.now() + MISS_TTL_MS);
      } else {
        if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
        cache.set(key, art);
        dirty = true;
      }
      return art;
    }).finally(() => {
      if (pending.get(key) === promise) pending.delete(key);
    });
    pending.set(key, promise);
    return promise;
  };

  return {
    async decorate(item: MediaItem): Promise<MediaItem> {
      const art = await lookup(item.title);
      return art === null ? item : { ...item, ...art };
    },
    /** Persist once per completed batch, instead of rewriting the file for every episode. */
    flush(): void {
      if (!dirty) return;
      try {
        const path = artworkCachePath(dataDir);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(Object.fromEntries(cache)), 'utf8');
        dirty = false;
      } catch {
        // Artwork is optional; a failed write must not break Home.
      }
    },
    clear(): void {
      generation += 1;
      cache.clear();
      pending.clear();
      misses.clear();
      dirty = false;
    },
  };
}
