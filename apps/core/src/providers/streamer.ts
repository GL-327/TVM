import { createFfmpegToolkit, decidePlayback, directMimeFor, type FfmpegToolkit } from './ffmpeg.ts';
import { createDirectRegistry, createStreamSessions, type DirectRegistry, type StreamSessionService } from './streamSessions.ts';

/**
 * The one place that turns "a URL to some media file" into "something the
 * in-app player is guaranteed to play". Everything the player receives is
 * same-origin: either a Range proxy token or a local HLS session playlist.
 */

export interface ResolvedFileStream {
  url: string;
  mimeType: string;
  transport: 'direct' | 'hls-session';
  sessionId?: string;
  timeOffset?: number;
  durationSeconds?: number;
}

export interface StreamerService {
  ready(): boolean;
  resolveFile(url: string, options: { maxHeight: number; startAt?: number; filename?: string }): Promise<ResolvedFileStream | null>;
  sessions: StreamSessionService;
  direct: DirectRegistry;
}

export interface StreamerOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  toolkit?: FfmpegToolkit;
  sessions?: StreamSessionService;
}

/** Extension fallback when ffprobe is unavailable: only trivially safe files. */
export function extensionDirectMime(nameOrUrl: string): string | null {
  if (/\.(mp4|m4v|mov)(\?|$)/i.test(nameOrUrl)) return 'video/mp4';
  if (/\.webm(\?|$)/i.test(nameOrUrl)) return 'video/webm';
  return null;
}

export function createStreamer(options: StreamerOptions): StreamerService {
  const env = options.env ?? process.env;
  const toolkit = options.toolkit ?? createFfmpegToolkit(env);
  const sessions =
    options.sessions ??
    createStreamSessions({
      cacheDir: `${options.dataDir}/cache`,
      ffmpegPath: () => toolkit.ffmpegPath(),
      h264Encoder: () => toolkit.h264Encoder(),
      // Players ping every 20s; a minute of silence means the viewer left.
      idleMs: 60_000,
    });
  const direct = createDirectRegistry();

  return {
    ready: () => toolkit.available(),
    sessions,
    direct,

    async resolveFile(url, opts) {
      const probe = toolkit.available() ? await toolkit.probe(url) : null;
      if (probe === null) {
        const mime = extensionDirectMime(opts.filename ?? url) ?? extensionDirectMime(url);
        if (mime === null) return null;
        const token = direct.mint(url, mime);
        return { url: `/api/stream/direct/${token}`, mimeType: mime, transport: 'direct' };
      }

      const decision = decidePlayback(probe, opts.maxHeight);
      if (decision.mode === 'direct') {
        const token = direct.mint(url, decision.mimeType);
        return {
          url: `/api/stream/direct/${token}`,
          mimeType: directMimeFor(probe.container),
          transport: 'direct',
          durationSeconds: probe.durationSeconds,
        };
      }

      const session = sessions.open({
        inputUrl: url,
        decision,
        startAt: opts.startAt ?? 0,
        durationSeconds: probe.durationSeconds,
      });
      return {
        url: `/api/stream/hls/${session.id}/index.m3u8`,
        mimeType: 'application/vnd.apple.mpegurl',
        transport: 'hls-session',
        sessionId: session.id,
        timeOffset: session.offset,
        durationSeconds: probe.durationSeconds,
      };
    },
  };
}
