import type Hls from 'hls.js';
import type { HlsConfig } from 'hls.js';
import type { PlaybackResult } from '../data/media';
import { publishHls } from './hlsBridge';

/**
 * The one in-app playback engine.
 *
 * Core guarantees every stream it hands over is browser-playable (probed,
 * remuxed or transcoded server-side), so this engine only has to pick the
 * right attach path and keep time honest:
 *
 * - `application/…mpegurl`  → hls.js (Media Source HLS)
 * - `video/mp2t` while live → mpegts.js (live MPEG-TS panels)
 * - anything else           → plain `video.src` with native Range seeking
 *
 * HLS transcode sessions start at `timeOffset` seconds into the movie, so the
 * engine adds the offset to element time and, when a seek lands outside what
 * ffmpeg has produced, asks core to restart the session at the target second.
 */

export type EngineStream = Extract<PlaybackResult, { kind: 'stream' }>;

export interface EngineEvents {
  onTime(position: number, duration: number): void;
  onPlayState(paused: boolean): void;
  onBuffering(buffering: boolean): void;
  onFirstFrame(): void;
  onEnded(): void;
  onError(message: string): void;
}

export interface PlayerEngine {
  attach(): void;
  destroy(): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seekBy(delta: number): void;
  seekTo(seconds: number): void;
  setVolume(value: number): void;
  setMuted(muted: boolean): void;
  position(): number;
  duration(): number;
}

export type AttachKind = 'hls' | 'ts-live' | 'file';

export function attachKindFor(stream: Pick<EngineStream, 'mimeType' | 'url' | 'transport'>, live: boolean): AttachKind {
  if (stream.transport === 'hls' || stream.transport === 'hls-session') return 'hls';
  if (stream.transport === 'ts-live') return 'ts-live';
  if (stream.transport === 'direct' || stream.transport === 'file') return 'file';
  if (/mpegurl/i.test(stream.mimeType) || /\.m3u8(\?|$)/i.test(stream.url)) return 'hls';
  if (/mp2t|mpegts/i.test(stream.mimeType) && live) return 'ts-live';
  return 'file';
}

/** Position shown to the user for an element playing a session that began at `offset`. */
export function absolutePosition(elementTime: number, offset: number): number {
  return Math.max(0, (Number.isFinite(elementTime) ? elementTime : 0) + offset);
}

/** Seconds of the session window that are seekable without a server restart. */
export function withinSessionWindow(target: number, offset: number, seekableEnd: number): boolean {
  const relative = target - offset;
  return relative >= 0 && relative <= Math.max(0, seekableEnd - 0.5);
}

export function displayDuration(streamDuration: number | undefined, elementDuration: number, offset: number): number {
  if (streamDuration !== undefined && Number.isFinite(streamDuration) && streamDuration > 0) return streamDuration;
  if (Number.isFinite(elementDuration) && elementDuration > 0) return elementDuration + offset;
  return 0;
}

export const GENERIC_START_ERROR = 'This stream could not start. Press Retry, or Back to pick another file.';

function hlsConfig(live: boolean, startAt: number): Partial<HlsConfig> {
  const config: Partial<HlsConfig> = { enableWorker: true, maxBufferLength: 30, backBufferLength: 60 };
  if (!live && startAt > 0) config.startPosition = startAt;
  return config;
}

