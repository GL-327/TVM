import { describe, expect, it } from 'vitest';
import {
  detectRuntimePlatform,
  filterChangesForPlatform,
  pendingChangelog,
  parseChangelogRecord,
  rememberPendingChangelog,
  shortReleaseLabel,
  shouldShowReleaseCornerCard,
} from './changelog';
import { getChangelogContent } from './content';

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

  it('tracks release seen version and filters platform-only lines from changelog.json', () => {
    expect(shortReleaseLabel('1.1.0')).toBe('1.1');
    expect(shouldShowReleaseCornerCard(null, '1.1.0')).toBe(true);
    expect(shouldShowReleaseCornerCard('1.0.0', '1.1.0')).toBe(true);
    expect(shouldShowReleaseCornerCard('1.1.0', '1.1.0')).toBe(false);

    const bundled = getChangelogContent();
    expect(bundled.releases.length).toBeGreaterThan(0);
    const sampleChanges = [
      { area: 'Look', text: 'Glass redone to match iOS 27.' },
      { area: 'Roku', text: 'TVM on Roku checks for updates.', platforms: ['roku'] },
      { area: 'Windows', text: 'Native Win32 update check.', platforms: ['windows'] },
    ];
    const webChanges = filterChangesForPlatform(sampleChanges, 'web');
    expect(webChanges.some((c) => c.area === 'Roku')).toBe(false);
    expect(webChanges.some((c) => c.area === 'Windows')).toBe(false);
    expect(webChanges.some((c) => c.area === 'Look')).toBe(true);
    expect(detectRuntimePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)')).toBe('ios');
    expect(detectRuntimePlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
  });
});
