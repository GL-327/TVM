import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decidePlayback, parseProbeOutput, pickH264Encoders, type MediaProbe } from './ffmpeg.ts';
import { extensionDirectMime } from './streamer.ts';
import { createDirectRegistry, createStreamSessions, hlsArgs, playlistReady } from './streamSessions.ts';

const probe = (over: Partial<MediaProbe>): MediaProbe => ({
  container: 'matroska,webm',
  durationSeconds: 5400,
  videoCodec: 'h264',
  videoHeight: 1080,
  videoBitDepth: 8,
  audioCodec: 'aac',
  audioChannels: 2,
  ...over,
});

describe('ffprobe parsing', () => {
  it('reads container, codecs and duration from ffprobe JSON', () => {
    const parsed = parseProbeOutput(
      JSON.stringify({
        format: { format_name: 'matroska,webm', duration: '9132.261000' },
        streams: [
          { codec_type: 'video', codec_name: 'av1', height: 2160, pix_fmt: 'yuv420p10le', disposition: { default: 1 } },
          { codec_type: 'audio', codec_name: 'opus', channels: 6, disposition: { default: 1 } },
        ],
      }),
    );
    expect(parsed).toEqual({
      container: 'matroska,webm',
      durationSeconds: 9132.261,
      videoCodec: 'av1',
      videoHeight: 2160,
      videoBitDepth: 10,
      audioCodec: 'opus',
      audioChannels: 6,
    });
  });

  it('returns null for garbage or streamless output', () => {
    expect(parseProbeOutput('nonsense')).toBeNull();
    expect(parseProbeOutput('{"format":{"format_name":"mp4"}}')).toBeNull();
  });
});

describe('playback decisions', () => {
  it('direct-plays a browser-safe MP4', () => {
    expect(decidePlayback(probe({ container: 'mov,mp4,m4a,3gp,3g2,mj2' }), 2160)).toEqual({
      mode: 'direct',
      mimeType: 'video/mp4',
    });
  });

  it('direct-plays WebM with its own mime type', () => {
    expect(
      decidePlayback(probe({ container: 'matroska,webm', videoCodec: 'vp9', audioCodec: 'opus' }), 2160),
    ).toEqual({ mode: 'direct', mimeType: 'video/webm' });
  });

  it('remuxes an H.264 MKV instead of re-encoding it', () => {
    expect(decidePlayback(probe({ audioCodec: 'aac' }), 2160)).toEqual({ mode: 'hls', video: 'copy', audio: 'copy' });
  });

  it('keeps the H.264 video but fixes AC-3 audio Chromium cannot decode', () => {
    expect(decidePlayback(probe({ audioCodec: 'ac3', audioChannels: 6 }), 2160)).toEqual({
      mode: 'hls',
      video: 'copy',
      audio: 'aac',
    });
  });

  it('transcodes HEVC to H.264 and caps a 4K re-encode at 1080p', () => {
    expect(decidePlayback(probe({ videoCodec: 'hevc', audioCodec: 'dts' }), 2160)).toEqual({
      mode: 'hls',
      video: 'h264',
      audio: 'aac',
    });
    expect(decidePlayback(probe({ videoCodec: 'hevc', videoHeight: 2160, audioCodec: 'dts' }), 2160)).toEqual({
      mode: 'hls',
      video: 'h264',
      audio: 'aac',
      scaleToHeight: 1080,
    });
  });

  it('transcodes 10-bit H.264, which Chromium refuses to decode', () => {
    const decision = decidePlayback(probe({ videoBitDepth: 10 }), 2160);
    expect(decision).toMatchObject({ mode: 'hls', video: 'h264' });
  });

  it('downscales when the file exceeds the plan height cap', () => {
    const decision = decidePlayback(probe({ container: 'mov,mp4', videoHeight: 2160 }), 720);
    expect(decision).toEqual({ mode: 'hls', video: 'h264', audio: 'copy', scaleToHeight: 720 });
  });
});

