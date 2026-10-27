import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FocusButton } from '../components/FocusButton';
import { requestFocus } from '../nav/focusEngine';
import { useFocusScope } from '../nav/ViewStackContext';
import type { PlayerSession } from './PlayerRoot';

export type PlayerGlyphName = 'back' | 'play' | 'pause' | 'rewind' | 'forward' | 'fullscreen' | 'download';
export function PlayerGlyph({ name }: { name: PlayerGlyphName }): React.JSX.Element {
  if (name === 'play') return <svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="m10 5 18 11-18 11z" /></svg>;
  if (name === 'pause') return <svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M8 5h6v22H8zm10 0h6v22h-6z" /></svg>;
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'back' && <path d="m17 6-10 10 10 10M8 16h20" />}
    {name === 'fullscreen' && <path d="M4 12V4h8m8 0h8v8M4 20v8h8m8 0h8v-8" />}
    {name === 'download' && <path d="M16 3v18m-7-7 7 7 7-7M5 23v6h22v-6" />}
    {(name === 'rewind' || name === 'forward') && <g transform={name === 'forward' ? 'translate(32 0) scale(-1 1)' : undefined}><path d="M8 8a11 11 0 1 1-3 10M8 2v7H1" /></g>}
    {(name === 'rewind' || name === 'forward') && <text x="16" y="22" textAnchor="middle" fill="currentColor" stroke="none" fontSize="12" fontWeight="600">10</text>}
  </svg>;
}

export function CinemaControls({ session, progress, volume, tools, actions, fullscreen }: {
  session: PlayerSession; progress: ReactNode; volume: ReactNode; tools: ReactNode; actions: ReactNode; fullscreen: ReactNode;
}): React.JSX.Element {
  const visible = session.controlsVisible;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsPanel = useRef<HTMLDivElement>(null);
  const scope = useFocusScope();
  useEffect(() => { if (!visible) setSettingsOpen(false); }, [visible]);
  useEffect(() => {
    if (!settingsOpen) return;
    const frame = requestAnimationFrame(() => {
      const first = settingsPanel.current?.querySelector<HTMLElement>('[data-focus-id]');
      if (first?.dataset.focusId) requestFocus(`${scope}/${first.dataset.focusId}`);
    });
    const onBack = (event: KeyboardEvent): void => {
      if (!['Escape', 'Backspace', 'BrowserBack', 'GoBack'].includes(event.key)) return;
      if (settingsPanel.current?.querySelector('[data-player-menu]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSettingsOpen(false);
      requestFocus(`${scope}/player-settings`);
    };
    window.addEventListener('keydown', onBack, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', onBack, true); };
  }, [settingsOpen, scope]);
  const episode = session.season !== undefined && session.episode !== undefined ? `S${session.season} · E${session.episode}` : null;
  return <div className="cinema-chrome" data-player-chrome="" data-chrome={visible ? 'visible' : 'hidden'}
    aria-hidden={!visible ? true : undefined} inert={!visible ? true : undefined}>
    <header className="cinema-chrome__header" data-wrap="row">
      <FocusButton id="player-exit" className="cinema-chrome__back" ariaLabel="Back" title="Back" onSelect={session.close}>
        <PlayerGlyph name="back" /><span>Back to browse</span>
      </FocusButton>
      <div className="cinema-chrome__actions">{actions}<span className="cinema-chrome__brand" aria-label="TVM Cinema">TVM<span>CINEMA</span></span></div>
    </header>
    <footer className="cinema-chrome__footer">
      <div className="cinema-chrome__recap" data-slot="skip-recap" />
      <div className="cinema-chrome__timeline">{progress}</div>
      <div className="cinema-chrome__toolbar" data-wrap="row">
        <div className="cinema-chrome__transport" data-player-transport="true" data-wrap="row">
          <FocusButton id="player-play" className="cinema-chrome__play" ariaLabel={session.paused ? 'Play' : 'Pause'} title={session.paused ? 'Play (Space)' : 'Pause (Space)'} disabled={session.busy || !!session.error} onSelect={session.togglePlayback}>
            <PlayerGlyph name={session.paused ? 'play' : 'pause'} />
          </FocusButton>
          {!session.live && <>
            <FocusButton id="player-seek-back" ariaLabel="Back 10 seconds" title="Back 10 seconds" disabled={session.busy || !!session.error} onSelect={() => session.seek(-10)}><PlayerGlyph name="rewind" /></FocusButton>
            <FocusButton id="player-seek-fwd" ariaLabel="Forward 10 seconds" title="Forward 10 seconds" disabled={session.busy || !!session.error} onSelect={() => session.seek(10)}><PlayerGlyph name="forward" /></FocusButton>
          </>}
          {volume}
        </div>
        <div className="cinema-chrome__now"><span>{session.title === 'Loading' ? 'Preparing your film' : session.title}</span>{episode && <small>{episode}</small>}</div>
        <div className="cinema-chrome__tools" data-wrap="row">
          <div className="cinema-chrome__settings-group" data-open={settingsOpen ? 'true' : 'false'}>
            <FocusButton id="player-settings" className="cinema-chrome__settings-toggle" ariaLabel="Playback settings" ariaExpanded={settingsOpen} title="Playback settings" onSelect={() => { session.showControls(); setSettingsOpen((open) => !open); }}>
              <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9h24M4 16h24M4 23h24" /><circle cx="11" cy="9" r="3" fill="#14171c" /><circle cx="22" cy="16" r="3" fill="#14171c" /><circle cx="14" cy="23" r="3" fill="#14171c" /></svg>
            </FocusButton>
            <div ref={settingsPanel} className="cinema-chrome__settings-panel" data-player-menu={settingsOpen ? 'settings' : undefined} data-wrap="row"><span className="cinema-chrome__settings-heading">Playback settings</span>{tools}</div>
          </div>
          {fullscreen}
        </div>
      </div>
    </footer>
  </div>;
}
