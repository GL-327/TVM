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

export const CHANGELOG_LIMIT = 12;

export function sameCommit(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (a === '' || b === '') return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export function parseCommitMessage(raw: string): { title: string; body: string } {
  const text = raw.replace(/\r\n/g, '\n').trim();
  const nl = text.indexOf('\n');
  const title = (nl === -1 ? text : text.slice(0, nl)).trim().slice(0, 160);
  const body = (nl === -1 ? '' : text.slice(nl).trim()).slice(0, 600);
  return { title, body };
}

export function shouldSkipCommitTitle(title: string): boolean {
  const value = title.trim();
  if (value === '') return true;
  return /^(merge (pull request|branch)\b)/i.test(value);
}

export function entriesFromGithubCommits(commits: unknown, untilSha = '', limit = CHANGELOG_LIMIT): ChangelogEntry[] {
  if (!Array.isArray(commits)) return [];
  const until = untilSha.trim().toLowerCase();
  const entries: ChangelogEntry[] = [];
  for (const item of commits) {
    if (item === null || typeof item !== 'object') continue;
    const row = item as {
      sha?: unknown;
      commit?: { message?: unknown; committer?: { date?: unknown }; author?: { date?: unknown } };
    };
    const sha = typeof row.sha === 'string' ? row.sha : '';
    if (until !== '' && sameCommit(sha, until)) break;
    const message = typeof row.commit?.message === 'string' ? row.commit.message : '';
    const { title, body } = parseCommitMessage(message);
    if (shouldSkipCommitTitle(title)) continue;
    const date =
      (typeof row.commit?.committer?.date === 'string' ? row.commit.committer.date : null) ??
      (typeof row.commit?.author?.date === 'string' ? row.commit.author.date : null);
    entries.push({ sha: sha.slice(0, 7) || `c${entries.length}`, title, body, date });
    if (entries.length >= limit) break;
  }
  return entries;
}

export function entriesFromReleaseNotes(body: string, version: string): ChangelogEntry[] {
  const items: ChangelogEntry[] = [];
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^\s*[-*]\s+(.+)$/.exec(line);
    if (match === null) continue;
    const title = match[1]!.trim().slice(0, 160);
    if (title === '') continue;
    items.push({ sha: version, title, body: '', date: null });
    if (items.length >= CHANGELOG_LIMIT) break;
  }
  if (items.length > 0) return items;
  const parsed = parseCommitMessage(body);
  if (parsed.title === '') return [];
  return [{ sha: version, title: parsed.title, body: parsed.body, date: null }];
}

export function notesFromEntries(entries: readonly ChangelogEntry[], fallback = 'Latest GitHub main'): string {
  const titles = entries.map((entry) => entry.title.trim()).filter((title) => title !== '');
  if (titles.length === 0) return fallback;
  if (titles.length === 1) return titles[0]!;
  return titles.join(' · ').slice(0, 400);
}

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
  if (!Array.isArray(row.entries)) return null;
  const entries = row.entries.map(parseChangelogEntry).filter((entry): entry is ChangelogEntry => entry !== null);
  if (typeof row.version !== 'string' || row.version.trim() === '') return null;
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
