import { describe, expect, it } from 'vitest';
import { clampBoostVolume, volumeGainSplit } from './audioGain';
import { clampVolume } from './audioPrefs';
import { VOLUME_STEP, volumeFromClientX } from './features/VolumeControl';
import {
  effectiveStreamMaxHeight,
  screenTargetHeight,
  selectBestHlsLevelIndex,
  snapUpToQualityLadder,
} from './quality';
import {
  clampOrbitMultiplier,
  formatOrbitStatus,
  ORBIT_MAX_SPEED_MULT,
  ORBIT_MIN_SPEED_MULT,
  speedMultiplierFromRate,
  stepCriticallyDamped,
} from '../components/OrbitLoader';

describe('F3 volume boost gain mapping', () => {
  it('clamps and persists up to 200%', () => {
    expect(clampVolume(1.5)).toBe(1.5);
    expect(clampVolume(2.5)).toBe(2);
    expect(clampVolume(-0.5)).toBe(0);
    expect(clampBoostVolume(1.5)).toBe(1.5);
    expect(VOLUME_STEP).toBe(0.1);
  });

  it('maps drag position across 0–200% with 100% at midpoint', () => {
    const rect = { left: 100, width: 200 };
    expect(volumeFromClientX(100, rect, 2)).toBe(0);
    expect(volumeFromClientX(200, rect, 2)).toBe(1);
    expect(volumeFromClientX(300, rect, 2)).toBe(2);
  });

  it('splits element volume [0, 1] and gain [1, 2] cleanly', () => {
    expect(volumeGainSplit(0.6, false, true)).toEqual({ elementVolume: 0.6, gainValue: 1, effectiveVolume: 0.6 });
    expect(volumeGainSplit(1.5, false, true)).toEqual({ elementVolume: 1, gainValue: 1.5, effectiveVolume: 1.5 });
    expect(volumeGainSplit(1.5, false, false)).toEqual({ elementVolume: 1, gainValue: 1, effectiveVolume: 1 });
    expect(volumeGainSplit(1.5, true, true)).toEqual({ elementVolume: 0, gainValue: 1, effectiveVolume: 0 });
  });
});

describe('F4 HLS screen-height quality ladder', () => {
  it('snaps physical display heights up to the nearest ladder step', () => {
    expect(snapUpToQualityLadder(720)).toBe(720);
    expect(snapUpToQualityLadder(900)).toBe(1080);
    expect(screenTargetHeight(1080, 1)).toBe(1080);
    expect(screenTargetHeight(1080, 1.25)).toBe(1440);
    expect(screenTargetHeight(1440, 1)).toBe(1440);
    expect(screenTargetHeight(1170, 3)).toBe(2160);
    expect(effectiveStreamMaxHeight(1080, 2160)).toBe(1080);
  });

  it('picks the highest HLS level fitting maxHeight with bitrate tiebreak', () => {
    const levels = [
      { height: 720, bitrate: 2_000_000 },
      { height: 1080, bitrate: 4_000_000 },
      { height: 1080, bitrate: 8_000_000 },
      { height: 2160, bitrate: 18_000_000 },
    ];
    expect(selectBestHlsLevelIndex(levels, 1080)).toBe(2);
    expect(selectBestHlsLevelIndex(levels, 720)).toBe(0);
    expect(selectBestHlsLevelIndex(levels, 2160)).toBe(3);
  });
});

describe('F5 OrbitLoader physics & stages', () => {
  it('clamps speed multiplier between 0.35x and 2.4x', () => {
    expect(clampOrbitMultiplier(0.1)).toBe(ORBIT_MIN_SPEED_MULT);
    expect(clampOrbitMultiplier(5)).toBe(ORBIT_MAX_SPEED_MULT);
    expect(speedMultiplierFromRate(0)).toBe(ORBIT_MIN_SPEED_MULT);
    expect(speedMultiplierFromRate(10_000_000)).toBe(ORBIT_MAX_SPEED_MULT);
  });

  it('critically damps speed towards target without NaN', () => {
    let val = 0.5;
    let vel = 0;
    for (let i = 0; i < 30; i += 1) {
      ({ value: val, velocity: vel } = stepCriticallyDamped(val, vel, 2.0, 0.016));
    }
    expect(val).toBeGreaterThan(1.7);
    expect(val).toBeLessThanOrEqual(2.05);
  });

  it('formats expected status copy', () => {
    expect(formatOrbitStatus('finding', 0.1)).toBe('Finding the best stream');
    expect(formatOrbitStatus('connecting', 0.3)).toBe('Connecting');
    expect(formatOrbitStatus('buffering', 0.42)).toBe('Buffering 42%');
  });
});
