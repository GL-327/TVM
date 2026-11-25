import { useEffect, useState } from 'react';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { youtubeEmbedUrl, youtubeWatchUrl, type ExtrasTrailer } from '../data/extras';
import { requestFocus } from '../nav/focusEngine';
import { useFocusScope } from '../nav/ViewStackContext';
import { BackButton } from './BackButton';
import { FocusButton } from './FocusButton';
import { openExternalUrl } from './ImdbBadge';

interface TrailerModalProps {
  title: string;
  trailers: readonly ExtrasTrailer[];
  onClose: () => void;
}

export function TrailerModal({ title, trailers, onClose }: TrailerModalProps): React.JSX.Element | null {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scope = useFocusScope();
  const boundaryKey = `${scope}/trailer-sheet`;

  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: boundaryKey,
    focusable: false,
    trackChildren: true,
    saveLastFocusedChild: true,
    isFocusBoundary: true,
    preferredChildFocusKey: `${scope}/trailer-close`,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => requestFocus(`${scope}/trailer-close`), 20);
    return () => window.clearTimeout(timer);
  }, [scope]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' && event.key !== 'Backspace' && event.key !== 'BrowserBack' && event.key !== 'GoBack') {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const active = trailers[selectedIndex] ?? trailers[0];
  if (active === undefined) return null;

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        className="panel-scrim trailer-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} trailer`}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section className="trailer-sheet glass glass--sheet glass-appear" data-wrap="y">
          <header className="trailer-sheet__head" data-wrap="row">
            <div className="trailer-sheet__lead">
              <BackButton id="trailer-close" ariaLabel="Close trailer" onSelect={onClose} />
              <div className="trailer-sheet__titles">
                <p className="stage__kicker">Trailer</p>
                <h2 className="trailer-sheet__title">{title}</h2>
              </div>
            </div>
            <FocusButton
              id="trailer-youtube"
              className="tvm-button--glass"
              onSelect={() => openExternalUrl(youtubeWatchUrl(active.youtubeId))}
            >
              Open on YouTube
            </FocusButton>
          </header>

          {trailers.length > 1 && (
            <div className="trailer-sheet__tabs" data-wrap="row" role="tablist" aria-label="Trailers">
              {trailers.map((entry, idx) => (
                <FocusButton
                  key={entry.youtubeId}
                  id={`trailer-tab-${idx}`}
                  className={`tvm-button--glass trailer-sheet__tab${idx === selectedIndex ? ' glass--thumb' : ''}`}
                  onSelect={() => setSelectedIndex(idx)}
                >
                  {entry.name}
                </FocusButton>
              ))}
            </div>
          )}

          <div className="trailer-sheet__stage">
            <iframe
              key={active.youtubeId}
              className="trailer-sheet__frame"
              src={youtubeEmbedUrl(active.youtubeId)}
              title={`${title} — ${active.name}`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        </section>
      </div>
    </FocusContext.Provider>
  );
}
