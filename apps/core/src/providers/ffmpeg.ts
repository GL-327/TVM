import { languageCode, type PlaybackClient } from './versions.ts';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * Local ffmpeg/ffprobe toolkit.
 *
 * Playback correctness starts here: Real-Debrid reports `video/mp4` for
 * almost everything, so the only trustworthy source of container and codec
 * facts is an ffprobe of the actual bytes. The probe feeds a deterministic
 * decision — direct-play, remux, or transcode — instead of the old
 * "try html5, watch it fail, cascade to mpv" guesswork.
 */

export interface MediaProbe {
  container: string;
  durationSeconds: number;
  videoCodec: string | null;
  videoHeight: number;
  videoBitDepth: number;
  audioCodec: string | null;
  audioChannels: number;
  audioLanguages?: string[];
  audioTracks?: AudioTrack[];
  hdr?: boolean;
}

interface AudioTrack {
  index: number;
  codec: string | null;
  channels: number;
  language: string | null;
  default: boolean;
}

export type PlaybackDecision =
  | { mode: 'direct'; mimeType: string }
  | {
      mode: 'hls';
      video: 'copy' | 'h264';
      audio: 'copy' | 'aac';
      audioIndex?: number;
      toneMap?: boolean;
      videoHeight?: number;
      hevcTag?: boolean;
      /** Encode target height when the source exceeds the plan cap. */
      scaleToHeight?: number;
    };

export type H264Encoder = 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'h264_videotoolbox' | 'libx264';

export interface FfmpegToolkit {
  available(): boolean;
  ffmpegPath(): string | null;
  /** Best H.264 encoder this ffmpeg build advertises (GPU first, x264 fallback). */
  h264Encoder(): H264Encoder;
  probe(url: string): Promise<MediaProbe | null>;
}

const HW_ENCODERS: H264Encoder[] = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox'];

/** Hardware encoders this build advertises, in preference order. */
export function pickH264Encoders(encodersText: string): H264Encoder[] {
  return HW_ENCODERS.filter((encoder) => encodersText.includes(encoder));
}

/** WinGet ffmpeg installs only patch the user PATH, which a running core never sees. */
function wingetFfmpegPaths(exe: string, local: string): string[] {
  const found: string[] = [];
  const packagesDir = join(local, 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const pack of readdirSync(packagesDir)) {
      if (!/ffmpeg/i.test(pack)) continue;
      const packDir = join(packagesDir, pack);
      found.push(join(packDir, 'bin', exe));
      try {
        for (const child of readdirSync(packDir)) {
          found.push(join(packDir, child, 'bin', exe), join(packDir, child, exe));
        }
      } catch {
        // Package folder without children.
      }
    }
  } catch {
    // No WinGet packages directory.
  }
  return found;
}

function candidatePaths(name: string, env: NodeJS.ProcessEnv, dataDir?: string): string[] {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const list: string[] = [];
  const override = env[`TVM_${name.toUpperCase()}`]?.trim();
  if (override !== undefined && override !== '') list.push(override);
  if (dataDir) list.push(join(dataDir, 'tools', 'ffmpeg', exe));
  for (const dir of (env['PATH'] ?? env['Path'] ?? '').split(delimiter)) {
    if (dir !== '') list.push(join(dir, exe));
  }
  if (process.platform === 'win32') {
    const local = env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
    list.push(join(local, 'Microsoft', 'WinGet', 'Links', exe));
    list.push(...wingetFfmpegPaths(exe, local));
  } else {
    const home = env['HOME'] ?? homedir();
    list.push(
      `/usr/bin/${name}`,
      `/usr/local/bin/${name}`,
      `/opt/homebrew/bin/${name}`,
      `/opt/homebrew/opt/ffmpeg/bin/${name}`,
      `/opt/local/bin/${name}`,
      join(home, '.local', 'bin', name),
    );
  }
  return list;
}

export function locateBinary(name: string, env: NodeJS.ProcessEnv = process.env, dataDir?: string): string | null {
  for (const path of candidatePaths(name, env, dataDir)) {
    try {
      if (existsSync(path)) return path;
    } catch {
      // Unreadable directory on PATH — keep looking.
    }
  }
  return null;
}

function num(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  color_transfer?: string;
  tags?: { language?: string };
  height?: number;
  channels?: number;
  bits_per_raw_sample?: string;
  pix_fmt?: string;
  disposition?: { default?: number };
}

