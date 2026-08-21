import { describe, expect, it } from 'vitest';
import { absolutePosition, attachKindFor, displayDuration, withinSessionWindow } from './engine';

describe('attach kind', () => {
  it('routes by explicit transport first', () => {
    expect(attachKindFor({ mimeType: 'video/mp4', url: '/api/stream/hls/a/index.m3u8', transport: 'hls-session' }, false)).toBe('hls');
    expect(attachKindFor({ mimeType: 'video/mp2t', url: '/api/live/stream/x', transport: 'ts-live' }, true)).toBe('ts-live');
    expect(attachKindFor({ mimeType: 'video/mp4', url: '/api/stream/direct/tok', transport: 'direct' }, false)).toBe('file');
  });

  it('falls back to mime and extension sniffing for older payloads', () => {
    expect(attachKindFor({ mimeType: 'application/vnd.apple.mpegurl', url: 'https://x/y' }, false)).toBe('hls');
    expect(attachKindFor({ mimeType: '', url: 'https://x/y.m3u8?token=1' }, false)).toBe('hls');
    expect(attachKindFor({ mimeType: 'video/mp2t', url: 'https://x/y' }, true)).toBe('ts-live');
    expect(attachKindFor({ mimeType: 'video/mp2t', url: 'https://x/y' }, false)).toBe('file');
    expect(attachKindFor({ mimeType: 'video/mp4', url: 'https://x/y.mp4' }, false)).toBe('file');
  });
});

describe('session time mapping', () => {
  it('adds the session offset to element time', () => {
    expect(absolutePosition(12.5, 600)).toBe(612.5);
    expect(absolutePosition(-1, 0)).toBe(0);
  });

  it('prefers the probed duration over a growing element duration', () => {
    expect(displayDuration(5400, 90, 600)).toBe(5400);
    expect(displayDuration(undefined, 90, 600)).toBe(690);
    expect(displayDuration(undefined, Number.NaN, 600)).toBe(0);
  });

  it('only seeks inside what ffmpeg has produced', () => {
    expect(withinSessionWindow(650, 600, 120)).toBe(true);
    expect(withinSessionWindow(590, 600, 120)).toBe(false);
    expect(withinSessionWindow(900, 600, 120)).toBe(false);
  });
});
