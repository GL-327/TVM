import { useEffect, useState } from 'react';
import './fps-overlay.css';

const SHOW_FPS = 'tvm.developer.show-fps';

/** Compute rounded FPS from rendered frames across an elapsed millisecond window. */
export function computeFps(frames: number, elapsedMs: number): number | null {
  if (!Number.isFinite(frames) || !Number.isFinite(elapsedMs) || frames <= 0 || elapsedMs <= 0) return null;
  return Math.round((frames * 1000) / elapsedMs);
}

/** Format the FPS overlay readout with an em-dash placeholder before the first sample completes. */
export function formatFpsLabel(fps: number | null): string {
  return `${fps ?? '—'} FPS`;
}

export function useShowFps(): readonly [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(() => {
    try { return sessionStorage.getItem(SHOW_FPS) === '1'; } catch { return false; }
  });
  useEffect(() => {
    const sync = (event: Event): void => setEnabled((event as CustomEvent<boolean>).detail);
    window.addEventListener(SHOW_FPS, sync);
    return () => window.removeEventListener(SHOW_FPS, sync);
  }, []);
  return [enabled, (next) => {
    setEnabled(next);
    try { sessionStorage.setItem(SHOW_FPS, next ? '1' : '0'); } catch { /* Keep it for this render. */ }
    window.dispatchEvent(new CustomEvent(SHOW_FPS, { detail: next }));
  }];
}

function FpsCounter(): React.JSX.Element {
  const [fps, setFps] = useState<number | null>(null);
  useEffect(() => {
    let frame = 0;
    let start: number | undefined;
    let frames = 0;
    const count = (now: number): void => {
      if (start === undefined) start = now;
      else {
        frames += 1;
        const elapsed = now - start;
        if (elapsed >= 1000) {
          setFps(computeFps(frames, elapsed));
          start = now;
          frames = 0;
        }
      }
      frame = requestAnimationFrame(count);
    };
    const sync = (): void => {
      cancelAnimationFrame(frame);
      start = undefined;
      frames = 0;
      if (!document.hidden) frame = requestAnimationFrame(count);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  return <div className="fps-overlay" aria-hidden="true">{formatFpsLabel(fps)}</div>;
}

export function FpsOverlay(): React.JSX.Element | null {
  const [enabled] = useShowFps();
  return enabled ? <FpsCounter /> : null;
}
