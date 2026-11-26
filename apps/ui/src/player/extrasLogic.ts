import type { SleepTimer } from '../data/polishPrefs';
import type { PlaybackInfo } from '../data/playbackVersions';

export const SLEEP_OPTIONS: readonly [SleepTimer, string][] = [
  ['off', 'Off'], ['15', '15 min'], ['30', '30 min'], ['45', '45 min'], ['60', '60 min'], ['end', 'End of episode'],
];
export const SLEEP_FADE_MS = 5_000;

export function sleepDeadline(choice: SleepTimer, now: number): number | null {
  return ['15', '30', '45', '60'].includes(choice) ? now + Number(choice) * 60_000 : null;
}

export function sleepFadeFactor(elapsedMs: number): number {
  return Math.max(0, Math.min(1, 1 - elapsedMs / SLEEP_FADE_MS));
}

export function sleepShouldStart(choice: SleepTimer, deadline: number | null, now: number,
  position: number, duration: number, paused: boolean): boolean {
  if (choice === 'off') return false;
  if (choice === 'end') return !paused && Number.isFinite(duration) && duration > 0 && position >= duration - 5;
  return deadline !== null && now >= deadline;
}

export function estimatedBitrate(info: PlaybackInfo | undefined, duration: number): number | null {
  const rate = info?.version?.bitrateMbps;
  if (rate != null && Number.isFinite(rate) && rate > 0) return rate;
  const bytes = info?.sizeBytes ?? info?.version?.sizeBytes;
  return bytes != null && Number.isFinite(bytes) && bytes > 0 && Number.isFinite(duration) && duration > 0
    ? bytes * 8 / duration / 1_000_000 : null;
}

export function bufferAhead(ranges: Pick<TimeRanges, 'length' | 'start' | 'end'> | undefined, position: number): number {
  if (ranges) for (let index = 0; index < ranges.length; index++) {
    if (position >= ranges.start(index) && position <= ranges.end(index)) return Math.max(0, ranges.end(index) - position);
  }
  return 0;
}

export function formatStats(video: HTMLVideoElement | null, info?: PlaybackInfo, duration = 0): [string, string][] {
  const quality = video?.getVideoPlaybackQuality?.();
  const rate = estimatedBitrate(info, duration || video?.duration || info?.durationSeconds || 0);
  const hdr = info?.version?.hdr;
  return [
    ['Resolution', video && video.videoWidth > 0 ? `${video.videoWidth} × ${video.videoHeight}` : 'Unknown'],
    ['Container / MIME', info?.mimeType || 'Unknown'], ['Codec', info?.version?.codec || 'Unknown'],
    ['HDR', hdr === 'dv' ? 'Dolby Vision' : hdr ? hdr.toUpperCase() : 'Unknown'],
    ['Frames dropped / total', quality ? `${quality.droppedVideoFrames} / ${quality.totalVideoFrames}` : 'Unknown'],
    ['Estimated bitrate', rate === null ? 'Unknown' : `${rate.toFixed(1)} Mb/s`],
    ['Version', info?.version?.label || 'Unknown'],
    ['Buffer ahead', video ? `${bufferAhead(video.buffered, video.currentTime).toFixed(1)} s` : 'Unknown'],
  ];
}
