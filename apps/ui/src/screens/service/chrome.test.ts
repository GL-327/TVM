import { describe, expect, it } from 'vitest';
import { navTabs, playLabel } from './layouts';

describe('mock streamer chrome', () => {
  it('uses service-specific tabs and play labels', () => {
    expect(navTabs('netflix').map((tab) => tab.label)).toEqual(['Home', 'TV Shows', 'Movies', 'My List']);
    expect(navTabs('hulu')[0]?.label).toBe('For You');
    expect(navTabs('peacock').some((tab) => tab.label === 'My Stuff')).toBe(true);
    expect(playLabel('peacock')).toBe('Watch Now');
    expect(playLabel('max')).toBe('Go to Series');
  });
});
