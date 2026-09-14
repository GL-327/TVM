export type MotionPreference = 'auto' | 'full' | 'reduced';

export const MOTION_STORAGE_KEY = 'tvm.motion';
/**
 * Performance mode: every decorative animation, theme layer, blur and shadow
 * is switched off and focus/scroll moves land instantly. Stored separately
 * from the motion preference so turning it off restores the earlier choice.
 */
export const PERFORMANCE_STORAGE_KEY = 'tvm.performance';
const listeners = new Set<() => void>();
let preference: MotionPreference | undefined;
let performanceMode: boolean | undefined;
let observingVisibility = false;

function syncVisibility(): void {
  document.documentElement.dataset.visibility = document.visibilityState === 'hidden' ? 'hidden' : 'visible';
}

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

export function readPerformanceMode(): boolean {
  if (performanceMode !== undefined) return performanceMode;
  try {
    return globalThis.localStorage?.getItem(PERFORMANCE_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * True only when Settings → Motion is Reduced, or Performance mode is on.
 * `auto` and `full` keep decorative loops running even if the OS reports
 * `prefers-reduced-motion: reduce` (Windows/GPU often set that).
 */
export function prefersReducedMotion(): boolean {
  return readPerformanceMode() || readMotionPreference() === 'reduced';
}

function syncMotion(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.motion = prefersReducedMotion() ? 'reduced' : 'full';
    document.documentElement.dataset.motionPreference = readMotionPreference();
    document.documentElement.dataset.perf = readPerformanceMode() ? 'on' : 'off';
  }
  for (const listener of listeners) listener();
}

export function applyPerformanceMode(on: boolean): boolean {
  performanceMode = on;
  try {
    globalThis.localStorage?.setItem(PERFORMANCE_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Private browsing and full storage still allow this session's choice.
  }
  syncMotion();
  return on;
}

export function applyStoredPerformanceMode(): boolean {
  return applyPerformanceMode(readPerformanceMode());
}

export function subscribeMotionPreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function applyMotionPreference(value: MotionPreference): MotionPreference {
  preference = resolvePreference(value);
  if (!observingVisibility && typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    observingVisibility = true;
    document.addEventListener('visibilitychange', syncVisibility);
    syncVisibility();
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
