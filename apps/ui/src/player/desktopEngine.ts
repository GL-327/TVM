import type { EngineEvents, EngineOptions, EngineStream, PlayerEngine } from './engine';

/** Electron exposes this when the shell can paint mpv behind the chrome. */
export function desktopPlaybackBridge(): NonNullable<Window['tvmNativePlayer']> | undefined {
  if (typeof window === 'undefined') return undefined;
  const bridge = window.tvmNativePlayer;
  if (bridge === undefined || typeof bridge.start !== 'function') return undefined;
  if (window.tvmDesktop?.nativePlayback === false) return undefined;
  return bridge;
}

/**
 * Formats a browser `<video>` element can open itself.
 * Anything else on Windows or macOS goes to mpv instead of a black element.
 */
export function html5CanAttach(stream: Pick<EngineStream, 'mimeType' | 'transport' | 'url'>): boolean {
  if (stream.transport === 'hls' || stream.transport === 'hls-session' || stream.transport === 'ts-live') return true;
  if (/mpegurl|mp4|webm|ogg|quicktime/i.test(stream.mimeType)) return true;
  return /\.(mp4|webm|m4v|mov|m3u8|ogg)(\?|$)/i.test(stream.url);
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.max(0.25, Math.min(2, rate));
}

/** mpv behind the Electron window. The React chrome stays in the page. */
export function createDesktopPlayerEngine(stream: EngineStream, options: EngineOptions, events: EngineEvents): PlayerEngine {
  const bridge = desktopPlaybackBridge();
  let position = options.startAt ?? stream.startAt ?? 0;
  let duration = stream.durationSeconds ?? 0;
  let paused = true;
  let destroyed = false;
  let attached = false;
  let firstFrame = false;
  let unsubscribe = (): void => {};

  const fail = (message: string): void => {
    if (!destroyed) events.onError(message);
  };

  const updatePaused = (next: boolean): void => {
    if (paused === next) return;
    paused = next;
    if (!destroyed) events.onPlayState(next);
  };

  return {
    attach() {
      if (attached || destroyed) return;
      attached = true;
      if (bridge === undefined) {
        fail('Native playback is not installed on this device. Install mpv or set TVM_MPV_PATH, then retry.');
        return;
      }
      unsubscribe = bridge.onEvent((event) => {
        if (destroyed) return;
        if (event.type === 'state') {
          position = event.position;
          if (event.duration > 0) duration = event.duration;
          events.onTime(position, duration);
          updatePaused(event.paused);
          events.onBuffering(event.buffering);
          if (!firstFrame && position > 0.2 && !event.buffering) {
            firstFrame = true;
            events.onFirstFrame();
          }
        } else if (event.type === 'ended') events.onEnded();
        else if (event.type === 'closed') events.onClosed?.();
        else if (event.type === 'error') fail(event.message);
      });
      const href = typeof window !== 'undefined' ? window.location.href : stream.url;
      let url = stream.url;
      try {
        url = new URL(stream.url, href).href;
      } catch {
        url = stream.url;
      }
      if (options.initialVolume !== undefined) void bridge.setVolume?.(options.initialVolume);
      if (options.initialMuted !== undefined) void bridge.setMuted?.(options.initialMuted);
      void bridge.start({ url, title: stream.title, startAt: position }).catch((error: unknown) => {
        fail(error instanceof Error && /mpv missing|not installed/i.test(error.message)
          ? 'Native playback is not installed on this device. Install mpv or set TVM_MPV_PATH, then retry.'
          : 'The file could not start. TVM will try reconnecting at the same position.');
      });
    },
    destroy() {
      destroyed = true;
      unsubscribe();
      void bridge?.stop();
    },
    play() {
      updatePaused(false);
      void bridge?.command('play');
    },
    pause() {
      updatePaused(true);
      void bridge?.command('pause');
    },
    toggle() {
      // Publish the new state before issuing the command: the bridge can emit
      // its state synchronously, and flipping after that would undo it.
      const next = !paused;
      updatePaused(next);
      void bridge?.command(next ? 'pause' : 'play');
    },
    seekBy(delta) {
      void bridge?.seekTo(Math.max(0, position + delta));
    },
    seekTo(seconds) {
      void bridge?.seekTo(Math.max(0, seconds));
    },
    setVolume(volume) {
      void bridge?.setVolume?.(volume);
    },
    setMuted(muted) {
      void bridge?.setMuted?.(muted);
    },
    setRate(rate) {
      void bridge?.setRate?.(clampRate(rate));
    },
    position: () => position,
    duration: () => duration,
    liveDrift: () => 0,
    goLive() {},
  };
}
