import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../theme/motion';
import { ART_REFERRER } from './artFace';
import { readyHeroArt, settleHeroArt, type HeroArtState } from './heroArtState';
import './HeroArt.css';

interface HeroArtProps {
  src: string;
  hue?: number;
}

export function HeroArt({ src, hue = 260 }: HeroArtProps): React.JSX.Element {
  const [pictures, setPictures] = useState<HeroArtState>({ current: '', previous: '' });
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const requested = useRef(src);
  requested.current = src;

  useEffect(() => setFailedSrc(null), [src]);

  const settle = useCallback((loaded: string) => {
    setPictures((state) => settleHeroArt(state, loaded));
  }, []);
  const ready = useCallback((node: HTMLImageElement | null) => {
    if (node === null || !node.complete || node.naturalWidth <= 0) return;
    const loaded = node.getAttribute('src') ?? '';
    const commit = (): void => {
      if (!node.isConnected) return;
      setPictures((state) => readyHeroArt(state, loaded, requested.current));
    };
    // Decode before fading so the first animation frame only composites pixels.
    if (typeof node.decode === 'function') void node.decode().then(commit, commit);
    else commit();
  }, []);

  useEffect(() => {
    if (pictures.previous === '') return;
    // Also releases the backing image if a hidden window skips animationend.
    const timer = window.setTimeout(() => settle(pictures.current), prefersReducedMotion() ? 0 : 600);
    return () => window.clearTimeout(timer);
  }, [pictures.current, pictures.previous, settle]);

  const failed = src === '' || failedSrc === src;
  const currentReady = pictures.current === src;
  const backing = currentReady ? pictures.previous : pictures.current;
  const style = { ['--poster-hue' as string]: String(hue) } as React.CSSProperties;

  return (
    <div className="stage__pictures stage__pictures--crossfade" aria-hidden="true">
      <div className="stage__art stage__art--fallback art--fallback" style={style} />
      {backing !== '' && backing !== src && (
        <img
          key={backing}
          className="stage__art stage__art--back"
          src={backing}
          alt=""
          decoding="async"
          referrerPolicy={ART_REFERRER}
        />
      )}
      {!failed && (
        <img
          key={src}
          className={`stage__art${currentReady ? ' art--ready' : ' art--pending'}`}
          data-hero-transition={currentReady && pictures.previous !== '' ? 'true' : undefined}
          src={src}
          alt=""
          loading="eager"
          fetchPriority="high"
          decoding="async"
          referrerPolicy={ART_REFERRER}
          onLoad={(event) => ready(event.currentTarget)}
          onError={() => setFailedSrc(src)}
          onAnimationEnd={() => settle(src)}
          ref={ready}
        />
      )}
    </div>
  );
}
