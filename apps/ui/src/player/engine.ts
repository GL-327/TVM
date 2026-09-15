import type Hls from 'hls.js';
import { catchUpTarget, driftFromLive, liveEdgeOf } from './liveEdge';
import type { HlsConfig } from 'hls.js';
import type { PlaybackResult } from '../data/media';
import { publishHls } from './hlsBridge';
import { createIOSPlayerEngine, nativePlaybackBridge } from './iosEngine';

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
  onClosed?(): void;
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
  /** Seconds behind the broadcast; 0 for anything that is not live. */
  liveDrift(): number;
  /** Jump back to the live edge. No-op off a live stream. */
  goLive(): void;
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

/**
 * A browser with no Media Source Extensions cannot play MPEG-TS at all, and
 * mobile Safari is the case that matters: the TVM app plays these channels
 * through its native player, but the same channel opened in Safari on the
 * same phone has nothing to decode with. Saying "could not start" sent people
 * looking for a fault in the channel, which was the wrong place.
 */
export const NO_MSE_LIVE_ERROR =
  'This browser cannot play this channel: it needs Media Source Extensions, which mobile Safari does not provide. Open it in the TVM app, which plays it natively, or use Chrome.';

/**
 * hls.js details that mean "this was never a playlist", as opposed to a
 * playlist that failed to load. Only these justify retrying a live channel as
 * raw MPEG-TS.
 */
export const MANIFEST_ERRORS: ReadonlySet<string> = new Set([
  'manifestParsingError',
  'manifestIncompatibleCodecsError',
  'manifestLoadError',
]);
export const STARTUP_TIMEOUT_MS = 45_000;
export const STALL_TIMEOUT_MS = 30_000;
export const STALLED_ERROR = 'Playback stalled. The source stopped sending playable video. Press Retry, or Back to choose another title.';

