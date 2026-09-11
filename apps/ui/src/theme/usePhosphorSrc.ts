import { useEffect, useState, type RefObject } from 'react';
import { peekStylize, stylizeArt, stylizeFailed, type ArtKind } from './stylizeArt';
import { useThemeId } from './useThemeId';
import { whenArtNear } from './artVisibility';

export function usePhosphorSrc(original: string, kind: ArtKind, host?: RefObject<HTMLElement | null>): { src: string; waiting: boolean } {
  const theme = useThemeId();
  const [result, setResult] = useState<{ original: string; kind: ArtKind; src: string | null } | null>(null);

  useEffect(() => {
    if (theme !== 'synthwave' || original === '') return;
    const cached = peekStylize(original, kind);
    if (cached !== undefined || stylizeFailed(original, kind)) {
      setResult({ original, kind, src: cached ?? null });
      return;
    }
    const controller = new AbortController();
    const convert = (): void => {
      void stylizeArt(original, kind, controller.signal).then((src) => {
        if (!controller.signal.aborted) setResult({ original, kind, src });
      });
    };
    const stop = host?.current ? whenArtNear(host.current, convert) : (convert(), undefined);
    return () => {
      stop?.();
      controller.abort();
    };
  }, [original, kind, theme, host]);

  if (theme !== 'synthwave' || original === '') return { src: original, waiting: false };
  if (result?.original === original && result.kind === kind) return { src: result.src ?? original, waiting: false };
  const painted = peekStylize(original, kind);
  if (painted !== undefined) return { src: painted, waiting: false };
  if (stylizeFailed(original, kind)) return { src: original, waiting: false };
  return { src: original, waiting: true };
}
