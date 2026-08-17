import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Title } from '../data/catalog';

interface ArtworkProps {
  title: Title;
  kind: 'poster' | 'backdrop';
  className?: string;
}

export function Artwork({ title, kind, className }: ArtworkProps): React.JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = kind === 'backdrop' ? title.backdrop : title.poster;
  const showImage = src !== '' && failedSrc !== src;
  const classes = [className, showImage ? undefined : 'art--fallback'].filter(Boolean).join(' ');

  return (
    <span className={classes} style={{ ['--poster-hue' as string]: String(title.hue) } as CSSProperties} aria-hidden="true">
      {showImage && <img key={src} src={src} alt="" onError={() => setFailedSrc(src)} />}
      {!showImage && (
        <span className="art__card">
          <span className="art__kicker">{title.kind === 'series' ? 'Series' : 'Film'}</span>
          <span className="art__title">{title.title}</span>
        </span>
      )}
    </span>
  );
}
