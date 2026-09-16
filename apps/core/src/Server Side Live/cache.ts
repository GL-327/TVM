/**
 * A short memory cache in front of the provider.
 *
 * Live HLS is the same few requests over and over: every player on the LAN
 * re-fetches the same media playlist every target-duration, and the four
 * clients in a household asking a panel for the same manifest four times a
 * second is how a subscription gets rate-limited. Holding a manifest for a
 * couple of seconds removes almost all of that.
 *
 * The TTLs are short on purpose and the manifest one is the important one. A
 * live media playlist is a sliding window; serving one that is ten seconds
 * stale hands the player segments that have already rolled out of the window,
 * and it stalls. Two seconds is below the shortest target duration in normal
 * use, so a cached manifest is never a manifest the player has not already
 * been told to wait for.
 *
 * Segments are immutable once published, so they may be held longer — but only
 * small ones. Caching a full-bitrate segment would trade the RAM this box has
 * for latency it does not need, and a 20MB segment evicts fifty manifests.
 */

export interface CacheEntry {
  body: Uint8Array;
  contentType: string;
  expires: number;
}

export interface CacheOptions {
  /** Milliseconds a manifest stays fresh. Keep below the target duration. */
  manifestTtlMs: number;
  /** Milliseconds a segment stays fresh. Segments are immutable, so longer. */
  segmentTtlMs: number;
  /** Largest body worth holding, in bytes. */
  maxEntryBytes: number;
  /** Total budget across every entry, in bytes. */
  maxTotalBytes: number;
}

export const DEFAULT_CACHE: CacheOptions = {
  manifestTtlMs: 2_000,
  segmentTtlMs: 30_000,
  maxEntryBytes: 4 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
};

function positive(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Cache sizing from the environment.
 *
 * Off is a supported setting: TVM_LIVE_CACHE=off disables it entirely, which
 * is the first thing to try when a channel behaves oddly, because a cache is
 * always the first suspect in "it played a minute ago".
 */
export function cacheOptions(env: NodeJS.ProcessEnv = process.env): CacheOptions | null {
  if ((env['TVM_LIVE_CACHE'] ?? '').trim().toLowerCase() === 'off') return null;
  return {
    manifestTtlMs: positive(env['TVM_LIVE_CACHE_MANIFEST_MS'], DEFAULT_CACHE.manifestTtlMs),
    segmentTtlMs: positive(env['TVM_LIVE_CACHE_SEGMENT_MS'], DEFAULT_CACHE.segmentTtlMs),
    maxEntryBytes: positive(env['TVM_LIVE_CACHE_ENTRY_BYTES'], DEFAULT_CACHE.maxEntryBytes),
    maxTotalBytes: positive(env['TVM_LIVE_CACHE_TOTAL_BYTES'], DEFAULT_CACHE.maxTotalBytes),
  };
}

export class LiveCache {
  private readonly entries = new Map<string, CacheEntry>();
  private bytes = 0;

  constructor(
    private readonly options: CacheOptions = DEFAULT_CACHE,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): CacheEntry | null {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    if (entry.expires <= this.now()) {
      this.drop(key);
      return null;
    }
    // Re-insert so iteration order is least-recently-used first.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  put(key: string, body: Uint8Array, contentType: string, playlist: boolean): void {
    if (body.byteLength === 0 || body.byteLength > this.options.maxEntryBytes) return;
    const ttl = playlist ? this.options.manifestTtlMs : this.options.segmentTtlMs;
    if (ttl <= 0) return;
    this.drop(key);
    this.entries.set(key, { body, contentType, expires: this.now() + ttl });
    this.bytes += body.byteLength;
    this.evict();
  }

  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    this.entries.delete(key);
    this.bytes -= entry.body.byteLength;
  }

  private evict(): void {
    for (const key of this.entries.keys()) {
      if (this.bytes <= this.options.maxTotalBytes) return;
      this.drop(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  /** Bytes held and entry count, for the diagnostics route. Never contents. */
  stats(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.bytes };
  }
}

/**
 * Ranged requests are deliberately not cached.
 *
 * A Range response is a window into a body, and keying a cache by URL alone
 * would serve one client's window to another client asking for a different
 * one. Seeking would return the wrong bytes, which is far worse than a cache
 * miss.
 */
export function cacheable(method: string, range: string | undefined): boolean {
  return method === 'GET' && (range === undefined || range === '');
}