describe('hls session arguments', () => {
  const base = { inputUrl: 'https://cdn.example/movie.mkv', durationSeconds: 5400 };

  it('copies streams for a remux and seeks before the input', () => {
    const args = hlsArgs(
      { ...base, decision: { mode: 'hls', video: 'copy', audio: 'copy' }, startAt: 640 },
      '/tmp/out',
    );
    expect(args).toContain('-c:v');
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('640');
    expect(args[args.indexOf('-hls_segment_type') + 1]).toBe('fmp4');
    expect(args[args.indexOf('-hls_fmp4_init_filename') + 1]).toBe('init.mp4');
    expect(args[args.indexOf('-hls_segment_filename') + 1]).toBe('seg%05d.m4s');
    expect(args.at(-1)).toBe('index.m3u8');
  });

  it('encodes H.264 with forced keyframes and a scale cap when asked', () => {
    const args = hlsArgs(
      { ...base, decision: { mode: 'hls', video: 'h264', audio: 'aac', scaleToHeight: 1080 } },
      '/tmp/out',
    );
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264');
    expect(args.join(' ')).toContain('-force_key_frames');
    expect(args[args.indexOf('-vf') + 1]).toContain('1080');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args).not.toContain('-ss');
    expect(args).not.toContain('-hwaccel');
  });

  it('uses GPU decode and encode only for hardware encoder attempts', () => {
    const encode = { mode: 'hls', video: 'h264', audio: 'aac' } as const;
    const hw = hlsArgs({ ...base, decision: encode }, '/tmp/out', 'h264_nvenc');
    expect(hw[hw.indexOf('-c:v') + 1]).toBe('h264_nvenc');
    expect(hw.indexOf('-hwaccel')).toBeLessThan(hw.indexOf('-i'));
    const remux = hlsArgs({ ...base, decision: { mode: 'hls', video: 'copy', audio: 'copy' } }, '/tmp/out', 'h264_nvenc');
    expect(remux).not.toContain('-hwaccel');
  });
});

describe('h264 encoder selection', () => {
  it('lists advertised GPU encoders in preference order', () => {
    expect(pickH264Encoders('V. h264_qsv  V. h264_nvenc  V. libx264')).toEqual(['h264_nvenc', 'h264_qsv']);
    expect(pickH264Encoders('V. h264_amf  V. libx264')).toEqual(['h264_amf']);
    expect(pickH264Encoders('V. libx264 only')).toEqual([]);
  });
});

describe('session reuse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tvm-sessions-'));
  // node with ffmpeg args exits immediately; these tests only exercise bookkeeping.
  const sessions = createStreamSessions({ cacheDir: dir, ffmpegPath: () => process.execPath });
  afterAll(() => {
    sessions.stopAll();
    rmSync(dir, { recursive: true, force: true });
  });

  it('adopts the live session for a source instead of racing a second ffmpeg at it', () => {
    const encode = { mode: 'hls', video: 'h264', audio: 'aac' } as const;
    const a = sessions.open({ inputUrl: 'https://cdn.example/one.mkv', decision: encode, durationSeconds: 100 });
    const near = sessions.open({ inputUrl: 'https://cdn.example/one.mkv', decision: encode, startAt: 0 });
    expect(near.id).toBe(a.id);
    expect(near.offset).toBe(0);
    const far = sessions.open({ inputUrl: 'https://cdn.example/one.mkv', decision: encode, startAt: 300 });
    expect(far.id).toBe(a.id);
    expect(far.offset).toBe(300);
    const other = sessions.open({ inputUrl: 'https://cdn.example/two.mkv', decision: encode });
    expect(other.id).not.toBe(a.id);
  });

  it('answers pings for live sessions only', () => {
    const encode = { mode: 'hls', video: 'h264', audio: 'aac' } as const;
    const session = sessions.open({ inputUrl: 'https://cdn.example/three.mkv', decision: encode });
    expect(sessions.ping(session.id)).toBe(true);
    sessions.stop(session.id);
    expect(sessions.ping(session.id)).toBe(false);
  });
});

describe('playlist readiness', () => {
  it('waits until a finished segment or the end marker appears', () => {
    expect(playlistReady('#EXTM3U\n#EXT-X-TARGETDURATION:4\n')).toBe(false);
    expect(playlistReady('#EXTM3U\n#EXTINF:4.0,\nseg00000.m4s\n')).toBe(true);
    expect(playlistReady('#EXTM3U\n#EXT-X-ENDLIST\n')).toBe(true);
  });
});

describe('direct registry', () => {
  it('mints and resolves tokens, and expires them', () => {
    let now = 1_000;
    const registry = createDirectRegistry(() => now);
    const token = registry.mint('https://cdn.example/a.mp4', 'video/mp4');
    expect(registry.lookup(token)).toEqual({ url: 'https://cdn.example/a.mp4', mimeType: 'video/mp4' });
    now += 7 * 60 * 60 * 1000;
    expect(registry.lookup(token)).toBeNull();
  });
});

describe('extension fallback', () => {
  it('only trusts trivially safe extensions', () => {
    expect(extensionDirectMime('movie.mp4')).toBe('video/mp4');
    expect(extensionDirectMime('movie.webm?sig=1')).toBe('video/webm');
    expect(extensionDirectMime('movie.mkv')).toBeNull();
    expect(extensionDirectMime('movie.avi')).toBeNull();
  });
});
