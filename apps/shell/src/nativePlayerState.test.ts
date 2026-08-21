import { describe, expect, it } from 'vitest';
import {
  applyMpvProperty,
  initialMpvState,
  mpvBuffering,
  MPV_AUDIO_COMMANDS,
  MPV_OBSERVED_PROPERTIES,
} from './nativePlayerState';

function play(...events: Array<[string, unknown]>) {
  let state = initialMpvState();
  for (const [name, data] of events) state = applyMpvProperty(state, name, data);
  return state;
}

describe('mpv playback state', () => {
  it('buffers until mpv decodes a first frame', () => {
    expect(mpvBuffering(initialMpvState())).toBe(true);
    expect(mpvBuffering(play(['time-pos', 0.5]))).toBe(false);
  });

  it('reads a cache stall from paused-for-cache, not a percentage', () => {
    // cache-buffering-state is a 0-100 number, so the old `data === true`
    // test never matched and every stalled stream reported itself ready.
    const stalled = play(['time-pos', 12], ['paused-for-cache', true]);
    expect(mpvBuffering(stalled)).toBe(true);
    expect(mpvBuffering(applyMpvProperty(stalled, 'paused-for-cache', false))).toBe(false);
    expect(MPV_OBSERVED_PROPERTIES).toContain('paused-for-cache');
    expect(MPV_OBSERVED_PROPERTIES).not.toContain('cache-buffering-state');
  });

  it('ignores malformed property payloads instead of dropping playback', () => {
    const state = play(['time-pos', 30], ['duration', 1800], ['pause', true]);
    const noisy = applyMpvProperty(applyMpvProperty(state, 'time-pos', null), 'duration', 'soon');
    expect(noisy.position).toBe(30);
    expect(noisy.duration).toBe(1800);
    expect(noisy.paused).toBe(true);
    expect(noisy.ended).toBe(false);
  });

  it('resumes from a saved position without claiming a frame arrived', () => {
    const resumed = initialMpvState(420);
    expect(resumed.position).toBe(420);
    expect(mpvBuffering(resumed)).toBe(true);
  });

  it('ends only on eof-reached', () => {
    expect(play(['eof-reached', false]).ended).toBe(false);
    expect(play(['eof-reached', true]).ended).toBe(true);
  });

  it('unmutes mpv so a fallback from a silent HTML5 stream has sound', () => {
    expect(MPV_AUDIO_COMMANDS).toContainEqual(['set_property', 'mute', false]);
    expect(MPV_AUDIO_COMMANDS).toContainEqual(['set_property', 'volume', 100]);
  });
});
