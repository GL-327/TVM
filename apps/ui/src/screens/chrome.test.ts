import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

function read(name: string): string {
  return readFileSync(join(dir, name), 'utf8');
}

describe('ribbon destinations match Home chrome', () => {
  it('puts the scene mesh and ribbon on Apps, Watchlist, Live, Settings, and Profile', () => {
    for (const file of ['Apps.tsx', 'Watchlist.tsx', 'LiveTV.tsx', 'LivePicks.tsx', 'Settings.tsx', 'Profile.tsx']) {
      const src = read(file);
      expect(src).toContain('PageScene');
      expect(src).toContain('<Ribbon');
    }
    expect(read('../components/PageScene.tsx')).toContain('home__scene--mesh');
  });

  it('shows Watchlist as a poster grid with real PosterCards, not a leftover Home button', () => {
    const src = read('Watchlist.tsx');
    expect(src).toContain('poster-grid');
    expect(src).toContain('<PosterCard');
    expect(src).not.toContain('watchlist-home');
    expect(src).not.toContain("layout=\"landscape\"");
  });

  it('turns Profile into a device hub instead of a Household stub', () => {
    const src = read('Profile.tsx');
    expect(src).toContain('fetchProfiles');
    expect(src).toContain('switchProfile');
    expect(src).toContain('Stream profiles');
    expect(src).toContain('id="realdebrid"');
    expect(src).not.toContain('Household');
  });
});

describe('nested TopBar', () => {
  it('is Back plus title, not a second Library/Search/Household dock', () => {
    const src = read('../components/TopBar.tsx');
    expect(src).toContain('id="top-back"');
    expect(src).toContain('navigate.pop()');
    expect(src).not.toContain('enterTvmStream');
    expect(src).not.toContain('Household');
    expect(src).not.toContain('Library');
  });
});

describe('Settings list movement', () => {
  it('moves Settings rows as a column without trapping the D-pad', () => {
    expect(read('Settings.tsx')).toContain('data-wrap="y"');
    expect(read('Settings.tsx')).toContain('settings-list');
    const wrap = read('../nav/wrapFocus.ts');
    expect(wrap).toContain("token === 'settings-list'");
    expect(wrap).toContain('if (index === 0) return null;');
  });
});