interface FfprobeOutput {
  format?: { format_name?: string; duration?: string };
  streams?: FfprobeStream[];
}

function bitDepthOf(stream: FfprobeStream): number {
  const raw = num(stream.bits_per_raw_sample);
  if (raw > 0) return raw;
  return /10le|10be|p010/i.test(stream.pix_fmt ?? '') ? 10 : 8;
}

export function parseProbeOutput(json: string): MediaProbe | null {
  let body: FfprobeOutput;
  try {
    body = JSON.parse(json) as FfprobeOutput;
  } catch {
    return null;
  }
  const streams = body.streams ?? [];
  const video =
    streams.find((s) => s.codec_type === 'video' && s.disposition?.default === 1) ??
    streams.find((s) => s.codec_type === 'video');
  const audio =
    streams.find((s) => s.codec_type === 'audio' && s.disposition?.default === 1) ??
    streams.find((s) => s.codec_type === 'audio');
  if (video === undefined && audio === undefined) return null;
  const audioTracks = streams.filter(s => s.codec_type === 'audio').map((s, index): AudioTrack => ({
    index, codec: s.codec_name?.toLowerCase() ?? null, channels: num(s.channels),
    language: languageCode(s.tags?.language), default: s === audio,
  }));
  return {
    container: (body.format?.format_name ?? '').toLowerCase(),
    durationSeconds: num(body.format?.duration),
    videoCodec: video?.codec_name?.toLowerCase() ?? null,
    videoHeight: num(video?.height),
    videoBitDepth: video === undefined ? 8 : bitDepthOf(video),
    audioCodec: audio?.codec_name?.toLowerCase() ?? null,
    audioChannels: num(audio?.channels),
    audioLanguages: [...new Set(audioTracks.map(track => track.language).filter((code): code is string => code !== null))],
    ...(audioTracks.length > 1 ? { audioTracks } : {}),
    hdr: /^(smpte2084|arib-std-b67)$/.test(video?.color_transfer ?? ''),
  };
}

const MP4_CONTAINERS = /\b(mp4|mov|m4v)\b/;
/** ffprobe names both .webm and .mkv "matroska,webm"; codecs tell them apart. */
const MATROSKA_CONTAINERS = /\b(matroska|webm)\b/;
const MP4_VIDEO = new Set(['h264', 'vp9', 'av1']);
// Browsers may paint MP4 video while silently dropping Opus/FLAC/ALAC audio.
// Route those files through the AAC HLS path instead of claiming direct playback.
const MP4_AUDIO = new Set(['aac', 'mp3']);
const WEBM_VIDEO = new Set(['vp8', 'vp9', 'av1']);
const WEBM_AUDIO = new Set(['opus', 'vorbis']);
/** Codecs Chromium decodes that fMP4 HLS can carry without re-encoding. */
const HLS_COPY_VIDEO = new Set(['h264', 'vp9', 'av1']);
// fMP4 HLS with Opus or MP3 audio is not portable across WebKit/Chromium.
const HLS_COPY_AUDIO = new Set(['aac']);

/**
 * One deterministic call decides how a file reaches the player:
 *
 * - `direct`   — browser-safe container and codecs; served through the Range
 *                proxy so seeking is native and CORS/credentials are core's
 *                problem, not the `<video>` element's.
 * - `hls copy` — right codecs, wrong container (the MKV majority). ffmpeg
 *                rewraps into fMP4 HLS faster than the network can carry it.
 * - `hls h264` — everything else (HEVC, 10-bit, interlaced VC-1, …) encodes
 *                down to H.264/AAC capped at the plan height.
 */
export function chooseAudioTrack(probe: MediaProbe, languages: readonly string[] = []): AudioTrack | undefined {
  const tracks = probe.audioTracks;
  if (!tracks?.length) return undefined;
  for (const language of languages) {
    const matching = tracks.filter(track => track.language === language);
    const main = matching.find(track => track.default);
    if (main ?? matching[0]) return main ?? matching[0];
  }
  return tracks.find(track => track.default) ?? tracks[0];
}

