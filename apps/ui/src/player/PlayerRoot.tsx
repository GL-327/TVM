import {
  Component,
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type CSSProperties,
  type LazyExoticComponent,
  type ReactNode,
  type RefObject,
} from 'react';

import { CinemaControls, PlayerGlyph } from './CinemaControls';
import { KeyboardLayer } from './features/KeyboardLayer';
import { applyIdleChromeHost, isInRecapWindow, useIdleChrome } from './features/useIdleChrome';
import { FocusButton } from '../components/FocusButton';
import { fullscreenAvailable, toggleFullscreen } from './features/KeyboardMap';
import './features/player-chrome.css';
import './features/perf.css';
import './cinema-controls.css';
import { useNavigate } from '../nav/ViewStackContext';

export type PlayerEngine = 'loading' | 'html5' | 'native';
export type PlayerOverlay = 'queue' | 'ad' | null;

/**
 * Playback session the desktop player already owns. Feature modules read this
 * (props or context) instead of talking to Real-Debrid / the stream URL themselves.
 */
export interface PlayerSession {
  videoRef: RefObject<HTMLVideoElement | null>;
  mediaId: string;
  title: string;
  season?: number;
  episode?: number;
  engine: PlayerEngine;
  paused: boolean;
  buffering: boolean;
  busy: boolean;
  error: string | null;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  controlsVisible: boolean;
  skipRecap: boolean;
  badges: readonly string[];
  overlay: PlayerOverlay;
  live: boolean;
  play: () => void;
  pause: () => void;
  togglePlayback: () => void;
  seek: (deltaSeconds: number) => void;
  seekTo: (seconds: number) => void;
  close: () => void;
  retry: () => void;
  showControls: () => void;
  adjustVolume: (delta: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setPlaybackRate: (rate: number) => void;
}

export interface PlayerRootProps {
  session: PlayerSession;
  children?: ReactNode;
}

export const PlayerSessionContext = createContext<PlayerSession | null>(null);

export function usePlayerSession(): PlayerSession | null {
  return useContext(PlayerSessionContext);
}

export const FEATURE_NAMES = [
  'SkipRecap',
  'SeekSkip',
  'TransportBar',
  'ProgressBar',
  'TitleOverlay',
  'LiveOverlay',
  'NextUp',
  'SubtitlePicker',
  'AudioPicker',
  'QualityPicker',
  'PlaybackSpeed',
  'Buffering',
  'PlaybackError',
  'VolumeControl',
  'FocusLayer',
  'IdleChrome',
  'Trickplay',
  'AmbientBackdrop',
  'WatchlistAction',
  'RemoteHints',
  'MouseLayer',
] as const;

type FeatureName = (typeof FEATURE_NAMES)[number];

function Empty(): null {
  return null;
}

// Explicit production entrypoints keep tests and helper modules out of Vite's
// dependency graph (the former glob accidentally bundled the test runner).
const featureModules: Record<FeatureName, () => Promise<unknown>> = {
  SkipRecap: () => import('./features/SkipRecap'),
  SeekSkip: () => import('./features/SeekSkip'),
  TransportBar: () => import('./features/TransportBar'),
  ProgressBar: () => import('./features/ProgressBar'),
  TitleOverlay: () => import('./features/TitleOverlay'),
  LiveOverlay: () => import('./features/LiveOverlay'),
  NextUp: () => import('./features/NextUp'),
  SubtitlePicker: () => import('./features/SubtitlePicker'),
  AudioPicker: () => import('./features/AudioPicker'),
  QualityPicker: () => import('./features/QualityPicker'),
  PlaybackSpeed: () => import('./features/PlaybackSpeed'),
  Buffering: () => import('./features/Buffering'),
  PlaybackError: () => import('./features/PlaybackError'),
  VolumeControl: () => import('./features/VolumeControl'),
  FocusLayer: () => import('./features/FocusLayer'),
  IdleChrome: () => import('./features/IdleChrome'),
  Trickplay: () => import('./features/Trickplay'),
  AmbientBackdrop: () => import('./features/AmbientBackdrop'),
  WatchlistAction: () => import('./features/WatchlistAction'),
  RemoteHints: () => import('./features/RemoteHints'),
  MouseLayer: () => import('./features/MouseLayer'),
};

function bindExport(
  name: FeatureName,
  mod: Record<string, unknown>,
): { default: ComponentType<PlayerSession> } {
  const exported = mod[name] ?? mod.default;
  if (typeof exported === 'function') return { default: exported as ComponentType<PlayerSession> };
  return { default: Empty };
}

function lazyFeature(name: FeatureName): LazyExoticComponent<ComponentType<PlayerSession>> {
  return lazy(() => {
    return featureModules[name]()
      .then((mod) => bindExport(name, mod as Record<string, unknown>))
      .catch(() => ({ default: Empty }));
  });
}

const SkipRecap = lazyFeature('SkipRecap');
const SeekSkip = lazyFeature('SeekSkip');
const ProgressBar = lazyFeature('ProgressBar');
const LiveOverlay = lazyFeature('LiveOverlay');
const NextUp = lazyFeature('NextUp');
const SubtitlePicker = lazyFeature('SubtitlePicker');
const AudioPicker = lazyFeature('AudioPicker');
const QualityPicker = lazyFeature('QualityPicker');
const PlaybackSpeed = lazyFeature('PlaybackSpeed');
const Buffering = lazyFeature('Buffering');
const PlaybackError = lazyFeature('PlaybackError');
const VolumeControl = lazyFeature('VolumeControl');
const FocusLayer = lazyFeature('FocusLayer');
const Trickplay = lazyFeature('Trickplay');
const AmbientBackdrop = lazyFeature('AmbientBackdrop');
const WatchlistAction = lazyFeature('WatchlistAction');
const RemoteHints = lazyFeature('RemoteHints');
const MouseLayer = lazyFeature('MouseLayer');

class FeatureGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function Slot({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <FeatureGuard>
      <Suspense fallback={null}>{children}</Suspense>
    </FeatureGuard>
  );
}

const rootStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 4,
  pointerEvents: 'none',
  background: 'transparent',
};

