import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  applyIdleChromeHost,
  findIdleChromeHosts,
  IDLE_CHROME_FADE_MS,
  IDLE_CHROME_HIDE_MS,
  IDLE_CHROME_TIMINGS,
  IDLE_RECAP_HIDE_MS,
  idleChromePinned,
  isInRecapWindow,
  RECAP_WINDOW_END_S,
  syncIdleChromeFade,
  useIdleChrome,
  type IdleChromeApi,
  type IdleChromeOptions,
} from './useIdleChrome';
import { usePlayerSession } from '../PlayerRoot';

export {
  IDLE_CHROME_FADE_MS,
  IDLE_CHROME_HIDE_MS,
  IDLE_CHROME_TIMINGS,
  IDLE_RECAP_HIDE_MS,
  RECAP_WINDOW_END_S,
  isInRecapWindow,
  useIdleChrome,
};

const STYLE_ID = 'tvm-idle-chrome-css';

const IdleChromeContext = createContext<IdleChromeApi | null>(null);

export function useIdleChromeState(): IdleChromeApi | null {
  return useContext(IdleChromeContext);
}

export interface IdleChromeProps extends IdleChromeOptions {
  children?: ReactNode;
  className?: string;
  skipRecap?: boolean;
  position?: number;
  mediaId?: string;
  live?: boolean;
}

function optionsFromProps(props: IdleChromeProps): IdleChromeOptions {
  const inRecapWindow =
    props.inRecapWindow ??
    isInRecapWindow({
      skipRecap: props.skipRecap,
      position: props.position,
      overlay: props.overlay,
      live: props.live,
      mediaId: props.mediaId,
    });
  const playing = props.playing ?? (props.paused === undefined ? undefined : !props.paused);
  return {
    playing,
    paused: props.paused,
    buffering: props.buffering,
    busy: props.busy,
    error: props.error,
    overlay: props.overlay,
    pinned: props.pinned ?? idleChromePinned({ ...props, playing }),
    inRecapWindow,
    hideMs: props.hideMs,
    recapHideMs: props.recapHideMs,
  };
}

export function mountIdleChromeStyles(): void {
  ensureStyles();
}

export function syncIdleChromeHosts(chromeVisible: boolean, recapVisible: boolean, from?: ParentNode | null): void {
  syncHosts(from ?? (typeof document === 'undefined' ? null : document), chromeVisible, recapVisible);
}

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = IDLE_CHROME_CSS;
  document.head.appendChild(style);
}

function syncHosts(from: ParentNode | null, chromeVisible: boolean, recapVisible: boolean): void {
  const hosts = findIdleChromeHosts(from ?? undefined);
  if (hosts.length === 0 && from instanceof Element) {
    applyIdleChromeHost(from, chromeVisible, recapVisible);
    syncIdleChromeFade(from, chromeVisible, recapVisible);
    return;
  }
  hosts.forEach((host) => {
    applyIdleChromeHost(host, chromeVisible, recapVisible);
    syncIdleChromeFade(host, chromeVisible, recapVisible);
    host.querySelectorAll('.player__chrome').forEach((chrome) => {
      chrome.classList.toggle('player__chrome--hidden', !chromeVisible && !recapVisible);
    });
  });
}

/**
 * Keeps player chrome mounted and fades it with opacity. Arrow / OK / mouse
 * reveal via `useIdleChrome`. Skip Recap is not removed when the rest hides.
 */
export function IdleChrome(props: IdleChromeProps): React.JSX.Element | null {
  const session = usePlayerSession();
  const [mediaTime, setMediaTime] = useState(props.position ?? 0);

  useEffect(() => {
    const tick = (): void => {
      const node = session?.videoRef.current ?? document.querySelector<HTMLVideoElement>('.player__video');
      if (node !== null && Number.isFinite(node.duration) && node.duration > 1 && Number.isFinite(node.currentTime)) {
        setMediaTime(node.currentTime);
        return;
      }
      if (props.position !== undefined) setMediaTime(props.position);
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [props.position, session?.videoRef]);

  const idle = useIdleChrome(optionsFromProps({ ...props, position: mediaTime }));

  useEffect(() => {
    ensureStyles();
  }, []);

  useEffect(() => {
    syncHosts(document, idle.chromeVisible, idle.recapVisible);
  }, [idle.chromeVisible, idle.recapVisible]);

  if (props.children === undefined || props.children === null) return null;

  const fullyHidden = !idle.chromeVisible && !idle.recapVisible;
  const chromeClass = [
    'player-idle-chrome',
    'player-chrome',
    props.className,
    fullyHidden ? 'player-chrome--hidden' : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <IdleChromeContext.Provider value={idle}>
      <div
        className={chromeClass}
        data-player-chrome=""
        data-player-idle=""
        data-chrome={fullyHidden ? 'hidden' : 'visible'}
        data-chrome-visible={idle.chromeVisible ? 'true' : 'false'}
        data-chrome-hidden={idle.chromeVisible ? 'false' : 'true'}
        data-recap-visible={idle.recapVisible ? 'true' : 'false'}
        onMouseMove={idle.show}
        onPointerDown={idle.show}
      >
        {props.children}
      </div>
    </IdleChromeContext.Provider>
  );
}

export default IdleChrome;

const IDLE_CHROME_CSS = `
.player-idle-chrome,
.player-chrome,
[data-player-chrome],
[data-idle-fade] {
  transition: opacity ${IDLE_CHROME_FADE_MS}ms var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
}

.player-idle-chrome.player-chrome--hidden,
.player-chrome.player-chrome--hidden {
  opacity: 0;
  pointer-events: none;
}

.player-transport[data-idle-fade='hide'],
.tvm-progress[data-idle-fade='hide'],
.player-title-overlay[data-idle-fade='hide'],
.player__chrome[data-idle-fade='hide'],
.player-chrome[data-idle-fade='hide'],
.chrome-frame[data-idle-fade='hide'],
.player-dock[data-idle-fade='hide'],
.player-volume[data-idle-fade='hide'],
[data-player-volume][data-idle-fade='hide'],
[data-player-chrome][data-idle-fade='hide'],
[data-idle-fade='hide'] {
  opacity: 0;
  pointer-events: none;
}

.player-transport[data-idle-fade='show'],
.tvm-progress[data-idle-fade='show'],
.player-title-overlay[data-idle-fade='show'],
.player__chrome[data-idle-fade='show'],
.player-chrome[data-idle-fade='show'],
.chrome-frame[data-idle-fade='show'],
.player-dock[data-idle-fade='show'],
.player-volume[data-idle-fade='show'],
[data-player-volume][data-idle-fade='show'],
[data-player-chrome][data-idle-fade='show'],
[data-idle-fade='show'] {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .player-idle-chrome,
  .player-chrome,
  [data-player-chrome],
  [data-idle-fade] {
    transition: opacity 1ms linear;
  }
}
`;
