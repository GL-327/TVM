import { parseChangelogEntry, sameCommit, type ChangelogEntry } from './changelog.ts';

/**
 * The update feed: one small manifest per channel, published next to the
 * bundle it describes.
 *
 * Every earlier check compared the running build with the tip of `main`. That
 * is not what gets published — a commit that touches only docs or the desktop
 * launchers moves `main` without producing a new phone bundle — so the phones
 * saw "update available" forever, downloaded the same bundle on every launch,
 * reloaded, and saw it again. The desktop asked for `releases/latest`, which
 * GitHub resolves to whichever platform release was *created* last (the iOS
 * one), and so never saw anything.
 *
 * The manifest fixes both by saying exactly what was built: the commit, the
 * asset and its checksum, which native build it needs, and the changelog up to
 * that commit. It is fetched from the release download host, which has no API
 * rate limit and needs no token for a public repository.
 */

export const FEED_SCHEMA = 1;

/** Stable release tags, rebuilt in place on every push to main. */
/**
 * The release each platform's update feed is published to. These are not the
 * download pages: `desktop`, `ios`, `android` and `roku` hold one file each,
 * for people, and the feeds sit beside them.
 */
export const FEED_TAGS = {
  desktop: 'desktop-ui',
  ios: 'ios-ui',
  android: 'android-ui',
} as const;

export const DESKTOP_MANIFEST = 'desktop.json';

export interface FeedManifest {
  schema: number;
  channel: string;
  /** Full commit the bundle was built from. */
  commit: string;
  version: string;
  builtAt: string;
  /** File name of the bundle in the same release. */
  asset: string;
  sha256: string;
  size: number;
  /**
   * Lowest native build able to run this bundle. Always 0 for the desktop,
   * where Core and the interface ship together.
   */
  nativeApi: number;
  /** Hash of the bundle's files without its stamp; equal hashes are the same bundle. */
  contentHash: string;
  /** Changes to this channel, newest first, up to and including `commit`. */
  entries: ChangelogEntry[];
  /** Every recent commit on main, newest first, short form. */
  history: string[];
}

const HEX_SHA = /^[0-9a-f]{7,40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const ASSET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function parseFeedManifest(value: unknown): FeedManifest | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const commit = typeof row['commit'] === 'string' ? row['commit'].trim() : '';
  const asset = typeof row['asset'] === 'string' ? row['asset'].trim() : '';
  const sha256 = typeof row['sha256'] === 'string' ? row['sha256'].trim().toLowerCase() : '';
  if (!HEX_SHA.test(commit) || !ASSET.test(asset) || !SHA256.test(sha256)) return null;
  const entries = Array.isArray(row['entries'])
    ? row['entries'].map(parseChangelogEntry).filter((entry): entry is ChangelogEntry => entry !== null)
    : [];
  const size = typeof row['size'] === 'number' && Number.isFinite(row['size']) ? Math.max(0, Math.floor(row['size'])) : 0;
  const nativeApi = typeof row['nativeApi'] === 'number' && Number.isFinite(row['nativeApi']) ? Math.max(0, Math.floor(row['nativeApi'])) : 0;
  const contentHash = typeof row['contentHash'] === 'string' && SHA256.test(row['contentHash']) ? row['contentHash'].toLowerCase() : '';
  const history = Array.isArray(row['history'])
    ? row['history'].filter((sha): sha is string => typeof sha === 'string' && HEX_SHA.test(sha)).map((sha) => sha.toLowerCase())
    : [];
  return {
    schema: typeof row['schema'] === 'number' ? row['schema'] : FEED_SCHEMA,
    channel: typeof row['channel'] === 'string' ? row['channel'] : '',
    commit: commit.toLowerCase(),
    version: typeof row['version'] === 'string' ? row['version'] : '',
    builtAt: typeof row['builtAt'] === 'string' ? row['builtAt'] : '',
    asset,
    sha256,
    size,
    nativeApi,
    contentHash,
    entries,
    history,
  };
}

/**
 * What changed between the running build and the published one.
 *
 * Entries are newest first; everything above the running commit is new. When
 * the running commit is not in the list at all — an install many builds old,
 * or a build with no recorded commit — the whole list is shown rather than
 * nothing, because "something changed" is true and an empty list is not.
 */
export function entriesSince(entries: readonly ChangelogEntry[], current: string | null, limit = 12): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  for (const entry of entries) {
    if (current !== null && current !== '' && entry.sha !== '' && sameCommit(entry.sha, current)) break;
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * What changed between the running build and this manifest.
 *
 * The history knows every commit, so the running build is found even when it
 * changed nothing this channel displays; only the entries above it are new.
 * Without a history (or without the running commit in it) this falls back to
 * walking the entries themselves.
 */
export function changesSince(manifest: FeedManifest, current: string | null, limit = 12): ChangelogEntry[] {
  if (current === null || current === '') return manifest.entries.slice(0, limit);
  const at = manifest.history.findIndex((sha) => sameCommit(sha, current));
  if (at === -1) return entriesSince(manifest.entries, current, limit);
  const newer = manifest.history.slice(0, at);
  return manifest.entries.filter((entry) => newer.some((sha) => sameCommit(sha, entry.sha))).slice(0, limit);
}

/** True when `current` appears in the published history, i.e. it is not newer than the feed. */
export function feedIncludes(manifest: FeedManifest, current: string): boolean {
  return sameCommit(manifest.commit, current)
    || manifest.history.some((sha) => sameCommit(sha, current))
    || manifest.entries.some((entry) => entry.sha !== '' && sameCommit(entry.sha, current));
}

export function releaseDownloadUrl(repo: string, tag: string, file: string): string {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
}

export function shortCommit(commit: string | null | undefined): string {
  return typeof commit === 'string' ? commit.trim().slice(0, 7) : '';
}
