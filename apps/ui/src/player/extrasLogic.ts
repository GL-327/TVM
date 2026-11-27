import type { SleepTimer } from '../data/polishPrefs';
import type { PlaybackInfo } from '../data/playbackVersions';
import type { NativeStatsSnapshot } from './iosEngine';

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

export function formatRemainingSleep(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
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

function formatHdrLabel(hdr: string | null | undefined): string {
  if (!hdr) return 'Unknown';
  const normalized = hdr.trim().toLowerCase();
  if (!normalized || normalized === 'unknown') return 'Unknown';
  if (normalized === 'dv' || normalized === 'dolby vision') return 'Dolby Vision';
  if (normalized === 'sdr') return 'SDR';
  return normalized.toUpperCase();
}

export function formatStats(
  video: HTMLVideoElement | null,
  info?: PlaybackInfo,
  duration = 0,
  nativeStats?: NativeStatsSnapshot,
): [string, string][] {
  const quality = video?.getVideoPlaybackQuality?.();
  const estRate = estimatedBitrate(info, duration || video?.duration || info?.durationSeconds || 0);
  const liveRate = nativeStats?.bitrateMbps != null && Number.isFinite(nativeStats.bitrateMbps) && nativeStats.bitrateMbps > 0
    ? nativeStats.bitrateMbps
    : null;
  const effectiveEstRate = nativeStats?.estimatedBitrateMbps != null && Number.isFinite(nativeStats.estimatedBitrateMbps) && nativeStats.estimatedBitrateMbps > 0
    ? nativeStats.estimatedBitrateMbps
    : estRate;
  const hdr = nativeStats?.hdr ?? info?.version?.hdr;
  if (!nativeStats) {
    return [
      ['Resolution', video && video.videoWidth > 0 ? `${video.videoWidth} × ${video.videoHeight}` : 'Unknown'],
      ['Container / MIME', info?.mimeType || 'Unknown'], ['Codec', info?.version?.codec || 'Unknown'],
      ['HDR', formatHdrLabel(hdr)],
      ['Frames dropped / total', quality ? `${quality.droppedVideoFrames} / ${quality.totalVideoFrames}` : 'Unknown'],
      ['Estimated bitrate', estRate === null ? 'Unknown' : `${estRate.toFixed(1)} Mb/s`],
      ['Version', info?.version?.label || 'Unknown'],
      ['Buffer ahead', video ? `${bufferAhead(video.buffered, video.currentTime).toFixed(1)} s` : 'Unknown'],
    ];
  }
  const resolution = nativeStats.resolution
    || (nativeStats.width && nativeStats.height ? `${nativeStats.width} × ${nativeStats.height}` : 'Unknown');
  const codecs = [nativeStats.videoCodec || info?.version?.codec, nativeStats.audioCodec].filter(Boolean).join(' · ') || 'Unknown';
  const audioDetails = [nativeStats.audioLanguage, nativeStats.audioChannels].filter(Boolean).join(' · ') || 'Unknown';
  const dropped = nativeStats.droppedFrames != null
    ? (nativeStats.totalFrames != null ? `${nativeStats.droppedFrames} / ${nativeStats.totalFrames}` : `${nativeStats.droppedFrames}`)
    : 'Unknown';
  const bitrate = liveRate !== null
    ? `${liveRate.toFixed(1)} Mb/s`
    : effectiveEstRate !== null ? `${effectiveEstRate.toFixed(1)} Mb/s` : 'Unknown';
  const buffer = nativeStats.bufferSeconds != null && Number.isFinite(nativeStats.bufferSeconds)
    ? `${Math.max(0, nativeStats.bufferSeconds).toFixed(1)} s`
    : 'Unknown';
  const source = nativeStats.source || info?.version?.source?.toUpperCase() || 'Unknown';
  return [
    ['Resolution', resolution],
    ['Container / MIME', nativeStats.container || info?.mimeType || 'Unknown'],
    ['Codecs', codecs],
    ['HDR', formatHdrLabel(hdr)],
    ['Audio', audioDetails],
    ['Subtitles', nativeStats.subtitles || 'Off'],
    ['Frames dropped / total', dropped],
    ['Bitrate', bitrate],
    ['Source', source],
    ['Version', nativeStats.versionLabel || info?.version?.label || 'Unknown'],
    ['Buffer ahead', buffer],
  ];
}
