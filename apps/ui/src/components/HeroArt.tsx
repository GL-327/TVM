import { useEffect, useState } from 'react';
import { ART_REFERRER, artFace, syncBitmap } from './artFace';

interface HeroArtProps {
  src: string;
  hue?: number;
}

export function HeroArt({ src, hue = 260 }: HeroArtProps): React.JSX.Element {
  const [incoming, setIncoming] = useState(src);
  const [outgoing, setOutgoing] = useState('');
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => {
    if (src === incoming) return;
    setOutgoing(incoming);
    setIncoming(src);
    setFailedSrc(null);
  }, [incoming, src]);

  const face = artFace({ src: incoming, failedSrc, loadedSrc });
  const style = { ['--poster-hue' as string]: String(hue) } as React.CSSProperties;
  const leaving = face === 'ready' && outgoing !== '' && outgoing !== incoming;

  if (face === 'fallback' && outgoing === '') {
    return (
      <div className="stage__pictures" aria-hidden="true">
        <div className="stage__art stage__art--fallback art--fallback" style={style} />
      </div>
    );
  }

  return (
    <div className="stage__pictures" aria-hidden="true">
      {outgoing !== '' && outgoing !== incoming && (
        <img
          className={`stage__art stage__art--back${leaving ? ' stage__art--out' : ''}`}
          src={outgoing}
          alt=""
          decoding="async"
          referrerPolicy={ART_REFERRER}
        />
      )}
      {incoming !== '' && face !== 'fallback' && (
        <img
          key={incoming}
          className={`stage__art${face === 'ready' ? ' art--ready' : ' art--pending'}`}
          src={incoming}
          alt=""
          loading="eager"
          fetchPriority="high"
          decoding="async"
          referrerPolicy={ART_REFERRER}
          onLoad={() => setLoadedSrc(incoming)}
          onError={() => setFailedSrc(incoming)}
          ref={(node) => syncBitmap(node, incoming, setLoadedSrc)}
        />
      )}
    </div>
  );
}
