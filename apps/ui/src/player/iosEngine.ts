import type { EngineEvents, EngineOptions, EngineStream, PlayerEngine } from './engine';

type NativeMessage = { id: string; command: string; [key: string]: unknown };
type NativeBridge = { postMessage(message: NativeMessage): void };
export function iosPlaybackBridge(): NativeBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { webkit?: { messageHandlers?: { tvmPlayer?: NativeBridge } } })
    .webkit?.messageHandlers?.tvmPlayer;
}

/** Native owns the picture/controls; React keeps progress, billing and navigation. */
export function createIOSPlayerEngine(stream: EngineStream, options: EngineOptions, events: EngineEvents): PlayerEngine {
  const bridge = iosPlaybackBridge()!;
  const id = crypto.randomUUID();
  let position = options.startAt ?? stream.startAt ?? 0;
  let duration = 0;
  let paused = true;
  let buffering: boolean | undefined;
  let destroyed = false;
  let attached = false;
  let firstFrame = false;
  const send = (command: string, payload: Record<string, unknown> = {}): void => {
    if (!destroyed) bridge.postMessage({ id, command, ...payload });
  };
  const receive = (event: Event): void => {
    const data = (event as CustomEvent<NativeMessage>).detail;
    if (destroyed || data?.id !== id) return;
    if (data.command === 'state') {
      if (typeof data['position'] === 'number') position = data['position'];
      if (typeof data['duration'] === 'number') duration = data['duration'];
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
  };
}
