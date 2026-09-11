export type MotionPreference = 'auto' | 'full' | 'reduced';

export const MOTION_STORAGE_KEY = 'tvm.motion';
const QUERY = '(prefers-reduced-motion: reduce)';
const listeners = new Set<() => void>();
let preference: MotionPreference | undefined;
let media: MediaQueryList | undefined;

function resolvePreference(value: string | null | undefined): MotionPreference {
  return value === 'full' || value === 'reduced' ? value : 'auto';
}

export function readMotionPreference(): MotionPreference {
  if (preference !== undefined) return preference;
  try {
    return resolvePreference(globalThis.localStorage?.getItem(MOTION_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

export function prefersReducedMotion(): boolean {
  const selected = readMotionPreference();
  if (selected !== 'auto') return selected === 'reduced';
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? (media ?? window.matchMedia(QUERY)).matches
    : false;
}

function syncMotion(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.motion = prefersReducedMotion() ? 'reduced' : 'full';
    document.documentElement.dataset.motionPreference = readMotionPreference();
  }
  for (const listener of listeners) listener();
}

export function subscribeMotionPreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function applyMotionPreference(value: MotionPreference): MotionPreference {
  preference = resolvePreference(value);
  if (media === undefined && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    media = window.matchMedia(QUERY);
    media.addEventListener('change', syncMotion);
  }
  try {
    globalThis.localStorage?.setItem(MOTION_STORAGE_KEY, preference);
  } catch {
    // Private browsing and full storage still allow this session's preference.
  }
  syncMotion();
  return preference;
}

export function applyStoredMotionPreference(): MotionPreference {
  return applyMotionPreference(readMotionPreference());
}
