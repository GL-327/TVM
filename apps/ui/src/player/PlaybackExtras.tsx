import { useEffect, useRef, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { useVersions, VersionSelect } from '../components/VersionSelect';
import { PLAYBACK_INFO_EVENT, readPlaybackInfo } from '../data/playbackVersions';
import { uiExtraEnabled, useExtraPrefs } from '../data/uiExtras';
import type { SleepTimer } from '../data/polishPrefs';
import { requestFocus } from '../nav/focusEngine';
import { useFocusScope } from '../nav/ViewStackContext';
import { applyNightMode, applyTemporaryVolume } from './audioGain';
import { formatStats, SLEEP_OPTIONS, sleepDeadline, sleepFadeFactor, sleepShouldStart } from './extrasLogic';
import { playerShortcutRows } from './features/KeyboardMap';
import type { PlayerSession } from './PlayerRoot';
import './playback-extras.css';

type Sheet = 'versions' | 'sleep' | 'shortcuts' | null;

export function usePlaybackExtras(session: PlayerSession): {
  tools: React.JSX.Element; overlays: React.JSX.Element; stopNextUp: boolean; holdChrome: boolean;
} {
  const prefs = useExtraPrefs();
  const latest = useRef(session);
  latest.current = session;
  const scope = useFocusScope();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [stats, setStats] = useState(false);
  const [, refresh] = useState(0);
  const [timerChoice, setTimerChoice] = useState<SleepTimer>(prefs.sleepTimerDefault);
  const [expired, setExpired] = useState(false);
  const [fading, setFading] = useState(false);
  const customized = useRef(false);
  const restoreVolume = useRef<(() => void) | undefined>(undefined);
  const timerEnabled = uiExtraEnabled('sleepTimer', prefs);
  const shortcutsEnabled = uiExtraEnabled('shortcutsOverlay', prefs);
  const versionsEnabled = !session.live && uiExtraEnabled('versionPicker', prefs);
  const versions = useVersions({ id: session.mediaId, season: session.season, episode: session.episode }, versionsEnabled);
  const night = uiExtraEnabled('nightMode', prefs);
  const pauseHidden = uiExtraEnabled('pauseOnMinimize', prefs);
  const closeSheet = (): void => { setSheet(null); requestFocus(`${scope}/player-extra-${sheet ?? 'stats'}`); };

  useEffect(() => {
    customized.current = false;
    setTimerChoice(prefs.sleepTimerDefault);
    setExpired(false);
    setSheet(null);
  }, [session.mediaId]);
  useEffect(() => {
    if (!customized.current) setTimerChoice(prefs.sleepTimerDefault);
  }, [prefs.sleepTimerDefault]);

  useEffect(() => {
    if ((sheet === 'shortcuts' && !shortcutsEnabled) || (sheet === 'sleep' && !timerEnabled) || (sheet === 'versions' && !versionsEnabled)) setSheet(null);
  }, [sheet, shortcutsEnabled, timerEnabled, versionsEnabled]);

  useEffect(() => {
    const video = session.videoRef.current;
    if (!video || session.engine !== 'html5') return;
    const apply = (): void => { if (video.currentSrc || video.src) applyNightMode(video, night); };
    apply();
    video.addEventListener('loadedmetadata', apply);
    video.addEventListener('play', apply);
    return () => { video.removeEventListener('loadedmetadata', apply); video.removeEventListener('play', apply); applyNightMode(video, false); };
  }, [night, session.engine, session.videoRef]);

  useEffect(() => {
    if (!pauseHidden) return;
    const sync = (): void => { if (document.visibilityState === 'hidden') latest.current.pause(); };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [pauseHidden]);

  useEffect(() => {
    const sync = (): void => refresh((n) => n + 1);
    window.addEventListener(PLAYBACK_INFO_EVENT, sync);
    const interval = stats ? window.setInterval(sync, 1_000) : undefined;
    return () => { window.removeEventListener(PLAYBACK_INFO_EVENT, sync); window.clearInterval(interval); };
  }, [stats]);

  useEffect(() => {
    const intent = (raw: Event): void => {
      const action = (raw as CustomEvent<string>).detail;
      if (action === 'stats') { setStats((value) => !value); latest.current.showControls(); }
      if (action === 'shortcuts' && shortcutsEnabled) {
        if (sheet === 'shortcuts') closeSheet();
        else setSheet('shortcuts');
        latest.current.showControls();
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if ((sheet || expired) && event.key === 'Tab') {
        const elements = Array.from(document.querySelectorAll<HTMLElement>('.playback-extra-sheet button, .playback-extra-sheet select'));
        const index = elements.indexOf(document.activeElement as HTMLElement);
        const next = elements[(index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length];
        if (next) { event.preventDefault(); next.focus(); }
        return;
      }
      if (!['Escape', 'Backspace', 'BrowserBack', 'GoBack'].includes(event.key)) return;
      if (sheet) {
        event.preventDefault(); event.stopImmediatePropagation();
        closeSheet();
      }
    };
    window.addEventListener('tvm:media-intent', intent);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('tvm:media-intent', intent); window.removeEventListener('keydown', onKey, true); };
  }, [sheet, expired, shortcutsEnabled, scope]);

  useEffect(() => {
    if (!sheet && !expired) return;
    latest.current.showControls();
    const frame = requestAnimationFrame(() => requestFocus(`${scope}/${expired ? 'player-sleep-resume' : 'player-extra-close'}`));
    return () => cancelAnimationFrame(frame);
  }, [sheet, expired, scope]);

  useEffect(() => {
    setFading(false);
    if (!timerEnabled || timerChoice === 'off' || expired) return;
    const deadline = sleepDeadline(timerChoice, Date.now());
    let fadeStarted: number | null = null;
    let volume = 1;
    let completed = false;
    const restore = (): void => {
      const current = latest.current;
      applyTemporaryVolume(current.videoRef.current, volume, current.muted, current.engine === 'native');
    };
    const finish = (): void => {
      if (completed) return;
      completed = true;
      latest.current.pause();
      if (latest.current.engine === 'native') restore();
      latest.current.showControls();
      setExpired(true);
      setFading(false);
    };
    const startFade = (now: number): void => {
      fadeStarted = now;
      volume = latest.current.volume;
      restoreVolume.current = restore;
      setFading(true);
    };
    const tick = (): void => {
      if (completed) return;
      const current = latest.current;
      const now = Date.now();
      if (fadeStarted === null && sleepShouldStart(timerChoice, deadline, now, current.position, current.duration, current.paused)) startFade(now);
      if (fadeStarted === null) return;
      const factor = sleepFadeFactor(now - fadeStarted);
      applyTemporaryVolume(current.videoRef.current, volume * factor, current.muted, current.engine === 'native');
      if (factor === 0) finish();
    };
    const ended = (event: Event): void => {
      if (timerChoice !== 'end') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (fadeStarted === null) startFade(Date.now());
      finish();
    };
    window.addEventListener('tvm:playback-ended', ended, true);
    const timer = window.setInterval(tick, 100);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('tvm:playback-ended', ended, true);
      // Keep silence until Resume after expiry; cancellation or leaving restores the room's volume.
      if (!completed && restoreVolume.current) { restore(); restoreVolume.current = undefined; }
    };
  }, [timerChoice, timerEnabled, session.mediaId, expired]);

  useEffect(() => () => { restoreVolume.current?.(); restoreVolume.current = undefined; }, []);
  useEffect(() => {
    if (timerEnabled) return;
    restoreVolume.current?.(); restoreVolume.current = undefined;
    setExpired(false);
  }, [timerEnabled]);

  const open = (next: Sheet): void => { session.showControls(); setSheet((current) => current === next ? null : next); };
  const info = readPlaybackInfo({ id: session.mediaId, season: session.season, episode: session.episode });
  const resume = (): void => {
    restoreVolume.current?.(); restoreVolume.current = undefined;
    customized.current = true;
    setTimerChoice('off'); setExpired(false);
    if (session.duration > 0 && session.position >= session.duration - 0.2) session.seekTo(0);
    session.play();
    requestFocus(`${scope}/player-play`);
  };
  return {
    stopNextUp: timerEnabled && (timerChoice === 'end' || fading || expired),
    holdChrome: sheet !== null || expired,
    tools: <>
      <FocusButton id="player-extra-stats" onSelect={() => setStats((value) => !value)} ariaLabel="Playback stats">Stats</FocusButton>
      {versionsEnabled && versions.length > 0 && <FocusButton id="player-extra-versions" onSelect={() => open('versions')}>Version</FocusButton>}
      {timerEnabled && <FocusButton id="player-extra-sleep" onSelect={() => open('sleep')}>Sleep timer</FocusButton>}
      {shortcutsEnabled && <FocusButton id="player-extra-shortcuts" onSelect={() => open('shortcuts')}>Shortcuts</FocusButton>}
    </>,
    overlays: <>
      {stats && <aside className="playback-stats" aria-label="Playback stats">
        <div className="playback-stats__heading"><strong>Playback stats</strong><button type="button" aria-label="Close playback stats" onClick={() => setStats(false)}>×</button></div>
        <dl>{formatStats(session.videoRef.current, info, session.duration).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
      </aside>}
      {(sheet || expired) && <div className="playback-extra-scrim" data-player-menu="extras" onClick={() => { if (!expired) closeSheet(); }}>
        <section className="playback-extra-sheet" role="dialog" aria-modal="true" aria-label={expired ? 'Sleep timer ended' : sheet === 'versions' ? 'Version' : sheet === 'sleep' ? 'Sleep timer' : 'Keyboard shortcuts'}
          data-wrap="column" onClick={(event) => event.stopPropagation()}>
          <h2>{expired ? 'Sleep timer ended' : sheet === 'versions' ? 'Version' : sheet === 'sleep' ? 'Sleep timer' : 'Keyboard shortcuts'}</h2>
          {expired ? <FocusButton id="player-sleep-resume" variant="primary" onSelect={resume}>Resume</FocusButton> : <>
            {sheet === 'versions' && <VersionSelect identity={{ id: session.mediaId, season: session.season, episode: session.episode }} versions={versions} onChange={() => { closeSheet(); session.retry(); }} />}
            {sheet === 'sleep' && <div className="playback-extra-options">{SLEEP_OPTIONS.filter(([id]) => id !== 'end' || (!session.live && session.episode !== undefined)).map(([id, label]) =>
              <FocusButton key={id} id={`player-sleep-${id}`} onSelect={() => { customized.current = true; restoreVolume.current?.(); restoreVolume.current = undefined; setTimerChoice(id); closeSheet(); }}>
                {label}{timerChoice === id ? ' ✓' : ''}
              </FocusButton>)}</div>}
            {sheet === 'shortcuts' && <dl className="playback-shortcuts">{playerShortcutRows().map(([key, description]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{description}</dd></div>)}</dl>}
            <FocusButton id="player-extra-close" onSelect={closeSheet}>Close</FocusButton>
          </>}
        </section>
      </div>}
    </>,
  };
}
