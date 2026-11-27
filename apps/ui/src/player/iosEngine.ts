import type { EngineEvents, EngineOptions, EngineStream, PlayerEngine } from './engine';
import { TEMPORARY_VOLUME_EVENT } from './audioGain';

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

export interface NativeStatsSnapshot {
  resolution?: string;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioLanguage?: string;
  audioChannels?: string;
  hdr?: string;
  bitrateMbps?: number | null;
  estimatedBitrateMbps?: number | null;
  container?: string;
  subtitles?: string;
  droppedFrames?: number | null;
  totalFrames?: number | null;
  bufferSeconds?: number | null;
  source?: string;
  versionLabel?: string;
}

export interface NativeSleepSnapshot {
  choice: string;
  remainingMs: number | null;
  fading: boolean;
  expired: boolean;
}

export const NATIVE_STATS_EVENT = 'tvm:native-stats';
export const NATIVE_SLEEP_EVENT = 'tvm:native-sleep';
export const NATIVE_PLAYER_COMMAND_EVENT = 'tvm:native-player-command';

export function sendNativePlayerCommand(command: string, payload: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NATIVE_PLAYER_COMMAND_EVENT, { detail: { command, payload } }));
}

function parseSleepDetail(raw: Record<string, unknown>): NativeSleepSnapshot {
  return {
    choice: typeof raw['choice'] === 'string' ? raw['choice'] : 'off',
    remainingMs: typeof raw['remainingMs'] === 'number' && Number.isFinite(raw['remainingMs']) ? raw['remainingMs'] : null,
    fading: raw['fading'] === true,
    expired: raw['expired'] === true,
  };
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
  let opened = false;
  let firstFrame = false;
  // Native owns the buffer, so it is the only side that can measure how far
  // behind the broadcast we are; it reports this alongside position.
  let drift = 0;
  const pendingCommands = new Map<string, Record<string, unknown>>();
  const send = (command: string, payload: Record<string, unknown> = {}): void => {
    if (!destroyed) bridge.postMessage({ id, command, ...payload });
  };
  const onExtraCommand = (raw: Event): void => {
    const detail = (raw as CustomEvent<{ command?: string; payload?: Record<string, unknown> }>).detail;
    if (destroyed || typeof detail?.command !== 'string') return;
    const payload = detail.payload ?? {};
    if (opened) send(detail.command, payload);
    else pendingCommands.set(detail.command, payload);
  };
  const temporaryVolume = (raw: Event): void => {
    const volume = (raw as CustomEvent<{ volume?: number }>).detail?.volume;
    if (typeof volume === 'number' && Number.isFinite(volume)) send('volume', { volume: Math.max(0, Math.min(1, volume)) });
  };
  const receive = (event: Event): void => {
    const data = (event as CustomEvent<NativeMessage>).detail;
    if (destroyed || data?.id !== id) return;
    if (data.command === 'stats') {
      window.dispatchEvent(new CustomEvent(NATIVE_STATS_EVENT, {
        detail: {
          id,
          ...(typeof data['visible'] === 'boolean' ? { visible: data['visible'] } : {}),
          ...(data['stats'] && typeof data['stats'] === 'object' ? { stats: data['stats'] as NativeStatsSnapshot } : {}),
        },
      }));
    } else if (data.command === 'sleep') {
      window.dispatchEvent(new CustomEvent(NATIVE_SLEEP_EVENT, { detail: { id, sleep: parseSleepDetail(data) } }));
    } else if (data.command === 'state') {
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
      if (data['stats'] && typeof data['stats'] === 'object') {
        window.dispatchEvent(new CustomEvent(NATIVE_STATS_EVENT, { detail: { id, stats: data['stats'] as NativeStatsSnapshot } }));
      }
      if (data['sleep'] && typeof data['sleep'] === 'object') {
        window.dispatchEvent(new CustomEvent(NATIVE_SLEEP_EVENT, { detail: { id, sleep: parseSleepDetail(data['sleep'] as Record<string, unknown>) } }));
      }
    } else if (data.command === 'closed') events.onClosed?.();
    else if (data.command === 'ended') events.onEnded();
    else if (data.command === 'error') events.onError(String(data['message'] ?? 'This source could not be played. Try another source.'));
  };
  window.addEventListener(NATIVE_PLAYER_COMMAND_EVENT, onExtraCommand);
  return {
    attach: () => {
      if (attached || destroyed) return;
      attached = true;
      window.addEventListener('tvm:native-player', receive);
      window.addEventListener(TEMPORARY_VOLUME_EVENT, temporaryVolume);
      send('open', {
        url: new URL(stream.url, window.location.href).href,
        title: stream.title,
        startAt: position,
        live: options.live,
        initialVolume: Math.max(0, Math.min(1, options.initialVolume ?? 1)),
        initialMuted: options.initialMuted ?? false,
        ...(options.audioLanguage ? { audioLanguage: options.audioLanguage } : {}),
      });
      opened = true;
      for (const [command, payload] of pendingCommands) send(command, payload);
      pendingCommands.clear();
    },
    destroy: () => {
      pendingCommands.clear();
      send('stop');
      destroyed = true;
      window.removeEventListener(NATIVE_PLAYER_COMMAND_EVENT, onExtraCommand);
      window.removeEventListener('tvm:native-player', receive);
      window.removeEventListener(TEMPORARY_VOLUME_EVENT, temporaryVolume);
    },
    play: () => send('play'), pause: () => send('pause'),
    toggle: () => send(paused ? 'play' : 'pause'), // paused starts true so the first toggle plays
    seekBy: (delta) => send('seek', { seconds: Math.max(0, position + delta) }),
    seekTo: (seconds) => send('seek', { seconds }),
    setVolume: (volume) => send('volume', { volume: Math.max(0, Math.min(1, volume)) }),
    setMuted: (muted) => send('mute', { muted }),
    setRate: (rate) => send('rate', { rate }),
    position: () => position, duration: () => duration,
    liveDrift: () => (options.live === true ? drift : 0),
    goLive: () => { if (options.live === true) send('goLive'); },
  };
}
