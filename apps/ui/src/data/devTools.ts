/**
 * Small helpers behind the Developer panel: diagnostics text, local cache
 * clearing and the layout-grid overlay. No React, so they are easy to test.
 */
import { computeFps } from '../components/FpsOverlay';
import { currentAppVersion } from './changelog';

export const LAYOUT_GRID_KEY = 'tvm.developer.layout-grid';
export const LAYOUT_GRID_CLASS = 'dev-layout-grid';
const CONTENT_CACHE_PREFIX = 'tvm.content.';

export interface DiagnosticsInput {
  version: string;
  commit: string;
  userAgent: string;
  viewport: string;
  fps: number | null;
}

/** The plain-text block the "Copy diagnostics" button puts on the clipboard. */
export function formatDiagnostics(input: DiagnosticsInput): string {
  return [
    `TVM ${input.version}`,
    `Commit: ${input.commit}`,
    `User agent: ${input.userAgent}`,
    `Viewport: ${input.viewport}`,
    `FPS: ${input.fps === null ? 'not measured' : input.fps}`,
  ].join('\n');
}

export function buildCommit(): string {
  return typeof __TVM_COMMIT__ === 'string' && __TVM_COMMIT__ !== '' ? __TVM_COMMIT__ : 'unknown';
}

/** Counts animation frames for a moment; resolves null when the tab is hidden or has no rAF. */
export function sampleFps(windowMs = 700): Promise<number | null> {
  if (typeof requestAnimationFrame !== 'function' || (typeof document !== 'undefined' && document.hidden)) return Promise.resolve(null);
  return new Promise((resolve) => {
    let start: number | undefined;
    let frames = 0;
    const tick = (now: number): void => {
      if (start === undefined) start = now;
      else {
        frames += 1;
        if (now - start >= windowMs) {
          resolve(computeFps(frames, now - start));
          return;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export async function collectDiagnostics(): Promise<string> {
  const fps = await sampleFps();
  return formatDiagnostics({
    version: currentAppVersion(),
    commit: buildCommit(),
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth} x ${window.innerHeight} @${window.devicePixelRatio}x`,
    fps,
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Keys that are only cached copies of data held elsewhere. Profiles, progress and sign-in are never listed. */
export function isCacheKey(key: string): boolean {
  return key.startsWith(CONTENT_CACHE_PREFIX) || /(^|[._-])cache([._-]|$)/i.test(key);
}

export async function clearLocalCaches(): Promise<number> {
  let cleared = 0;
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null && isCacheKey(key)) stale.push(key);
    }
    stale.forEach((key) => localStorage.removeItem(key));
    cleared += stale.length;
  } catch { /* Storage blocked: nothing to clear. */ }
  try {
    cleared += sessionStorage.length;
    sessionStorage.clear();
  } catch { /* Same. */ }
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      cleared += names.length;
    }
  } catch { /* No Cache Storage here. */ }
  return cleared;
}

export function readLayoutGrid(): boolean {
  try { return sessionStorage.getItem(LAYOUT_GRID_KEY) === '1'; } catch { return false; }
}

export function setLayoutGrid(on: boolean): void {
  document.documentElement.classList.toggle(LAYOUT_GRID_CLASS, on);
  try { sessionStorage.setItem(LAYOUT_GRID_KEY, on ? '1' : '0'); } catch { /* Keep it for this page. */ }
}

/** Re-applies the grid after a reload so the toggle is not lost. */
export function restoreLayoutGrid(): void {
  if (readLayoutGrid()) document.documentElement.classList.add(LAYOUT_GRID_CLASS);
}