export function decidePlayback(probe: MediaProbe, maxHeight: number, options: {
  client?: PlaybackClient; filename?: string; audioTrack?: AudioTrack;
} = {}): PlaybackDecision {
  const video = probe.videoCodec;
  const track = options.audioTrack;
  const audio = track ? track.codec : probe.audioCodec;
  const withinCap = probe.videoHeight <= maxHeight || probe.videoHeight === 0;
  const eightBitH264 = video !== 'h264' || probe.videoBitDepth <= 8;
  const hevc = video === 'hevc' && options.client?.hevc === true;
  const toneMap = probe.hdr === true && options.client?.hdr !== true;
  const matroska = MATROSKA_CONTAINERS.test(probe.container);
  const mkv = /\.mkv$/i.test(options.filename ?? '');

  const mp4Direct =
    MP4_CONTAINERS.test(probe.container) &&
    video !== null && (MP4_VIDEO.has(video) || hevc) && eightBitH264 &&
    (audio === null || MP4_AUDIO.has(audio));
  const webmDirect =
    matroska && (!mkv || options.client?.mkv !== false) &&
    video !== null && WEBM_VIDEO.has(video) &&
    (audio === null || WEBM_AUDIO.has(audio));
  const mkvDirect = matroska && mkv && options.client?.mkv === true &&
    video !== null && (MP4_VIDEO.has(video) || WEBM_VIDEO.has(video) || hevc) && eightBitH264 &&
    (audio === null || MP4_AUDIO.has(audio) || WEBM_AUDIO.has(audio));
  if ((mp4Direct || webmDirect || mkvDirect) && withinCap && !toneMap && (!track || track.index === 0)) {
    return { mode: 'direct', mimeType: mp4Direct ? 'video/mp4' : mkvDirect ? 'video/x-matroska' : 'video/webm' };
  }

  const videoCopy =
    video !== null && (HLS_COPY_VIDEO.has(video) || hevc) && withinCap && eightBitH264 && !toneMap;
  const audioCopy = audio !== null && HLS_COPY_AUDIO.has(audio) && (track?.channels ?? probe.audioChannels) <= 6;
  const audioChoice = { audio: audioCopy ? 'copy' as const : 'aac' as const,
    ...(track ? { audioIndex: track.index } : {}) };
  if (videoCopy) {
    return { mode: 'hls', video: 'copy', ...audioChoice, ...(hevc ? { hevcTag: true } : {}) };
  }
  return {
    mode: 'hls',
    video: 'h264',
    ...audioChoice,
    ...(!withinCap ? { scaleToHeight: maxHeight } : {}),
    ...(probe.videoHeight > 1080 && maxHeight > 1080 ? { videoHeight: Math.min(probe.videoHeight, maxHeight) } : {}),
    ...(toneMap ? { toneMap: true } : {}),
  };
}

const PROBE_TIMEOUT_MS = 25_000;

export function createFfmpegToolkit(env: NodeJS.ProcessEnv = process.env, dataDir?: string): FfmpegToolkit {
  let ffprobe: string | null | undefined;
  let ffmpeg: string | null | undefined;
  let encoder: H264Encoder | undefined;

  const probePath = (): string | null => (ffprobe ??= locateBinary('ffprobe', env, dataDir));
  const mpegPath = (): string | null => (ffmpeg ??= locateBinary('ffmpeg', env, dataDir));

  return {
    available: () => mpegPath() !== null && probePath() !== null,
    ffmpegPath: () => mpegPath(),

    h264Encoder() {
      if (encoder !== undefined) return encoder;
      const bin = mpegPath();
      if (bin === null) return (encoder = 'libx264');
      let listed: H264Encoder[] = [];
      try {
        const text = execFileSync(bin, ['-hide_banner', '-encoders'], {
          encoding: 'utf8',
          timeout: 10_000,
          windowsHide: true,
        });
        listed = pickH264Encoders(text);
      } catch {
        return (encoder = 'libx264');
      }
      // Do not block Core on up to four 15-second GPU test encodes during a
      // viewer's first Play. The session already retries failed GPU startup
      // once with software, before exposing a playable manifest.
      return (encoder = listed[0] ?? 'libx264');
    },

    probe(url: string): Promise<MediaProbe | null> {
      const bin = probePath();
      if (bin === null) return Promise.resolve(null);
      return new Promise((resolve) => {
        const child = spawn(
          bin,
          [
            '-v', 'error',
            '-user_agent', 'tvm-core',
            '-analyzeduration', '20M',
            '-probesize', '20M',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            url,
          ],
          { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
        );
        let out = '';
        let settled = false;
        const finish = (value: MediaProbe | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {
            // Already gone.
          }
          finish(null);
        }, PROBE_TIMEOUT_MS);
        child.stdout.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8');
        });
        child.on('error', () => finish(null));
        child.on('close', (code) => finish(code === 0 ? parseProbeOutput(out) : null));
      });
    },
  };
}
