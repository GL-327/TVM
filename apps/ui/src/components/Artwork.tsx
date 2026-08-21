import { memo, useState } from 'react';
import type { CSSProperties } from 'react';
import { preferBackdrop, preferPoster } from '../data/artwork';
import type { Title } from '../data/catalog';
import { usePhosphorSrc } from '../theme/usePhosphorSrc';
import { ART_REFERRER, artClassName, markArtReady, paintArtReady } from './artFace';

interface ArtworkProps {
  title: Title;
  kind: 'poster' | 'backdrop';
  className?: string;
  /** Skip the shimmer. Conveyor copies pass true so 2× clones stay cheap. */
  decorative?: boolean;
  /** Decode immediately. Rails pass false and wakeBitmaps when the card is near. */
  eager?: boolean;
}

function sameArt(prev: ArtworkProps, next: ArtworkProps): boolean {
  return (
    prev.kind === next.kind &&
    prev.className === next.className &&
    prev.decorative === next.decorative &&
    prev.eager === next.eager &&
    prev.title.id === next.title.id &&
    prev.title.poster === next.title.poster &&
    prev.title.backdrop === next.title.backdrop &&
    prev.title.hue === next.title.hue &&
    prev.title.title === next.title.title &&
    prev.title.kind === next.title.kind
  );
}

export const Artwork = memo(function Artwork({
  title,
  kind,
  className,
  decorative = false,
  eager = false,
}: ArtworkProps): React.JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const original = kind === 'backdrop' ? preferBackdrop(title.id, title.backdrop, title.poster) : preferPoster(title.id, title.poster, title.backdrop);
  const { src, waiting } = usePhosphorSrc(original, kind);
  const failed = original === '' || failedSrc === original;
  const style = { ['--poster-hue' as string]: String(title.hue) } as CSSProperties;

  if (failed) {
    return (
      <span className={artClassName('fallback', className)} style={style} aria-hidden="true">
        <span className="art__card">
          <span className="art__kicker">{title.kind === 'series' ? 'Series' : 'Film'}</span>
          <span className="art__title">{title.title}</span>
        </span>
      </span>
    );
  }

  return (
    <span className={artClassName('pending', className)} style={style} aria-hidden="true">
      {decorative ? null : <span className="skeleton skeleton--art" />}
      {waiting ? null : (
        <img
          key={src}
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={decorative ? 'low' : 'high'}
          decoding="async"
          referrerPolicy={ART_REFERRER}
          draggable={false}
          onLoad={(event) => markArtReady(event.currentTarget)}
          onError={() => setFailedSrc(original)}
          ref={paintArtReady}
        />
      )}
    </span>
  );
}, sameArt);
