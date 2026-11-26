import { getChangelogContent, type ChangelogChange, type ChangelogRelease } from './content';

export type ChangelogPlatform = 'web' | 'desktop' | 'ios' | 'android';

export const CHANGELOG_SEEN_KEY = 'tvm.changelog.seen';

export function currentAppVersion(): string {
  return typeof __TVM_UI_VERSION__ === 'string' && __TVM_UI_VERSION__ !== '' ? __TVM_UI_VERSION__ : '1.1.0';
}

export function shortReleaseLabel(version: string): string {
  const parts = version.trim().split('.');
  if (parts.length === 3 && parts[2] === '0') {
    return `${parts[0]}.${parts[1]}`;
  }
  return version.trim();
}

export function detectRuntimePlatform(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''): ChangelogPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('desktop-shell')) {
    return 'desktop';
  }
  return 'web';
}

export function filterChangesForPlatform(
  changes: readonly ChangelogChange[],
  platform: ChangelogPlatform = detectRuntimePlatform(),
): ChangelogChange[] {
  return changes.filter((change) => change.platforms === undefined || change.platforms.includes(platform));
}

export function groupChangesByArea(
  changes: readonly ChangelogChange[],
): Array<{ area: string; items: ChangelogChange[] }> {
  const map = new Map<string, ChangelogChange[]>();
  for (const ch of changes) {
    const area = ch.area.trim() || 'Other';
    const list = map.get(area) ?? [];
    list.push(ch);
    map.set(area, list);
  }
  return [...map.entries()].map(([area, items]) => ({ area, items }));
}

