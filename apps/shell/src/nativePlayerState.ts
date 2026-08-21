/**
 * mpv property bookkeeping, kept out of `NativePlayerHost` so it can be tested
 * without an Electron runtime.
 */

export interface MpvPlaybackState {
  position: number;
  duration: number;
  paused: boolean;
  /** mpv has decoded a first frame, so there is a real picture on screen. */
  started: boolean;
  /** mpv halted playback waiting on its network cache. */
  pausedForCache: boolean;
  ended: boolean;
}

/**
 * `cache-buffering-state` is a 0-100 percentage, not a flag, so observing it is
 * only useful for a progress read-out. `paused-for-cache` is the boolean that
 * means "stalled", and it is the one the overlay and the renderer act on.
 */
export const MPV_OBSERVED_PROPERTIES = [
  'time-pos',
  'duration',
  'pause',
  'paused-for-cache',
  'eof-reached',
] as const;

/**
 * TVM reaches mpv precisely when the HTML5 path produced no sound, so the
 * native player must never inherit a mute or a low volume from the user's
 * mpv.conf.
 */
export const MPV_AUDIO_COMMANDS: readonly unknown[][] = [
  ['set_property', 'mute', false],
  ['set_property', 'volume', 100],
];

export function initialMpvState(startAt = 0): MpvPlaybackState {
  return {
    position: Number.isFinite(startAt) && startAt > 0 ? startAt : 0,
    duration: 0,
    paused: false,
    started: false,
    pausedForCache: false,
    ended: false,
  };
}

export function applyMpvProperty(state: MpvPlaybackState, name: string, data: unknown): MpvPlaybackState {
  if (name === 'time-pos' && typeof data === 'number' && Number.isFinite(data)) {
    return { ...state, position: data, started: true };
  }
  if (name === 'duration' && typeof data === 'number' && Number.isFinite(data)) {
    return { ...state, duration: data };
  }
  if (name === 'pause' && typeof data === 'boolean') return { ...state, paused: data };
  if (name === 'paused-for-cache' && typeof data === 'boolean') return { ...state, pausedForCache: data };
  if (name === 'eof-reached' && data === true) return { ...state, ended: true };
  return state;
}

/** A stream is not ready until mpv decodes a frame, and stalls whenever its cache runs dry. */
export function mpvBuffering(state: MpvPlaybackState): boolean {
  return !state.started || state.pausedForCache;
}
