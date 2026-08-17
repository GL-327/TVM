import { useEffect, useState } from 'react';

interface HeroArtProps {
  src: string;
  hue?: number;
}

export function HeroArt({ src, hue = 260 }: HeroArtProps): React.JSX.Element {
  const [incoming, setIncoming] = useState(src);
  const [outgoing, setOutgoing] = useState('');

  useEffect(() => {
    if (src === incoming) return;
    setOutgoing(incoming);
    setIncoming(src);
  }, [incoming, src]);

  if (incoming === '') {
    return (
      <div className="stage__art stage__art--fallback" style={{ ['--poster-hue' as string]: String(hue) }} />
    );
  }

  return (
    <>
      {outgoing !== '' && outgoing !== incoming && (
        <img className="stage__art stage__art--back" src={outgoing} alt="" />
      )}
      <img key={incoming} className="stage__art" src={incoming} alt="" />
    </>
  );
}
