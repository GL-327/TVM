import { describe, expect, it } from 'vitest';
import { bufferAhead, estimatedBitrate, formatStats, sleepDeadline, sleepFadeFactor, sleepShouldStart } from './extrasLogic';
import type { Version } from '../data/playbackVersions';

describe('sleep timer scheduling', () => {
  it('uses a wall-clock deadline for each minute choice and no deadline for Off or end', () => {
    for (const choice of ['15', '30', '45', '60'] as const) expect(sleepDeadline(choice, 100)).toBe(100 + Number(choice) * 60_000);
    expect(sleepDeadline('off', 100)).toBeNull();
    expect(sleepDeadline('end', 100)).toBeNull();
    expect(sleepShouldStart('15', 900_000, 899_999, 0, 0, true)).toBe(false);
    expect(sleepShouldStart('15', 900_000, 900_000, 0, 0, true)).toBe(true);
    expect(sleepShouldStart('off', 0, 900_000, 0, 0, false)).toBe(false);
  });
  it('starts the end-of-episode fade in the final five seconds, only with known duration and playing', () => {
    expect(sleepShouldStart('end', null, 0, 94.9, 100, false)).toBe(false);
    expect(sleepShouldStart('end', null, 0, 95, 100, false)).toBe(true);
    expect(sleepShouldStart('end', null, 0, 95, 100, true)).toBe(false);
    expect(sleepShouldStart('end', null, 0, 95, Infinity, false)).toBe(false);
    expect(sleepShouldStart('end', null, 0, 0, 0, false)).toBe(false);
  });
  it('fades over five seconds and clamps time outside the range', () => {
    expect([-1, 0, 2_500, 5_000, 8_000].map(sleepFadeFactor)).toEqual([1, 1, 0.5, 0, 0]);
  });
});

describe('playback stats', () => {
  it('prefers the response bitrate and otherwise estimates from full-file bytes and duration', () => {
    expect(estimatedBitrate({ mimeType: 'video/mp4', version: { bitrateMbps: 58, sizeBytes: 1 } as Version }, 100)).toBe(58);
    expect(estimatedBitrate({ mimeType: 'video/mp4', sizeBytes: 125_000_000 }, 100)).toBe(10);
    expect(estimatedBitrate({ mimeType: 'video/mp4', sizeBytes: 0 }, 100)).toBeNull();
    expect(estimatedBitrate({ mimeType: 'video/mp4', sizeBytes: 100 }, 0)).toBeNull();
    expect(estimatedBitrate(undefined, Infinity)).toBeNull();
  });
  it('measures the buffered range containing the playhead, without counting gaps', () => {
    const ranges = { length: 2, start: (i: number) => [0, 30][i]!, end: (i: number) => [20, 50][i]! };
    expect(bufferAhead(ranges, 10)).toBe(10);
    expect(bufferAhead(ranges, 25)).toBe(0);
    expect(bufferAhead(ranges, 50)).toBe(0);
  });
  it('formats exposed browser data and leaves unsupported fields unknown', () => {
    expect(formatStats(null).every(([, value]) => value === 'Unknown')).toBe(true);
    const video = { videoWidth: 3840, videoHeight: 2160, duration: 100, currentTime: 10,
      buffered: { length: 1, start: () => 0, end: () => 25 },
      getVideoPlaybackQuality: () => ({ droppedVideoFrames: 2, totalVideoFrames: 500 }),
    } as unknown as HTMLVideoElement;
    const stats = Object.fromEntries(formatStats(video, { mimeType: 'video/mp4', version: {
      label: 'Original', codec: 'HEVC', hdr: 'dv', bitrateMbps: 58,
    } as Version }));
    expect(stats).toMatchObject({ Resolution: '3840 × 2160', Codec: 'HEVC', HDR: 'Dolby Vision',
      'Frames dropped / total': '2 / 500', 'Estimated bitrate': '58.0 Mb/s', 'Buffer ahead': '15.0 s' });
  });
});
