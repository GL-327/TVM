import { useEffect, useState, type RefObject } from 'react';
import { peekStylize, stylizeArt, stylizeFailed, type ArtKind, type ArtStyle } from './stylizeArt';
import { readPerformanceMode, subscribeMotionPreference } from './motion';
import { useThemeId } from './useThemeId';
import { whenArtNear } from './artVisibility';

/**
 * Themes whose artwork is re-rendered before display. Retro gets the
 * `mosaic` style: the picture at tile resolution in its own colours, which the
 * CSS pixelated upscale turns into a faint 8-bit edge. The heavy `phosphor`
 * palette snap is not assigned to any theme (it made posters unreadable).
 */
export const ART_STYLE_BY_THEME: Readonly<Record<string, ArtStyle>> = { synthwave: 'mosaic' };

/** Backdrops stay sharp: a 128×72 hero would block up and blank while converting. */
const MOSAIC_KINDS: ReadonlySet<ArtKind> = new Set<ArtKind>(['poster', 'logo']);

function scheduleWhenIdle(ready: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(ready, { timeout: 80 });
    return () => cancelIdleCallback(id);
  }
  const timer = setTimeout(ready, 0);
  return () => clearTimeout(timer);
}

function usePerformanceMode(): boolean {
  const [perf, setPerf] = useState(readPerformanceMode);
  useEffect(() => subscribeMotionPreference(() => setPerf(readPerformanceMode())), []);
  return perf;
}

/** Mosaic only for Retro, and never while Performance mode is on. */
export function artStyleFor(theme: string, kind: ArtKind, perf = readPerformanceMode()): ArtStyle | null {
  if (perf) return null;
  const style = ART_STYLE_BY_THEME[theme];
  if (style === undefined) return null;
  if (kind === 'backdrop') return null;
  if (style === 'mosaic' && !MOSAIC_KINDS.has(kind)) return null;
  return style;
}

export function usePhosphorSrc(original: string, kind: ArtKind, host?: RefObject<HTMLElement | null>): { src: string; waiting: boolean } {
  const theme = useThemeId();
  const perf = usePerformanceMode();
  const [result, setResult] = useState<{ original: string; kind: ArtKind; src: string | null } | null>(null);
  const style = artStyleFor(theme, kind, perf);
  const active = style !== null;

  useEffect(() => {
    if (style === null || original === '') return;
    const cached = peekStylize(original, kind, style);
    if (cached !== undefined || stylizeFailed(original, kind, style)) {
      setResult({ original, kind, src: cached ?? null });
      return;
    }
    const controller = new AbortController();
    const convert = (): void => {
      void stylizeArt(original, kind, controller.signal, style).then((src) => {
        if (!controller.signal.aborted) setResult({ original, kind, src });
      });
    };
    const stop = host?.current ? whenArtNear(host.current, convert) : scheduleWhenIdle(convert);
    return () => {
      stop();
      controller.abort();
    };
  }, [original, kind, style, host]);

  if (!active || original === '') return { src: original, waiting: false };
  if (result?.original === original && result.kind === kind) return { src: result.src ?? original, waiting: false };
  const painted = peekStylize(original, kind, style);
  if (painted !== undefined) return { src: painted, waiting: false };
  if (stylizeFailed(original, kind, style)) return { src: original, waiting: false };
  return { src: original, waiting: true };
}
