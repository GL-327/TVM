import type { EngineEvents, EngineOptions, EngineStream, PlayerEngine } from './engine';

type NativeMessage = { id: string; command: string; [key: string]: unknown };
type NativeBridge = { postMessage(message: NativeMessage): void };

/** WKWebView message handler, installed by the iOS shell. */
export function iosPlaybackBridge(): NativeBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { webkit?: { messageHandlers?: { tvmPlayer?: NativeBridge } } })
    .webkit?.messageHandlers?.tvmPlayer;
}

/**
 * Android's `@JavascriptInterface` equivalent.
 *
 * A JavascriptInterface can only take primitives, so the Android shell exposes
 * a single `send(String)` taking JSON. Wrapping it here keeps the two shells
 * behind one bridge shape, and keeps the engine free of platform branches.
 */
export function androidPlaybackBridge(): NativeBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const host = (window as Window & { tvmPlayer?: { send?: (payload: string) => void } }).tvmPlayer;
  if (host === undefined || typeof host.send !== 'function') return undefined;
  return { postMessage: (message) => { host.send!(JSON.stringify(message)); } };
}

/** Whichever native player owns this shell, if any. */
export function nativePlaybackBridge(): NativeBridge | undefined {
  return iosPlaybackBridge() ?? androidPlaybackBridge();
}

/** Native owns the picture/controls; React keeps progress, billing and navigation. */
export function createIOSPlayerEngine(stream: EngineStream, options: EngineOptions, events: EngineEvents): PlayerEngine {
  const bridge = nativePlaybackBridge()!;
  const id = crypto.randomUUID();
  let position = options.startAt ?? stream.startAt ?? 0;
  let duration = 0;
  let paused = true;
  let buffering: boolean | undefined;
  let destroyed = false;
  let attached = false;
  let firstFrame = false;
  // Native owns the buffer, so it is the only side that can measure how far
  // behind the broadcast we are; it reports this alongside position.
  let drift = 0;
  const send = (command: string, payload: Record<string, unknown> = {}): void => {
    if (!destroyed) bridge.postMessage({ id, command, ...payload });
  };
  const receive = (event: Event): void => {
    const data = (event as CustomEvent<NativeMessage>).detail;
    if (destroyed || data?.id !== id) return;
    if (data.command === 'state') {
      if (typeof data['position'] === 'number') position = data['position'];
      if (typeof data['duration'] === 'number') duration = data['duration'];
      if (typeof data['liveDrift'] === 'number') drift = Math.max(0, data['liveDrift']);
      events.onTime(position, duration);
      const nextPaused = data['paused'] === true;
      const nextBuffering = data['buffering'] === true;
      if (paused !== nextPaused) { paused = nextPaused; events.onPlayState(paused); }
      if (buffering !== nextBuffering) { buffering = nextBuffering; events.onBuffering(buffering); }
      if (!firstFrame && (data['hasFrame'] === true || (typeof data['position'] === 'number' && data['position'] > 0.2))) {
        firstFrame = true; events.onFirstFrame();
      }
    } else if (data.command === 'closed') events.onClosed?.();
    else if (data.command === 'ended') events.onEnded();
    else if (data.command === 'error') events.onError(String(data['message'] ?? 'This source could not be played. Try another source.'));
  };
  return {
    attach: () => {
      if (attached || destroyed) return;
      attached = true;
      window.addEventListener('tvm:native-player', receive);
      send('open', { url: new URL(stream.url, window.location.href).href, title: stream.title, startAt: position, live: options.live });
    },
    destroy: () => { send('stop'); destroyed = true; window.removeEventListener('tvm:native-player', receive); },
    play: () => send('play'), pause: () => send('pause'),
    toggle: () => send(paused ? 'play' : 'pause'), // paused starts true so the first toggle plays
    seekBy: (delta) => send('seek', { seconds: Math.max(0, position + delta) }),
    seekTo: (seconds) => send('seek', { seconds }),
    setVolume: (volume) => send('volume', { volume }),
    setMuted: (muted) => send('mute', { muted }),
    position: () => position, duration: () => duration,
    liveDrift: () => (options.live === true ? drift : 0),
    goLive: () => { if (options.live === true) send('goLive'); },
  };
}
