import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { H264Encoder, PlaybackDecision } from './ffmpeg.ts';

/**
 * Local HLS sessions.
 *
 * A session is one ffmpeg process writing fMP4 HLS into a per-generation
 * directory. Seeking outside the produced window restarts ffmpeg at the new
 * position (`gen` bumps, offset changes) — the same trick Jellyfin and Plex
 * use, minus their fake-VOD playlist bookkeeping. The player adds `offset`
 * to the element time so the UI always shows absolute movie time.
 */

export interface StreamSession {
  id: string;
  offset: number;
  durationSeconds: number;
}

export interface OpenSessionInput {
  inputUrl: string;
  decision: Extract<PlaybackDecision, { mode: 'hls' }>;
  startAt?: number;
  durationSeconds?: number;
  /** Upstream needs this UA or it 403s (Real-Debrid does not care, panels do). */
  userAgent?: string;
}

export interface StreamSessionService {
  open(input: OpenSessionInput): StreamSession;
  seek(id: string, at: number): StreamSession | null;
  stop(id: string): void;
  stopAll(): void;
  /** Keep-alive from the player; idle sessions are reaped. False → session gone. */
  ping(id: string): boolean;
  /** Absolute path for a session file plus keep-alive touch. Null → unknown/unsafe. */
  filePath(id: string, name: string): string | null;
  playlistText(id: string): string | null;
  has(id: string): boolean;
  waitForFile(id: string, name: string, timeoutMs?: number): Promise<string | null>;
  waitForPlaylist(id: string, timeoutMs?: number): Promise<string | null>;
}

export interface StreamSessionOptions {
  cacheDir: string;
  ffmpegPath: () => string | null;
  /** Preferred H.264 encoder; sessions retry with libx264 when a GPU encoder dies on startup. */
  h264Encoder?: () => H264Encoder;
  maxSessions?: number;
  idleMs?: number;
  now?: () => number;
}

export const HLS_SEGMENT_SECONDS = 4;
const SAFE_FILE = /^[A-Za-z0-9_.-]+$/;

/** Encoder-specific quality/rate flags; keyframe cadence and pix_fmt are shared. */
const ENCODER_ARGS: Record<H264Encoder, string[]> = {
  libx264: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-sc_threshold', '0'],
  h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '22', '-b:v', '0', '-profile:v', 'high', '-forced-idr', '1'],
  h264_qsv: ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '22', '-forced_idr', '1'],
  h264_amf: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '21', '-qp_p', '23'],
};

export function hlsArgs(input: OpenSessionInput, _outDir: string, encoder: H264Encoder = 'libx264'): string[] {
  const { decision } = input;
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (/^https?:/i.test(input.inputUrl)) {
    args.push(
      '-user_agent', input.userAgent ?? 'tvm-core',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '15',
    );
  }
  // GPU-assisted decode only alongside a GPU encode attempt, so the libx264
  // fallback is a fully independent pure-software path.
  if (decision.video === 'h264' && encoder !== 'libx264') args.push('-hwaccel', 'auto');
  const startAt = input.startAt ?? 0;
  if (startAt > 0) args.push('-ss', String(startAt));
  args.push('-i', input.inputUrl, '-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn');

  if (decision.video === 'copy') {
    args.push('-c:v', 'copy');
  } else {
    args.push(
      ...ENCODER_ARGS[encoder],
      '-pix_fmt', encoder === 'h264_qsv' ? 'nv12' : 'yuv420p',
      // GPU encoders ignore force_key_frames; a closed GOP is what HLS needs.
      '-g', '96',
      '-keyint_min', '96',
      '-force_key_frames', `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`,
    );
    if (decision.scaleToHeight !== undefined) {
      args.push('-vf', `scale=-2:min(${decision.scaleToHeight}\\,ih)`);
    }
  }
  if (decision.audio === 'copy') {
    args.push('-c:a', 'copy');
  } else {
    args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2');
  }
  args.push(
    '-max_muxing_queue_size', '1024',
    '-f', 'hls',
    '-hls_time', String(HLS_SEGMENT_SECONDS),
    '-hls_list_size', '0',
    '-hls_segment_type', 'fmp4',
    // Relative names: ffmpeg is spawned with cwd = outDir, otherwise
    // init.mp4 lands in the core process cwd and hls.js 404s the MAP.
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', 'seg%05d.m4s',
    '-hls_flags', 'independent_segments+temp_file',
    'index.m3u8',
  );
  return args;
}

