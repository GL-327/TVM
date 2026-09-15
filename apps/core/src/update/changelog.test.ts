import { describe, expect, it } from 'vitest';
import {
  entriesFromGithubCommits,
  entriesFromReleaseNotes,
  notesFromEntries,
  parseChangelogRecord,
  parseCommitMessage,
  pendingChangelog,
  sameCommit,
  shouldSkipCommitTitle,
} from './changelog.ts';

describe('changelog', () => {
  it('keeps the first line as the title and drops merge commits', () => {
    expect(parseCommitMessage('Fix player chrome\n\nMore detail')).toEqual({
      title: 'Fix player chrome',
      body: 'More detail',
    });
    expect(shouldSkipCommitTitle('Merge pull request #12 from a/b')).toBe(true);
    expect(shouldSkipCommitTitle('Merge branch main')).toBe(true);
    expect(shouldSkipCommitTitle('Fix player chrome')).toBe(false);
    expect(sameCommit('abcdef123', 'abcdef')).toBe(true);
  });

  it('collects GitHub commits until the current SHA', () => {
    const entries = entriesFromGithubCommits(
      [
        { sha: 'bbb222ccc', commit: { message: 'Fix player chrome\n\nSafe areas', committer: { date: '2026-09-14T12:00:00Z' } } },
        { sha: 'ccc333ddd', commit: { message: 'Merge pull request #1' } },
        { sha: 'ddd444eee', commit: { message: 'Add English default' } },
        { sha: 'aaa111000', commit: { message: 'Old build' } },
      ],
      'aaa111',
    );
    expect(entries.map((entry) => entry.title)).toEqual(['Fix player chrome', 'Add English default']);
    expect(entries[0]?.body).toBe('Safe areas');
    expect(notesFromEntries(entries)).toContain('Fix player chrome');
  });

  it('parses release-note bullets and pending records', () => {
    expect(entriesFromReleaseNotes('## Notes\n- Safe areas\n- Auto update\n', '1.2.0').map((entry) => entry.title)).toEqual([
      'Safe areas',
      'Auto update',
    ]);
    const pending = parseChangelogRecord({
      pending: true,
      version: 'bbb222c',
      entries: [{ sha: 'bbb222c', title: 'Fix player chrome', body: '', date: null }],
    });
    expect(pendingChangelog(pending)?.version).toBe('bbb222c');
    expect(pendingChangelog({ ...pending!, pending: false })).toBeNull();
  });
});
