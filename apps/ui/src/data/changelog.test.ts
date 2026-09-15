import { describe, expect, it } from 'vitest';
import { pendingChangelog, parseChangelogRecord, rememberPendingChangelog } from './changelog';

describe('changelog', () => {
  it('only presents a pending record that has entries', () => {
    expect(
      pendingChangelog(
        parseChangelogRecord({
          pending: true,
          version: 'bbb222c',
          entries: [{ title: 'Fix player chrome' }],
        }),
      )?.version,
    ).toBe('bbb222c');
    expect(
      pendingChangelog(
        parseChangelogRecord({
          pending: false,
          version: 'bbb222c',
          entries: [{ title: 'Fix player chrome' }],
        }),
      ),
    ).toBeNull();
  });

  it('stores notes as a single entry when GitHub sent no commit list', () => {
    const record = rememberPendingChangelog({ version: 'bbb222c', notes: 'Fix player chrome' });
    expect(record?.entries[0]?.title).toBe('Fix player chrome');
    expect(record?.pending).toBe(true);
  });
});
