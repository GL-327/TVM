/**
 * Lazy Web Audio boost (> 100% up to 200%) for HTML5 <video>.
 *
 * AudioContext and MediaElementAudioSourceNode are only created the first time
 * a viewer turns volume above 100%. Cross-origin streams without CORS headers
 * cannot enter Web Audio without silencing playback, so we detect that upfront
 * and cap safely at 100%.
 */

export const MAX_BOOST_VOLUME = 2;
export const TEMPORARY_VOLUME_EVENT = 'tvm:temporary-player-volume';

/** Sleep fades must not change stored volume or unmute the native player. */
export function applyTemporaryVolume(media: HTMLMediaElement | null, volume: number, muted: boolean, native: boolean): void {
  if (native) window.dispatchEvent(new CustomEvent(TEMPORARY_VOLUME_EVENT, { detail: { volume } }));
  else if (media) applyBoostedVolume(media, volume, muted);
}

export interface VolumeGainSplit {
  elementVolume: number;
  gainValue: number;
  effectiveVolume: number;
}

export function clampBoostVolume(value: number, maxVolume = MAX_BOOST_VOLUME): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maxVolume, Math.round(value * 100) / 100));
}

export function volumeGainSplit(volume: number, muted: boolean, canBoost: boolean): VolumeGainSplit {
  const cap = canBoost ? MAX_BOOST_VOLUME : 1;
  const clamped = clampBoostVolume(volume, cap);
  if (muted || clamped <= 0) {
    return { elementVolume: 0, gainValue: 1, effectiveVolume: 0 };
  }
  if (clamped <= 1) {
    return { elementVolume: clamped, gainValue: 1, effectiveVolume: clamped };
  }
  return { elementVolume: 1, gainValue: clamped, effectiveVolume: clamped };
}

interface GainEntry {
  context: AudioContext;
  gain: GainNode;
  compressor?: DynamicsCompressorNode;
  nightMode?: boolean;
}

/** Reuse the boost graph: a media element may only have one Web Audio source. */
export function applyNightMode(media: HTMLMediaElement, enabled: boolean): boolean {
  const entry = enabled ? ensureGainNode(media) : gainByVideo.get(media);
  if (!entry || typeof entry.context.createDynamicsCompressor !== 'function') return false;
  if (entry.nightMode !== enabled) {
    if (enabled && !entry.compressor) {
      const compressor = entry.context.createDynamicsCompressor();
      compressor.threshold.value = -26;
      compressor.knee.value = 24;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.25;
      entry.compressor = compressor;
    }
    entry.gain.disconnect();
    entry.compressor?.disconnect();
    if (enabled && entry.compressor) {
      entry.gain.connect(entry.compressor);
      entry.compressor.connect(entry.context.destination);
    } else entry.gain.connect(entry.context.destination);
    entry.nightMode = enabled;
  }
  if (enabled && entry.context.state === 'suspended') void entry.context.resume().catch(() => undefined);
  return enabled;
}

const gainByVideo = new WeakMap<HTMLMediaElement, GainEntry>();
const corsBlockedByVideo = new WeakSet<HTMLMediaElement>();

export function isCorsSafeMedia(media: HTMLMediaElement): boolean {
  if (corsBlockedByVideo.has(media)) return false;
  if (typeof window === 'undefined') return true;
  const rawSrc = media.currentSrc || media.src;
  if (!rawSrc || rawSrc.startsWith('blob:') || rawSrc.startsWith('data:')) return true;
  try {
    const parsed = new URL(rawSrc, window.location.href);
    if (parsed.origin === window.location.origin) return true;
    const crossOrigin = media.getAttribute('crossorigin') ?? media.crossOrigin;
    return crossOrigin !== null && crossOrigin !== '';
  } catch {
    return false;
  }
}

export function isMediaCorsLimited(media: HTMLMediaElement | null | undefined): boolean {
  if (media == null) return false;
  return !isCorsSafeMedia(media);
}

function ensureGainNode(media: HTMLMediaElement): GainEntry | null {
  const existing = gainByVideo.get(media);
  if (existing !== undefined) return existing;
  if (!isCorsSafeMedia(media) || typeof window === 'undefined') {
    corsBlockedByVideo.add(media);
    return null;
  }
  const Ctor =
    (window as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (typeof Ctor !== 'function') return null;

  try {
    const context = new Ctor();
    const source = context.createMediaElementSource(media);
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(context.destination);
    const entry = { context, gain };
    gainByVideo.set(media, entry);
    return entry;
  } catch {
    corsBlockedByVideo.add(media);
    return null;
  }
}

export function applyBoostedVolume(
  media: HTMLMediaElement,
  volume: number,
  muted: boolean,
  canBoost = true,
): { applied: number; corsLimited: boolean } {
  const target = clampBoostVolume(volume, canBoost ? MAX_BOOST_VOLUME : 1);
  if (target <= 1 || !canBoost) {
    media.volume = muted ? media.volume : target;
    const existing = gainByVideo.get(media);
    if (existing !== undefined) existing.gain.gain.value = 1;
    return { applied: target, corsLimited: false };
  }

  const entry = ensureGainNode(media);
  if (entry === null) {
    media.volume = 1;
    return { applied: 1, corsLimited: true };
  }

  if (entry.context.state === 'suspended') {
    void entry.context.resume().catch(() => undefined);
  }
  media.volume = 1;
  entry.gain.gain.value = muted ? 1 : target;
  return { applied: target, corsLimited: false };
}
