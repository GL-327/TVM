import { describe, expect, it, vi } from 'vitest';
import {
  applyAbsoluteSeek,
  BAR_NUDGE_MIN_SECONDS,
  barNudgeSeconds,
  clampTime,
  nudgeTime,
} from './ProgressBar';

describe('bar scrub math', () => {
  it('nudges by a slice of duration, never a 10s skip on a long title', () => {
    expect(barNudgeSeconds(100)).toBe(BAR_NUDGE_MIN_SECONDS);
    expect(barNudgeSeconds(2_000)).toBe(30);
    expect(nudgeTime(40, 1, 2_000)).toBe(70);
    expect(nudgeTime(4, -1, 2_000)).toBe(0);
    expect(nudgeTime(1_990, 1, 2_000)).toBe(2_000);
  });

  it('clamps a preview against duration', () => {
    expect(clampTime(-4, 120)).toBe(0);
    expect(clampTime(80, 120)).toBe(80);
    expect(clampTime(400, 120)).toBe(120);
  });
});

describe('applyAbsoluteSeek', () => {
  it('prefers onSeek so the player engine owns the jump', () => {
    const video = { currentTime: 12 } as HTMLVideoElement;
    const onSeek = vi.fn();
    expect(applyAbsoluteSeek(55, { duration: 120, onSeek, video, engine: 'html5' })).toBe(55);
    expect(onSeek).toHaveBeenCalledWith(55);
    expect(video.currentTime).toBe(12);
  });

  it('does not write an empty native video element', () => {
    const video = { currentTime: 0 } as HTMLVideoElement;
    const seekTo = vi.fn();
    vi.stubGlobal('window', { tvmNativePlayer: { seekTo } });
    expect(applyAbsoluteSeek(90, { duration: 200, video, engine: 'native' })).toBe(90);
    expect(video.currentTime).toBe(0);
    expect(seekTo).toHaveBeenCalledWith(90);
    vi.unstubAllGlobals();
  });
});
