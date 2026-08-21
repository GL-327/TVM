import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERTICAL_ROW_SELECTOR } from '../../nav/railNav';
import { SERVICE_HERO_ROW_SELECTOR, SERVICE_RAIL_CLASS, SERVICE_RAIL_SELECTOR } from './chrome';
import { laneMatches, navTabs, playLabel, moreLabel } from './layouts';

const chromeCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'chrome.css'), 'utf8');

describe('mock streamer chrome', () => {
  it('uses service-specific tabs and play labels', () => {
    expect(navTabs('netflix').map((tab) => tab.label)).toEqual(['Home', 'TV Shows', 'Movies', 'New & Popular', 'My List']);
    expect(navTabs('hulu')[0]?.label).toBe('For You');
    expect(navTabs('peacock').some((tab) => tab.label === 'My Stuff')).toBe(true);
    expect(playLabel('peacock')).toBe('Watch Now');
    expect(playLabel('max')).toBe('Play');
    expect(moreLabel('max')).toBe('Go to Series');
  });

  it('filters category lanes without dropping known titles', () => {
    const film = { kind: 'movie', year: 2024, genres: ['Action'] };
    const show = { kind: 'series', year: 2018, genres: ['Drama'] };
    const kids = { kind: 'movie', year: 2021, genres: ['Animation', 'Family'] };
    expect(laneMatches(film, 'movies')).toBe(true);
    expect(laneMatches(show, 'movies')).toBe(false);
    expect(laneMatches(show, 'shows')).toBe(true);
    expect(laneMatches(kids, 'kids')).toBe(true);
    expect(laneMatches(film, 'kids')).toBe(false);
    expect(laneMatches(film, 'new')).toBe(true);
    expect(laneMatches(show, 'new')).toBe(false);
  });

  it('owns extra space between category rows so Down can reveal the next rail', () => {
    expect(SERVICE_RAIL_CLASS).toBe('service-rail');
    expect(SERVICE_RAIL_SELECTOR).toContain('.rail');
    expect(chromeCss).toContain('.service-rail + .service-rail');
    expect(chromeCss).toContain('.service .rail + .rail');
    expect(chromeCss).toContain('.prime-hub .rail + .rail');
    expect(chromeCss).toMatch(/margin-top:\s*2\.4rem/);
    expect(chromeCss).toContain('scroll-margin-top');
  });

  it('registers every hub hero action row so Down lands on the next rail', () => {
    for (const host of SERVICE_HERO_ROW_SELECTOR.split(',').map((token) => token.trim())) {
      expect(host.length).toBeGreaterThan(0);
      expect(VERTICAL_ROW_SELECTOR).toContain(host);
    }
  });
});
