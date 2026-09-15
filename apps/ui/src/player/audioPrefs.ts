/**
 * Volume and mute, remembered between playbacks.
 *
 * The player used to hold these in component state seeded with `useState(1)`,
 * which survives only as long as one Player mount. Closing a title and opening
 * the next one therefore reset the level to 100% every single time — turning
 * the volume down was undone by the act of watching something else, which is
 * what made it feel broken rather than merely forgetful.
 *
 * Stored per device, not per profile: this is a property of the speakers in
 * the room, not of who is watching.
 */

const KEY = 'tvm:audio';
const DEFAULT: AudioPrefs = { volume: 1, muted: false };

export interface AudioPrefs {
  volume: number;
  muted: boolean;
}

export function clampVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

/**
 * Storage can throw outright in a private window or when site data is blocked,
 * so every access is guarded: losing the remembered level is a small loss,
 * failing to open the player is not.
 */
export function readAudioPrefs(): AudioPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<AudioPrefs>;
    return {
      volume: clampVolume(parsed.volume),
      muted: parsed.muted === true,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function writeAudioPrefs(prefs: AudioPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ volume: clampVolume(prefs.volume), muted: prefs.muted === true }));
  } catch {
    // Not worth surfacing: playback is unaffected.
  }
}

/**
 * Muting by dragging to zero and muting with the mute button are different
 * intentions, but both leave the room silent. Restoring a stored volume of 0
 * would make the next video appear broken, so a zero level comes back as a
 * mute at the previous audible volume instead.
 */
export function restoredAudio(prefs: AudioPrefs): AudioPrefs {
  if (prefs.volume > 0) return prefs;
  return { volume: 1, muted: true };
}
