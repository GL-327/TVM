import { useEffect, useRef, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import './devTools.css';

/** Hosted on the `media` GitHub release (served as video/mp4 with Range), so the app bundle stays small. */
export const TRAILER_SRC = 'https://github.com/GL-327/TVM/releases/download/media/tvm-trailer.mp4';

/** A simple sheet that plays the TVM trailer. Play/pause and close are focusable for a remote. */
export function TrailerModal(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (el === null) return;
    void el.play().catch(() => undefined);
  }, []);

  const toggle = (): void => {
    const el = video.current;
    if (el === null) return;
    if (el.paused) void el.play().catch(() => setFailed(true));
    else el.pause();
  };

  return (
    <div className="panel-scrim" role="dialog" aria-modal="true" aria-label="TVM trailer">
      <section className="panel trailer-sheet">
        <h2 className="panel__title trailer-sheet__title">The TVM trailer</h2>
        <div className="trailer-sheet__frame">
          <video
            ref={video}
            className="trailer-sheet__video"
            src={TRAILER_SRC}
            controls
            playsInline
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => setFailed(true)}
          />
        </div>
        {failed && <p className="page__message">The trailer could not be loaded on this device.</p>}
        <div className="hero__actions">
          <FocusButton id="close" variant="primary" onSelect={() => navigate.pop()}>Close</FocusButton>
          <FocusButton id="trailer-play" onSelect={toggle}>{playing ? 'Pause' : 'Play'}</FocusButton>
        </div>
      </section>
    </div>
  );
}
