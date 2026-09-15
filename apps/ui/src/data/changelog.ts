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

let presentInflight: Promise<boolean> | null = null;

export async function presentPendingChangelog(pushModal: (name: string, options?: { params?: Record<string, unknown> }) => void): Promise<boolean> {
  if (presentInflight !== null) return presentInflight;
  presentInflight = (async () => {
    const pending = await loadPendingChangelog();
    if (pending === null) return false;
    if (changelogShownThisSession(pending.version)) return false;
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
