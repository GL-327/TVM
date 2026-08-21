import {
  Component,
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  type ComponentType,
  type CSSProperties,
  type LazyExoticComponent,
  type ReactNode,
  type RefObject,
} from 'react';

import { ChromeFrame } from './features/ChromeFrame';
import { KeyboardLayer } from './features/KeyboardLayer';
import { mountIdleChromeStyles, syncIdleChromeHosts } from './features/IdleChrome';
import { isInRecapWindow, useIdleChrome } from './features/useIdleChrome';
import './features/player-chrome.css';
import './features/perf.css';

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
  setMuted: (muted: boolean) => void;
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

const featureModules = import.meta.glob('./features/*.{ts,tsx}');

function bindExport(
  name: FeatureName,
  mod: Record<string, unknown>,
): { default: ComponentType<PlayerSession> } {
  const exported = mod[name] ?? mod.default;
  if (typeof exported === 'function') return { default: exported as ComponentType<PlayerSession> };
  return { default: Empty };
}

function lazyFeature(name: FeatureName): LazyExoticComponent<ComponentType<PlayerSession>> {
  const path = `./features/${name}`;
  return lazy(() => {
    const loader = featureModules[`${path}.tsx`] ?? featureModules[`${path}.ts`];
    const load =
      loader ??
      ((): Promise<Record<string, unknown>> => Promise.reject(new Error(`missing ${path}`)));
    return load()
      .then((mod) => bindExport(name, mod as Record<string, unknown>))
      .catch(() => ({ default: Empty }));
  });
}

const SkipRecap = lazyFeature('SkipRecap');
const SeekSkip = lazyFeature('SeekSkip');
const TransportBar = lazyFeature('TransportBar');
const ProgressBar = lazyFeature('ProgressBar');
const TitleOverlay = lazyFeature('TitleOverlay');
const LiveOverlay = lazyFeature('LiveOverlay');
const NextUp = lazyFeature('NextUp');
const SubtitlePicker = lazyFeature('SubtitlePicker');
const AudioPicker = lazyFeature('AudioPicker');
const QualityPicker = lazyFeature('QualityPicker');
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

/**
 * Desktop playback chrome shell. Each named feature is a separate lazy chunk
 * at `./features/<Name>`. Title and transport live in ChromeFrame; overlays
 * stay siblings so a missing module cannot swallow the rest of the controls.
 */
export function PlayerRoot({ session, children }: PlayerRootProps): React.JSX.Element {
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

  useEffect(() => {
    mountIdleChromeStyles();
  }, []);

  useEffect(() => {
    syncIdleChromeHosts(idle.chromeVisible, idle.recapVisible);
  }, [idle.chromeVisible, idle.recapVisible]);

  return (
    <PlayerSessionContext.Provider value={session}>
      <div
        className="player-root"
        data-player-root="true"
        data-wrap="x"
        data-controls={idle.chromeVisible ? 'visible' : 'hidden'}
        data-engine={session.engine}
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
        <ChromeFrame
          visible={idle.chromeVisible}
          top={
            <div className="player-chrome-head">
              <Slot>
                <TitleOverlay {...session} />
              </Slot>
              <Slot>
                <WatchlistAction {...session} />
              </Slot>
            </div>
          }
          bottom={
            <div className="player-dock" data-player-dock="">
              <div className="player-dock__tools">
                <Slot>
                  <VolumeControl {...session} />
                </Slot>
                <Slot>
                  <SubtitlePicker {...session} />
                </Slot>
                <Slot>
                  <AudioPicker {...session} />
                </Slot>
                <Slot>
                  <QualityPicker {...session} />
                </Slot>
              </div>
              <Slot>
                <ProgressBar {...session} />
              </Slot>
              <Slot>
                <TransportBar {...session} />
              </Slot>
            </div>
          }
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
          <RemoteHints {...session} />
        </Slot>
        {children}
      </div>
    </PlayerSessionContext.Provider>
  );
}
