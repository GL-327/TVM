import { describe, expect, it } from 'vitest';
import {
  isLivePlayback,
  LIVE_OVERLAY_CHROME,
  liveOverlayPolicy,
  livePlayerParams,
  liveTitleBadges,
} from './LiveOverlay';

describe('live overlay flag', () => {
  it('keeps back and channel name, and never skip-recap', () => {
    expect(LIVE_OVERLAY_CHROME.back).toBe(true);
    expect(LIVE_OVERLAY_CHROME.channelName).toBe(true);
    expect(LIVE_OVERLAY_CHROME.skipRecap).toBe(false);
  });

  it('detects live channel ids only', () => {
    expect(isLivePlayback('live:mock:sky-sports')).toBe(true);
    expect(isLivePlayback('live:a1b2c3')).toBe(true);
    expect(isLivePlayback('tt0111161')).toBe(false);
    expect(isLivePlayback('')).toBe(false);
  });

  it('opens the shared player with the channel name as the title', () => {
    expect(livePlayerParams({ id: 'live:mock:usa-network', name: 'USA Network' })).toEqual({
      id: 'live:mock:usa-network',
      title: 'USA Network',
    });
  });

  it('turns off VOD-only overlay extras for live', () => {
    expect(liveOverlayPolicy('live:mock:sky-sports', true)).toEqual({
      live: true,
      skipRecap: false,
      persistProgress: false,
      queue: false,
      ads: false,
    });
    expect(liveOverlayPolicy('tt0111161', true).skipRecap).toBe(true);
    expect(liveOverlayPolicy('tt0111161', false).skipRecap).toBe(false);
  });

  it('prefixes Live on the title badges without duplicating it', () => {
    expect(liveTitleBadges(['4K', 'Live', 'HDR'])).toEqual(['Live', '4K', 'HDR']);
    expect(liveTitleBadges([])).toEqual(['Live']);
  });
});