type TsPlayer = {
  attachMediaElement(el: HTMLMediaElement): void;
  detachMediaElement(): void;
  load(): void;
  unload(): void;
  pause(): void;
  destroy(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
};

interface MpegtsModule {
  isSupported?: () => boolean;
  createPlayer(source: Record<string, unknown>, config?: Record<string, unknown>): TsPlayer;
  Events?: { ERROR?: string };
}

function resolveMpegts(value: unknown, depth = 0): MpegtsModule | null {
  if (value === null || typeof value !== 'object' || depth > 3) return null;
  const record = value as Record<string, unknown>;
  if (typeof record['createPlayer'] === 'function') return value as MpegtsModule;
  return resolveMpegts(record['default'], depth + 1);
}

export interface EngineOptions {
  live: boolean;
  startAt?: number;
  maxHeight?: number;
  fetchImpl?: typeof fetch;
}

export function createPlayerEngine(
  video: HTMLVideoElement,
  stream: EngineStream,
  options: EngineOptions,
  events: EngineEvents,
): PlayerEngine {
  const fetchImpl = options.fetchImpl ?? fetch;
  const live = options.live;
  const kind = attachKindFor(stream, live);
  const isSession = stream.transport === 'hls-session' && typeof stream.sessionId === 'string';
  let offset = isSession ? stream.timeOffset ?? 0 : 0;
  let hls: Hls | null = null;
  let ts: TsPlayer | null = null;
  let destroyed = false;
  let attached = false;
  let wantsPlayback = true;
  let hlsGeneration = 0;
  let sawFrame = false;
  let recoveredMedia = false;
  let restartedNetwork = false;
  let seekRestartPending = false;
  let pendingSeek: number | null = null;
  let requestedSeek: number | null = null;
  const requests = new AbortController();
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const listeners: Array<[keyof HTMLVideoElementEventMap, EventListener]> = [];

  const fail = (message: string): void => {
    if (destroyed) return;
    events.onBuffering(false);
    events.onError(message);
  };

  const markFrame = (): void => {
    if (destroyed || sawFrame) return;
    if (video.videoWidth > 1 || video.currentTime > 0.2) {
      sawFrame = true;
      events.onBuffering(false);
      events.onFirstFrame();
    }
  };

  const tryPlay = (): void => {
    if (destroyed || !wantsPlayback || !video.paused) return;
    void video.play().catch((reason: unknown) => {
      const name = reason !== null && typeof reason === 'object' && 'name' in reason ? String(reason.name) : '';
      if (name === 'AbortError' || destroyed || !wantsPlayback) return;
      if (name === 'NotAllowedError' && !video.muted) {
        video.muted = true;
        void video.play().catch(() => undefined);
        return;
      }
    });
  };

  const on = <K extends keyof HTMLVideoElementEventMap>(name: K, handler: (event: HTMLVideoElementEventMap[K]) => void): void => {
    const listener = handler as EventListener;
    video.addEventListener(name, listener);
    listeners.push([name, listener]);
  };

  const destroyHls = (): void => {
    if (hls !== null) publishHls(video, null);
    hls?.destroy();
    hls = null;
  };

  const attachHls = (startPosition: number): void => {
    destroyHls();
    const generation = ++hlsGeneration;
    recoveredMedia = false;
    restartedNetwork = false;
    void import('hls.js').then(({ default: Hls }) => {
      if (destroyed || generation !== hlsGeneration) return;
      if (!Hls.isSupported()) {
        // Safari and some TV browsers speak HLS natively.
        video.src = sessionUrl();
        video.load();
        tryPlay();
        return;
      }
      const instance = new Hls(hlsConfig(live, isSession ? 0 : startPosition));
      hls = instance;
      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        if (destroyed || hls !== instance) return;
        const maxHeight = options.maxHeight;
        if (maxHeight !== undefined) {
          const allowed = instance.levels.map((level, index) => ({ level, index }))
            .filter(({ level }) => level.height <= maxHeight);
          instance.autoLevelCapping = allowed.at(-1)?.index ?? 0;
        }
        tryPlay();
      });
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (destroyed || hls !== instance || data.fatal !== true) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
          recoveredMedia = true;
          instance.recoverMediaError();
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !restartedNetwork) {
          restartedNetwork = true;
          instance.startLoad();
          return;
        }
        fail(GENERIC_START_ERROR);
      });
      instance.loadSource(sessionUrl());
      instance.attachMedia(video);
      publishHls(video, instance);
    }).catch(() => {
      if (generation === hlsGeneration) fail(GENERIC_START_ERROR);
    });
  };

  const sessionUrl = (): string => isSession
    ? `${stream.url}${stream.url.includes('?') ? '&' : '?'}g=${Date.now()}` : stream.url;

  const attachTs = (): void => {
    void import('../screens/mpegtsSelf').then(() => import('mpegts.js')).then((mod) => {
      if (destroyed) return;
      const api = resolveMpegts(mod) ?? resolveMpegts((globalThis as { mpegts?: unknown }).mpegts);
      if (api === null || api.isSupported?.() === false) {
        fail(GENERIC_START_ERROR);
        return;
      }
      const player = api.createPlayer(
        { type: 'mpegts', isLive: true, url: stream.url, cors: true, withCredentials: false, hasAudio: true, hasVideo: true },
        {
          enableWorker: false,
          enableStashBuffer: true,
          stashInitialSize: 768 * 1024,
          lazyLoad: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 60,
          autoCleanupMinBackwardDuration: 20,
          fixAudioTimestampGap: true,
          isLive: true,
        },
      );
      ts = player;
      player.on(api.Events?.ERROR ?? 'error', () => {
        if (ts === player) fail(GENERIC_START_ERROR);
      });
      player.attachMediaElement(video);
      player.load();
      on('canplay', tryPlay);
      tryPlay();
    }).catch(() => fail(GENERIC_START_ERROR));
  };

  const attachFile = (): void => {
    video.src = stream.url;
    video.load();
    const startAt = options.startAt ?? 0;
    if (!live && startAt > 0) {
      const seekOnce = (): void => {
        video.removeEventListener('loadedmetadata', seekOnce);
        if (Number.isFinite(video.duration) && startAt < video.duration - 2) video.currentTime = startAt;
        tryPlay();
      };
      on('loadedmetadata', seekOnce);
      return;
    }
    tryPlay();
  };

  const sessionSeek = async (target: number): Promise<void> => {
    if (stream.sessionId === undefined || destroyed) return;
    if (seekRestartPending) {
      pendingSeek = target;
      return;
    }
    seekRestartPending = true;
    events.onBuffering(true);
    try {
      const response = await fetchImpl(`/api/stream/hls/${stream.sessionId}/seek`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ at: Math.max(0, Math.floor(target)) }),
        signal: requests.signal,
      });
      const body = (await response.json()) as { ok?: boolean; offset?: number };
      if (destroyed) return;
      if (response.ok && body.ok === true && typeof body.offset === 'number' && Number.isFinite(body.offset)) {
        offset = body.offset;
        if (pendingSeek !== null) return;
        sawFrame = false;
        events.onTime(offset, displayDuration(stream.durationSeconds, video.duration, offset));
        attachHls(0);
      } else {
        events.onBuffering(false);
      }
    } catch {
      if (!destroyed) events.onBuffering(false);
    } finally {
      seekRestartPending = false;
      const next = pendingSeek;
      pendingSeek = null;
      if (next !== null && !destroyed) void sessionSeek(next);
      else requestedSeek = null;
    }
  };

  const seekTo = (seconds: number): void => {
    if (live || destroyed || !Number.isFinite(seconds)) return;
    const total = displayDuration(stream.durationSeconds, video.duration, offset);
    const target = Math.max(0, total > 0 ? Math.min(seconds, total - 1) : seconds);
    requestedSeek = target;
    if (isSession) {
      const seekable = video.seekable;
      let inWindow = false;
      for (let i = 0; i < seekable.length; i += 1) {
        if (target - offset >= seekable.start(i) && withinSessionWindow(target, offset, seekable.end(i))) inWindow = true;
      }
      if (!seekRestartPending && inWindow) {
        video.currentTime = target - offset;
        requestedSeek = null;
      } else {
        void sessionSeek(target);
      }
      return;
    }
    video.currentTime = target;
    requestedSeek = null;
  };

  return {
    attach() {
      if (destroyed || attached) return;
      attached = true;
      events.onBuffering(true);
      on('timeupdate', () => {
        if (seekRestartPending) return;
        markFrame();
        events.onTime(
          absolutePosition(video.currentTime, offset),
          displayDuration(stream.durationSeconds, video.duration, offset),
        );
      });
      on('durationchange', () => {
        if (seekRestartPending) return;
        events.onTime(
          absolutePosition(video.currentTime, offset),
          displayDuration(stream.durationSeconds, video.duration, offset),
        );
      });
      on('seeked', () => {
        if (seekRestartPending) return;
        events.onTime(absolutePosition(video.currentTime, offset), displayDuration(stream.durationSeconds, video.duration, offset));
      });
      on('play', () => events.onPlayState(false));
      on('playing', () => {
        events.onPlayState(false);
        markFrame();
        if (sawFrame) events.onBuffering(false);
      });
      on('pause', () => events.onPlayState(true));
      on('waiting', () => events.onBuffering(true));
      on('canplay', () => {
        markFrame();
        if (sawFrame) events.onBuffering(false);
      });
      on('loadeddata', markFrame);
      on('ended', () => events.onEnded());
      on('error', () => {
        if (hls !== null || ts !== null) return; // engine-level handlers own MSE errors
        if (video.error === null) return;
        fail(GENERIC_START_ERROR);
      });

      if (kind === 'hls') attachHls(options.startAt ?? 0);
      else if (kind === 'ts-live') attachTs();
      else attachFile();

      // Keep-alive instead of an explicit stop: core reaps sessions a minute
      // after pings cease, so remounts (React StrictMode, error retries) can
      // re-attach to a session that is still alive.
      if (isSession && stream.sessionId !== undefined) {
        const url = `/api/stream/hls/${stream.sessionId}/ping`;
        keepAlive = setInterval(() => {
          void fetchImpl(url, { method: 'POST', signal: requests.signal }).catch(() => undefined);
        }, 20_000);
      }
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      requests.abort();
      if (keepAlive !== null) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
      for (const [name, listener] of listeners) video.removeEventListener(name, listener);
      listeners.length = 0;
      destroyHls();
      const player = ts;
      ts = null;
      if (player !== null) {
        try {
          player.pause();
          player.unload();
          player.detachMediaElement();
          player.destroy();
        } catch {
          // Torn down already.
        }
      }
      video.pause();
      video.removeAttribute('src');
      video.load();
    },

    play: () => {
      wantsPlayback = true;
      tryPlay();
    },
    pause: () => {
      wantsPlayback = false;
      video.pause();
    },
    toggle() {
      wantsPlayback = video.paused;
      if (wantsPlayback) tryPlay();
      else video.pause();
    },
    seekBy(delta) {
      seekTo((requestedSeek ?? absolutePosition(video.currentTime, offset)) + delta);
    },
    seekTo,
    setVolume(value) {
      if (!Number.isFinite(value)) return;
      video.volume = Math.max(0, Math.min(1, value));
    },
    setMuted(muted) {
      video.muted = muted;
    },
    position: () => absolutePosition(video.currentTime, offset),
    duration: () => displayDuration(stream.durationSeconds, video.duration, offset),
  };
}