function hlsConfig(live: boolean, startAt: number): Partial<HlsConfig> {
  const config: Partial<HlsConfig> = { enableWorker: true, maxBufferLength: 30, backBufferLength: 60 };
  // A growing server conversion looks live to HLS. Always start VOD at its
  // requested position, including zero, instead of chasing the produced edge.
  if (!live) config.startPosition = Math.max(0, startAt);
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

function createMissingNativeEngine(events: EngineEvents): PlayerEngine {
  let destroyed = false;
  return {
    attach() {
      if (destroyed) return;
      events.onError(
        'TVM could not open this file. The link may be broken or the format unplayable. Press Retry, or Back to pick another title.',
      );
    },
    destroy() {
      destroyed = true;
    },
    play() {},
    pause() {},
    toggle() {},
    seekBy() {},
    seekTo() {},
    setVolume() {},
    setMuted() {},
    position: () => 0,
    duration: () => 0,
    liveDrift: () => 0,
    goLive() {},
  };
}

export function createPlayerEngine(
  video: HTMLVideoElement,
  stream: EngineStream,
  options: EngineOptions,
  events: EngineEvents,
): PlayerEngine {
  // A phone shell always decodes natively: VLC on iOS, Media3 on Android.
  // HTML5 <video> cannot open MKV/WebM/TS and is what surfaces "Can't open
  // this file" — never attach those URLs there.
  if (nativePlaybackBridge()) return createIOSPlayerEngine({ ...stream, engine: 'native' }, options, events);
  if (stream.engine === 'native') return createMissingNativeEngine(events);
  const fetchImpl = options.fetchImpl ?? fetch;
  const live = options.live;
  const kind = attachKindFor(stream, live);
  const isSession = stream.transport === 'hls-session' && typeof stream.sessionId === 'string';
  let offset = isSession ? stream.timeOffset ?? 0 : 0;
  let hls: Hls | null = null;
  let ts: TsPlayer | null = null;
  let destroyed = false;
  let failed = false;
  let attached = false;
  let wantsPlayback = true;
  let hlsGeneration = 0;
  let sawFrame = false;
  let recoveredMedia = false;
  let restartedNetwork = false;
  let triedTsFallback = false;
  let seekRestartPending = false;
  let pendingSeek: number | null = null;
  let requestedSeek: number | null = null;
  const requests = new AbortController();
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let lastProgressAt = Date.now();
  let lastMediaTime = video.currentTime;
  const listeners: Array<[keyof HTMLVideoElementEventMap, EventListener]> = [];

  /**
   * Turn a dead live channel into the provider's own words.
   *
   * When core cannot reach the upstream it answers the stream URL with a JSON
   * body naming the reason (`upstream-403`, `upstream-empty`, …). hls.js only
   * reports "a network error happened", so without this the viewer sees the
   * same generic line whether their subscription expired, the channel moved,
   * or the provider was down. Best effort: any failure here keeps the fallback.
   */
  const failWithUpstreamReason = (fallback: string): void => {
    if (destroyed || failed) return;
    void (async () => {
      let message = fallback;
      try {
        const response = await fetchImpl(stream.url, { headers: { accept: 'application/json' } });
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === 'string' && body.error !== '') {
          const { playbackErrorMessage } = await import('../data/playbackErrors');
          message = playbackErrorMessage(body.error);
        }
      } catch {
        // Not JSON, or the request failed too. The generic line still applies.
      }
      fail(message);
    })();
  };

  const fail = (message: string): void => {
    if (destroyed || failed) return;
    failed = true;
    wantsPlayback = false;
    if (watchdog !== null) clearInterval(watchdog);
    if (keepAlive !== null) clearInterval(keepAlive);
    requests.abort();
    hls?.stopLoad();
    ts?.pause();
    video.pause();
    events.onPlayState(true);
    events.onBuffering(false);
    events.onError(message);
  };

  const markFrame = (): void => {
    if (destroyed || failed || sawFrame) return;
    if (video.videoWidth > 1 || video.currentTime > 0.2) {
      sawFrame = true;
      events.onBuffering(false);
      events.onFirstFrame();
    }
  };

  const tryPlay = (): void => {
    if (destroyed || failed || !wantsPlayback || !video.paused) return;
    void video.play().catch((reason: unknown) => {
      const name = reason !== null && typeof reason === 'object' && 'name' in reason ? String(reason.name) : '';
      if (name === 'AbortError' || destroyed || failed || !wantsPlayback) return;
      if (name === 'NotAllowedError' && !video.muted) {
        video.muted = true;
        void video.play().catch(() => fail('The browser blocked playback. Press Retry to start, or Back to leave.'));
        return;
      }
      fail(name === 'NotAllowedError' ? 'The browser blocked playback. Press Retry to start, or Back to leave.' : GENERIC_START_ERROR);
    });
  };

  const on = <K extends keyof HTMLVideoElementEventMap>(name: K, handler: (event: HTMLVideoElementEventMap[K]) => void): void => {
    const listener: EventListener = (event) => {
      if (!destroyed && !failed) handler(event as HTMLVideoElementEventMap[K]);
    };
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
    // WKWebView's native HLS handles cookies, AirPlay and hardware decoding.
    // A recent iPhone may also expose MSE; prefer native support explicitly.
    if (video.canPlayType?.('application/vnd.apple.mpegurl')) {
      video.src = sessionUrl();
      on('loadedmetadata', () => {
        if (!live) video.currentTime = isSession ? 0 : startPosition;
        tryPlay();
      });
      video.load();
      tryPlay();
      return;
    }
    void import('hls.js').then(({ default: Hls }) => {
      if (destroyed || failed || generation !== hlsGeneration) return;
      if (!Hls.isSupported()) {
        fail(GENERIC_START_ERROR);
        return;
      }
      const instance = new Hls(hlsConfig(live, isSession ? 0 : startPosition));
      hls = instance;
      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        if (destroyed || failed || hls !== instance) return;
        const maxHeight = options.maxHeight;
        if (maxHeight !== undefined) {
          const allowed = instance.levels.map((level, index) => ({ level, index }))
            .filter(({ level }) => level.height <= maxHeight);
          instance.autoLevelCapping = allowed.at(-1)?.index ?? 0;
        }
        tryPlay();
      });
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (destroyed || failed || hls !== instance || data.fatal !== true) return;
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
        /*
         * A live channel that is not really a playlist. IPTV providers hand out
         * extensionless URLs that serve raw MPEG-TS, and any hop in the chain
         * can mislabel one, so core's probe is a good guess rather than a
         * guarantee. hls.js finding no manifest is the signal to try the TS
         * reader instead of dead-ending on "this stream could not start".
         *
         * MSE only — mpegts.js cannot help where hls.js was the native path.
         */
        if (live && !triedTsFallback && MANIFEST_ERRORS.has(String(data.details))) {
          triedTsFallback = true;
          destroyHls();
          attachTs();
          return;
        }
        if (live) {
          failWithUpstreamReason(GENERIC_START_ERROR);
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
      if (destroyed || failed) return;
      const api = resolveMpegts(mod) ?? resolveMpegts((globalThis as { mpegts?: unknown }).mpegts);
      if (api === null || api.isSupported?.() === false) {
        fail(NO_MSE_LIVE_ERROR);
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
        if (ts !== player) return;
        if (live) {
          failWithUpstreamReason(GENERIC_START_ERROR);
          return;
        }
        fail(GENERIC_START_ERROR);
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
      let resumed = false;
      const seekOnce = (): void => {
        if (resumed) return;
        resumed = true;
        if (Number.isFinite(video.duration) && startAt < video.duration - 2) video.currentTime = startAt;
        tryPlay();
      };
      on('loadedmetadata', seekOnce);
      return;
    }
    tryPlay();
  };

  const sessionSeek = async (target: number): Promise<void> => {
    if (stream.sessionId === undefined || destroyed || failed) return;
    if (seekRestartPending) {
      pendingSeek = target;
      return;
    }
    seekRestartPending = true;
    lastProgressAt = Date.now();
    events.onBuffering(true);
    try {
      const response = await fetchImpl(`/api/stream/hls/${stream.sessionId}/seek`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ at: Math.max(0, Math.floor(target)) }),
        signal: AbortSignal.any([requests.signal, AbortSignal.timeout(25_000)]),
      });
      const body = (await response.json()) as { ok?: boolean; offset?: number };
      if (destroyed || failed) return;
      if (response.ok && body.ok === true && typeof body.offset === 'number' && Number.isFinite(body.offset)) {
        offset = body.offset;
        if (pendingSeek !== null) return;
        sawFrame = false;
        events.onTime(offset, displayDuration(stream.durationSeconds, video.duration, offset));
        attachHls(0);
      } else {
        fail('This playback session could not seek. Press Retry to reconnect, or Back to leave.');
      }
    } catch {
      if (!destroyed) fail('Seeking took too long or the session disconnected. Press Retry to reconnect.');
    } finally {
      seekRestartPending = false;
      const next = pendingSeek;
      pendingSeek = null;
      if (next !== null && !destroyed && !failed) void sessionSeek(next);
      else requestedSeek = null;
    }
  };

  const seekTo = (seconds: number): void => {
    if (live || destroyed || failed || !Number.isFinite(seconds)) return;
    lastProgressAt = Date.now();
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
      lastProgressAt = Date.now();
      lastMediaTime = video.currentTime;
      watchdog = setInterval(() => {
        if (destroyed || failed) return;
        const now = Date.now();
        if (!wantsPlayback || video.currentTime !== lastMediaTime) {
          lastProgressAt = now;
          lastMediaTime = video.currentTime;
          return;
        }
        if (now - lastProgressAt >= (sawFrame ? STALL_TIMEOUT_MS : STARTUP_TIMEOUT_MS)) fail(STALLED_ERROR);
      }, 1_000);
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
      on('stalled', () => events.onBuffering(true));
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
          void fetchImpl(url, { method: 'POST', signal: AbortSignal.any([requests.signal, AbortSignal.timeout(10_000)]) })
            .then((response) => { if (response.status === 404) fail('The playback session expired. Press Retry to reconnect.'); })
            .catch(() => undefined);
        }, 20_000);
      }
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      requests.abort();
      if (watchdog !== null) {
        clearInterval(watchdog);
        watchdog = null;
      }
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
      if (!wantsPlayback) lastProgressAt = Date.now();
      wantsPlayback = true;
      tryPlay();
    },
    pause: () => {
      wantsPlayback = false;
      video.pause();
    },
    toggle() {
      wantsPlayback = video.paused;
      if (wantsPlayback) lastProgressAt = Date.now();
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

    liveDrift() {
      if (!live || destroyed) return 0;
      return driftFromLive(video.currentTime, liveEdgeOf(video.seekable, video.buffered));
    },

    /**
     * The one seek a live stream is allowed.
     *
     * seekTo() refuses on live because scrubbing a broadcast is meaningless,
     * but returning to the edge after a pause is the opposite: it is how a
     * viewer undoes a delay they did not choose to keep.
     */
    goLive() {
      if (!live || destroyed || failed) return;
      const edge = liveEdgeOf(video.seekable, video.buffered);
      if (edge <= 0) return;
      const target = catchUpTarget(edge);
      if (target <= 0) return;
      try {
        video.currentTime = target;
      } catch {
        // Some readers reject a seek until the first fragment lands.
        return;
      }
      lastProgressAt = Date.now();
      wantsPlayback = true;
      tryPlay();
    },
  };
}