/** Playlist is servable once it lists a finished segment (or already ended). */
export function playlistReady(text: string): boolean {
  return /\.m4s\s*$/m.test(text) || text.includes('#EXT-X-ENDLIST');
}

interface SessionState {
  id: string;
  dir: string;
  gen: number;
  offset: number;
  durationSeconds: number;
  input: OpenSessionInput;
  encoder: H264Encoder;
  proc: ChildProcess | null;
  lastTouch: number;
  ended: boolean;
}

export function createStreamSessions(options: StreamSessionOptions): StreamSessionService {
  const now = options.now ?? Date.now;
  const idleMs = options.idleMs ?? 120_000;
  const maxSessions = options.maxSessions ?? 2;
  const sessions = new Map<string, SessionState>();
  const root = join(options.cacheDir, 'streams');
  let reaper: ReturnType<typeof setInterval> | null = null;

  const genDir = (state: SessionState): string => join(state.dir, `g${state.gen}`);

  const killProc = (state: SessionState): void => {
    const proc = state.proc;
    state.proc = null;
    if (proc === null) return;
    try {
      proc.kill();
    } catch {
      // Already exited.
    }
  };

  const dispose = (state: SessionState): void => {
    killProc(state);
    sessions.delete(state.id);
    try {
      rmSync(state.dir, { recursive: true, force: true });
    } catch {
      // Windows can hold segment handles briefly; the reaper retries via TTL.
    }
  };

  const reap = (): void => {
    for (const state of [...sessions.values()]) {
      if (now() - state.lastTouch > idleMs) dispose(state);
    }
    if (sessions.size === 0 && reaper !== null) {
      clearInterval(reaper);
      reaper = null;
    }
  };

  const ensureReaper = (): void => {
    if (reaper !== null) return;
    reaper = setInterval(reap, 15_000);
    reaper.unref?.();
  };

  const logFailure = (state: SessionState, code: number, errTail: string): void => {
    const line = `tvm-core: stream session ${state.id} (${state.encoder}) ffmpeg exited ${code}: ${errTail.trim()}`;
    console.error(line);
    try {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'ffmpeg-last-error.log'), `${new Date().toISOString()}\n${line}\n`);
    } catch {
      // Diagnostics only.
    }
  };

  const launch = (state: SessionState): void => {
    const bin = options.ffmpegPath();
    if (bin === null) throw new Error('ffmpeg-missing');
    const out = genDir(state);
    mkdirSync(out, { recursive: true });
    const args = hlsArgs({ ...state.input, startAt: state.offset }, out, state.encoder);
    const proc = spawn(bin, args, { cwd: out, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let errTail = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      errTail = (errTail + chunk.toString('utf8')).slice(-2000);
    });
    proc.on('close', (code) => {
      if (state.proc !== proc) return;
      state.proc = null;
      state.ended = true;
      if (code === 0 || code === null) return;
      logFailure(state, code, errTail);
      // A GPU encoder that dies before producing anything servable gets one
      // pure-software retry; mid-stream deaths surface to the player instead.
      const text = readPlaylist(state);
      if (state.encoder !== 'libx264' && sessions.has(state.id) && (text === null || !playlistReady(text))) {
        state.encoder = 'libx264';
        launch(state);
      }
    });
    proc.on('error', () => {
      if (state.proc === proc) state.proc = null;
      state.ended = true;
    });
    state.proc = proc;
    state.ended = false;
  };

  const touch = (state: SessionState): void => {
    state.lastTouch = now();
  };

  const get = (id: string): SessionState | null => {
    const state = sessions.get(id);
    if (state === undefined) return null;
    touch(state);
    return state;
  };

  const readPlaylist = (state: SessionState): string | null => {
    try {
      return readFileSync(join(genDir(state), 'index.m3u8'), 'utf8');
    } catch {
      return null;
    }
  };

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const restartAt = (state: SessionState, at: number): StreamSession => {
    killProc(state);
    const previous = state.gen;
    state.gen += 1;
    state.offset = Math.max(0, at);
    launch(state);
    try {
      rmSync(join(state.dir, `g${previous}`), { recursive: true, force: true });
    } catch {
      // Old generation lingers until the session closes; harmless.
    }
    return { id: state.id, offset: state.offset, durationSeconds: state.durationSeconds };
  };

  return {
    open(input) {
      reap();
      // One session per source: upstreams (Real-Debrid especially) reject
      // concurrent connections to the same link, so a retry or remount must
      // adopt the ffmpeg that is already reading it rather than race it.
      for (const existing of sessions.values()) {
        if (existing.input.inputUrl !== input.inputUrl) continue;
        touch(existing);
        const startAt = Math.max(0, input.startAt ?? 0);
        if (!existing.ended && Math.abs(startAt - existing.offset) < 3) {
          return { id: existing.id, offset: existing.offset, durationSeconds: existing.durationSeconds };
        }
        existing.input = input;
        return restartAt(existing, startAt);
      }
      while (sessions.size >= maxSessions) {
        const oldest = [...sessions.values()].sort((a, b) => a.lastTouch - b.lastTouch)[0];
        if (oldest === undefined) break;
        dispose(oldest);
      }
      const id = randomBytes(9).toString('hex');
      const state: SessionState = {
        id,
        dir: join(root, id),
        gen: 0,
        offset: Math.max(0, input.startAt ?? 0),
        durationSeconds: input.durationSeconds ?? 0,
        input,
        encoder: input.decision.video === 'h264' ? options.h264Encoder?.() ?? 'libx264' : 'libx264',
        proc: null,
        lastTouch: now(),
        ended: false,
      };
      sessions.set(id, state);
      launch(state);
      ensureReaper();
      return { id, offset: state.offset, durationSeconds: state.durationSeconds };
    },

    seek(id, at) {
      const state = get(id);
      if (state === null) return null;
      return restartAt(state, at);
    },

    stop(id) {
      const state = sessions.get(id);
      if (state !== undefined) dispose(state);
    },

    stopAll() {
      for (const state of [...sessions.values()]) dispose(state);
      if (reaper !== null) {
        clearInterval(reaper);
        reaper = null;
      }
    },

    ping: (id) => get(id) !== null,

    filePath(id, name) {
      const state = get(id);
      if (state === null || !SAFE_FILE.test(name)) return null;
      return join(genDir(state), name);
    },

    playlistText(id) {
      const state = get(id);
      if (state === null) return null;
      return readPlaylist(state);
    },

    has: (id) => sessions.has(id),

    async waitForFile(id, name, timeoutMs = 20_000) {
      if (!SAFE_FILE.test(name)) return null;
      const deadline = now() + timeoutMs;
      for (;;) {
        const state = get(id);
        if (state === null) return null;
        const path = join(genDir(state), name);
        if (existsSync(path)) return path;
        if (state.ended && state.proc === null) return existsSync(path) ? path : null;
        if (now() >= deadline) return null;
        await sleep(200);
      }
    },

    async waitForPlaylist(id, timeoutMs = 20_000) {
      const deadline = now() + timeoutMs;
      for (;;) {
        const state = get(id);
        if (state === null) return null;
        const text = readPlaylist(state);
        if (text !== null && playlistReady(text)) return text;
        if (state.ended && state.proc === null) return text;
        if (now() >= deadline) return text;
        await sleep(200);
      }
    },
  };
}

/** Same-origin tokens for direct-play files, so RD URLs and CORS stay server-side. */
export interface DirectRegistry {
  mint(url: string, mimeType: string): string;
  lookup(token: string): { url: string; mimeType: string } | null;
}

const DIRECT_TTL_MS = 6 * 60 * 60 * 1000;

export function createDirectRegistry(now: () => number = Date.now): DirectRegistry {
  const entries = new Map<string, { url: string; mimeType: string; expires: number }>();
  return {
    mint(url, mimeType) {
      for (const [token, entry] of entries) {
        if (entry.expires <= now()) entries.delete(token);
      }
      const token = randomBytes(12).toString('hex');
      entries.set(token, { url, mimeType, expires: now() + DIRECT_TTL_MS });
      return token;
    },
    lookup(token) {
      const entry = entries.get(token);
      if (entry === undefined || entry.expires <= now()) return null;
      return { url: entry.url, mimeType: entry.mimeType };
    },
  };
}