function FullscreenControl(): React.JSX.Element | null {
  const [available, setAvailable] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = (): void => {
      setAvailable(fullscreenAvailable());
      const video = document.querySelector<HTMLVideoElement>('.player__video, .player video') as
        (HTMLVideoElement & { webkitDisplayingFullscreen?: boolean }) | null;
      setActive(document.fullscreenElement != null || video?.webkitDisplayingFullscreen === true);
    };
    sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitbeginfullscreen', sync, true);
    document.addEventListener('webkitendfullscreen', sync, true);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitbeginfullscreen', sync, true);
      document.removeEventListener('webkitendfullscreen', sync, true);
    };
  }, []);

  if (!available) return null;
  return <FocusButton id="player-fullscreen" ariaLabel={active ? 'Exit fullscreen' : 'Fullscreen'} title={active ? 'Exit fullscreen (F)' : 'Fullscreen (F)'} onSelect={() => {
    void toggleFullscreen(document.querySelector('.player'));
  }}><PlayerGlyph name="fullscreen" /></FocusButton>;
}

/**
 * Desktop playback chrome shell. Each named feature is a separate lazy chunk
 * at `./features/<Name>`. Title and transport live in ChromeFrame; overlays
 * stay siblings so a missing module cannot swallow the rest of the controls.
 */
export function PlayerRoot({ session: sourceSession, children }: PlayerRootProps): React.JSX.Element {
  const navigate = useNavigate();
  const session = sourceSession;
  const idle = useIdleChrome({
    paused: session.paused,
    buffering: session.buffering,
    busy: session.busy,
    error: session.error,
    overlay: session.overlay,
    playing: session.engine !== 'loading' && !session.paused,
    inRecapWindow: isInRecapWindow({
      skipRecap: session.skipRecap,
      position: session.position,
      overlay: session.overlay,
      live: session.live,
      mediaId: session.mediaId,
    }),
  });
  const visibleSession = useMemo(() => ({ ...sourceSession, controlsVisible: idle.chromeVisible }), [sourceSession, idle.chromeVisible]);

  useEffect(() => {
    const player = document.querySelector('.player');
    if (player) applyIdleChromeHost(player, idle.chromeVisible, idle.recapVisible);
  }, [idle.chromeVisible, idle.recapVisible]);

  return (
    <PlayerSessionContext.Provider value={visibleSession}>
      <div
        className="player-root"
        data-player-root="true"
        data-wrap="x"
        data-controls={idle.chromeVisible ? 'visible' : 'hidden'}
        data-engine={session.engine}
        data-paused={session.paused ? 'true' : 'false'}
        data-buffering={session.buffering ? 'true' : 'false'}
        data-busy={session.busy ? 'true' : 'false'}
        style={rootStyle}
      >
        <Slot>{session.engine === 'native' ? null : <AmbientBackdrop {...session} />}</Slot>
        <Slot>
          <FocusLayer {...session} />
        </Slot>
        <Slot>
          <MouseLayer {...session} />
        </Slot>
        <Slot>
          <KeyboardLayer
            playPause={session.togglePlayback}
            seekBy={session.seek}
            back={session.close}
            showChrome={idle.show}
            volumeBy={session.adjustVolume}
          />
        </Slot>
        <CinemaControls session={visibleSession}
          progress={<Slot><ProgressBar {...visibleSession} /></Slot>}
          volume={<Slot><VolumeControl {...visibleSession} /></Slot>}
          tools={<><Slot><SubtitlePicker {...visibleSession} /></Slot><Slot><AudioPicker {...visibleSession} /></Slot><Slot><QualityPicker {...visibleSession} /></Slot><Slot><PlaybackSpeed {...visibleSession} /></Slot></>}
          fullscreen={<FullscreenControl />}
          actions={<>
            {!session.live && <FocusButton id="player-download" ariaLabel="Download" title="Download" onSelect={() => {
              session.pause();
              navigate.pushModal('downloads', { params: { id: session.mediaId.replace(/^(tt\d+):\d+:\d+$/, '$1'), title: session.title, series: session.season !== undefined, season: session.season, episode: session.episode, episodeId: session.mediaId } });
            }}><PlayerGlyph name="download" /></FocusButton>}
            <Slot><WatchlistAction {...visibleSession} /></Slot>
          </>}
        />
        <Slot>
          <LiveOverlay {...session} />
        </Slot>
        <Slot>
          <Trickplay {...session} />
        </Slot>
        <Slot>
          <SeekSkip {...session} />
        </Slot>
        <Slot>
          <Buffering {...session} />
        </Slot>
        <Slot>
          <PlaybackError {...session} />
        </Slot>
        <Slot>
          <SkipRecap {...session} />
        </Slot>
        <Slot>
          <NextUp {...session} />
        </Slot>
        <Slot>
          <RemoteHints {...visibleSession} />
        </Slot>
        {children}
      </div>
    </PlayerSessionContext.Provider>
  );
}