export function readSeenReleaseVersion(): string | null {
  try {
    return globalThis.localStorage?.getItem(CHANGELOG_SEEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function markReleaseChangelogSeen(version = currentAppVersion()): void {
  try {
    globalThis.localStorage?.setItem(CHANGELOG_SEEN_KEY, version);
  } catch {
    // Private browsing mode fallback
  }
}

export function shouldShowReleaseCornerCard(
  seenVersion: string | null,
  installedVersion = currentAppVersion(),
): boolean {
  return seenVersion !== installedVersion;
}

export async function fetchReleaseChangelog(): Promise<{ current: string; releases: ChangelogRelease[] }> {
  const bundled = getChangelogContent();
  try {
    const res = await fetch('/api/changelog', { signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const body = (await res.json()) as { current?: string; releases?: ChangelogRelease[] };
      if (Array.isArray(body.releases) && body.releases.length > 0) {
        return {
          current: typeof body.current === 'string' && body.current !== '' ? body.current : currentAppVersion(),
          releases: body.releases,
        };
      }
    }
  } catch {
    // Fall back gracefully to bundled changelog.json.
  }
  return {
    current: currentAppVersion(),
    releases: bundled.releases,
  };
}

export interface ChangelogEntry {
  sha: string;
  title: string;
  body: string;
  date: string | null;
}

export interface ChangelogRecord {
  pending: boolean;
  version: string;
  from: string | null;
  to: string | null;
  appliedAt: string;
  entries: ChangelogEntry[];
}

export const CHANGELOG_STORAGE_KEY = 'tvm.changelog';
const SHOWN_PREFIX = 'tvm.changelog.shown.';

export function parseChangelogEntry(value: unknown): ChangelogEntry | null {
  if (value === null || typeof value !== 'object') return null;
  const row = value as { sha?: unknown; title?: unknown; body?: unknown; date?: unknown };
  if (typeof row.title !== 'string' || row.title.trim() === '') return null;
  return {
    sha: typeof row.sha === 'string' ? row.sha : '',
    title: row.title.trim().slice(0, 160),
    body: typeof row.body === 'string' ? row.body.slice(0, 600) : '',
    date: typeof row.date === 'string' ? row.date : null,
  };
}

export function parseChangelogRecord(value: unknown): ChangelogRecord | null {
  if (value === null || typeof value !== 'object') return null;
  const row = value as {
    pending?: unknown;
    version?: unknown;
    from?: unknown;
    to?: unknown;
    appliedAt?: unknown;
    entries?: unknown;
  };
  if (typeof row.version !== 'string' || row.version.trim() === '' || !Array.isArray(row.entries)) return null;
  const entries = row.entries.map(parseChangelogEntry).filter((entry): entry is ChangelogEntry => entry !== null);
  return {
    pending: row.pending === true,
    version: row.version,
    from: typeof row.from === 'string' ? row.from : null,
    to: typeof row.to === 'string' ? row.to : null,
    appliedAt: typeof row.appliedAt === 'string' ? row.appliedAt : '',
    entries,
  };
}

export function pendingChangelog(record: ChangelogRecord | null): ChangelogRecord | null {
  if (record === null || record.pending !== true || record.entries.length === 0) return null;
  return record;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberPendingChangelog(input: {
  version: string;
  from?: string | null;
  to?: string | null;
  entries?: unknown;
  notes?: string;
}): ChangelogRecord | null {
  const fromEntries = Array.isArray(input.entries)
    ? input.entries.map(parseChangelogEntry).filter((entry): entry is ChangelogEntry => entry !== null)
    : [];
  const entries =
    fromEntries.length > 0
      ? fromEntries
      : typeof input.notes === 'string' && input.notes.trim() !== ''
        ? [{ sha: input.version, title: input.notes.trim().slice(0, 160), body: '', date: null }]
        : [];
  if (entries.length === 0) return null;
  const record: ChangelogRecord = {
    pending: true,
    version: input.version,
    from: input.from ?? null,
    to: input.to ?? input.version,
    appliedAt: new Date().toISOString(),
    entries,
  };
  try {
    storage()?.setItem(CHANGELOG_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // private mode — modal can still use the in-memory record this session
  }
  return record;
}

export function readStoredChangelog(): ChangelogRecord | null {
  try {
    const raw = storage()?.getItem(CHANGELOG_STORAGE_KEY);
    if (raw === null || raw === undefined) return null;
    return parseChangelogRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export async function loadPendingChangelog(): Promise<ChangelogRecord | null> {
  try {
    const response = await fetch('/api/update/changelog');
    if (response.ok) {
      const pending = pendingChangelog(parseChangelogRecord(await response.json()));
      if (pending !== null) return pending;
    }
  } catch {
    // Core may be restarting after apply. Use the copy saved before reload.
  }
  return pendingChangelog(readStoredChangelog());
}

export function changelogShownThisSession(version: string): boolean {
  return session()?.getItem(`${SHOWN_PREFIX}${version}`) === '1';
}

export function markChangelogShownThisSession(version: string): void {
  try {
    session()?.setItem(`${SHOWN_PREFIX}${version}`, '1');
  } catch {
    // ignore quota
  }
}

export async function markChangelogSeen(): Promise<void> {
  const stored = readStoredChangelog();
  if (stored !== null) {
    try {
      storage()?.setItem(CHANGELOG_STORAGE_KEY, JSON.stringify({ ...stored, pending: false }));
    } catch {
      storage()?.removeItem(CHANGELOG_STORAGE_KEY);
    }
  }
  try {
    await fetch('/api/update/changelog/seen', { method: 'POST' });
  } catch {
    // local copy is enough if core is down
  }
}

async function hasWrittenNotes(version = currentAppVersion()): Promise<boolean> {
  try {
    return (await fetchReleaseChangelog()).releases.some((release) => release.version === version);
  } catch {
    return false;
  }
}

let presentInflight: Promise<boolean> | null = null;

export async function presentPendingChangelog(pushModal: (name: string, options?: { params?: Record<string, unknown> }) => void): Promise<boolean> {
  if (presentInflight !== null) return presentInflight;
  presentInflight = (async () => {
    const pending = await loadPendingChangelog();
    if (pending === null) return false;
    if (changelogShownThisSession(pending.version)) return false;
    // The written release notes (patch-notes pop-up or corner card) already cover this
    // version; a second sheet of raw commit titles on top of them was just noise.
    if (await hasWrittenNotes()) {
      markChangelogShownThisSession(pending.version);
      void markChangelogSeen();
      return false;
    }
    markChangelogShownThisSession(pending.version);
    pushModal('changelog', {
      params: {
        version: pending.version,
        appliedAt: pending.appliedAt,
        entries: pending.entries,
      },
    });
    return true;
  })();
  try {
    return await presentInflight;
  } finally {
    presentInflight = null;
  }
}

/** The pop-up shows once per installed version, and only when the service switch is on. */
export function shouldShowPatchNotesPopup(flag: boolean | undefined, seenVersion: string | null, installedVersion = currentAppVersion()): boolean {
  return flag === true && shouldShowReleaseCornerCard(seenVersion, installedVersion);
}
