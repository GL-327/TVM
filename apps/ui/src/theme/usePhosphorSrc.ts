import { useEffect, useState } from 'react';
import { peekStylize, stylizeArt, stylizeFailed, type ArtKind } from './stylizeArt';
import { useThemeId } from './useThemeId';

export function usePhosphorSrc(original: string, kind: ArtKind): { src: string; waiting: boolean } {
  const theme = useThemeId();
  const [, bump] = useState(0);

  useEffect(() => {
    if (theme !== 'synthwave' || original === '' || peekStylize(original, kind) !== undefined || stylizeFailed(original, kind)) {
      return;
    }
    let live = true;
    void stylizeArt(original, kind).then(() => {
      if (live) bump((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [original, kind, theme]);

  if (theme !== 'synthwave' || original === '') return { src: original, waiting: false };
  const painted = peekStylize(original, kind);
  if (painted !== undefined) return { src: painted, waiting: false };
  if (stylizeFailed(original, kind)) return { src: original, waiting: false };
  return { src: original, waiting: true };
}
