import { useCallback, useEffect, useState } from 'react';
import { FocusButton } from '../../components/FocusButton';
import { requestFocus } from '../../nav/focusEngine';
import { useScopedFocusKey } from '../../nav/ViewStackContext';
import type { PlayerSession } from '../PlayerRoot';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** Remote-accessible speed control; pitch stays natural during faster playback. */
export function PlaybackSpeed({ videoRef, live, engine, controlsVisible, showControls }: PlayerSession): React.JSX.Element | null {
  const [rate, setRate] = useState(1);
  const [open, setOpen] = useState(false);
  const toggleKey = useScopedFocusKey('player-speed');
  const selectedKey = useScopedFocusKey(`player-speed-${rate}`);
  const close = useCallback(() => {
    setOpen(false);
    requestFocus(toggleKey);
  }, [toggleKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null || live) return;
    const apply = (): void => { video.playbackRate = rate; };
    apply();
    video.addEventListener('loadedmetadata', apply);
    return () => video.removeEventListener('loadedmetadata', apply);
  }, [engine, live, rate, videoRef]);

  useEffect(() => {
    if (!controlsVisible) setOpen(false);
  }, [controlsVisible]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => requestFocus(selectedKey));
    const onKey = (event: KeyboardEvent): void => {
      if (!['Escape', 'Backspace', 'BrowserBack', 'GoBack'].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [close, open, selectedKey]);

  if (live || engine !== 'html5') return null;
  return (
    <div className="player-speed" data-player-feature="speed">
      <FocusButton id="player-speed" className="player-speed__toggle" disabled={!controlsVisible} onSelect={() => {
        showControls();
        if (open) close();
        else setOpen(true);
      }}>
        <span aria-label={`Playback speed ${rate} times`}>{rate}×</span>
      </FocusButton>
      {open && (
        <div className="player-speed__menu" role="menu" aria-label="Playback speed" data-player-menu="speed" data-wrap="y">
          <p className="player-speed__heading">Playback speed</p>
          {SPEEDS.map((speed) => (
            <FocusButton key={speed} id={`player-speed-${speed}`} className="player-speed__option" detail={rate === speed ? 'Selected' : undefined} onSelect={() => {
              setRate(speed);
              showControls();
              close();
            }} onArrowPress={(direction) => {
              if (direction === 'left' || direction === 'right') { close(); return false; }
              return true;
            }}>
              {speed === 1 ? 'Normal' : `${speed}×`}
            </FocusButton>
          ))}
        </div>
      )}
    </div>
  );
}
