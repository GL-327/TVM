import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FocusButton } from '../../components/FocusButton';
import { IconChevronLeft, IconForward, IconPause, IconPlay, IconRewind } from '../../components/Icons';
import { requestFocus } from '../../nav/focusEngine';
import { useScopedFocusKey } from '../../nav/ViewStackContext';
import { usePlayerSession } from '../PlayerRoot';

/** Stable `data-focus-id` values. Default landing target is `play`. */
export const TRANSPORT_FOCUS_IDS = {
  play: 'player-play',
  seekBack: 'player-seek-back',
  seekFwd: 'player-seek-fwd',
  back: 'player-back',
} as const;

export const TRANSPORT_DEFAULT_FOCUS = TRANSPORT_FOCUS_IDS.play;

export type TransportFocusId = (typeof TRANSPORT_FOCUS_IDS)[keyof typeof TRANSPORT_FOCUS_IDS];

type SeekBy = (deltaSeconds: number) => void;

let cachedSeekBy: SeekBy | undefined;

function asSeekBy(value: unknown): SeekBy | undefined {
  return typeof value === 'function' ? (value as SeekBy) : undefined;
}

/** Hint passed to SeekSkip — this bar does not clamp, wrap, or apply time. */
const SEEK_BY_HINT_SECONDS = 10;

const seekSkipModules = import.meta.glob<{ seekBy?: SeekBy }>('./SeekSkip.tsx');

function loadSeekBy(): Promise<SeekBy | undefined> {
  if (cachedSeekBy) return Promise.resolve(cachedSeekBy);
  const load = seekSkipModules['./SeekSkip.tsx'];
  if (load === undefined) return Promise.resolve(undefined);
  return load()
    .then((mod) => {
      const fn = asSeekBy(mod.seekBy);
      if (fn) cachedSeekBy = fn;
      return fn;
    })
    .catch(() => undefined);
}

function emitMediaIntent(intent: string): void {
  window.dispatchEvent(new CustomEvent<string>('tvm:media-intent', { detail: intent }));
}

function requestTransportSeek(deltaSeconds: number, fallback?: SeekBy): void {
  const apply = (fn: SeekBy | undefined): void => {
    if (fn) {
      fn(deltaSeconds);
      return;
    }
    if (fallback) {
      fallback(deltaSeconds);
      return;
    }
    emitMediaIntent(deltaSeconds < 0 ? 'rewind' : 'fastForward');
  };

  if (cachedSeekBy) {
    apply(cachedSeekBy);
    return;
  }
  void loadSeekBy().then(apply);
}

function slotChild(value: ReactNode): ReactNode {
  if (value === true || value === false) return null;
  return value ?? null;
}

export interface TransportBarProps {
  paused?: boolean;
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
  controlsVisible?: boolean;
  visible?: boolean;
  autoFocus?: boolean;
  /** React node for the Skip Recap slot. A boolean from PlayerSession is ignored. */
  skipRecap?: ReactNode;
  nextEpisode?: ReactNode;
  togglePlayback?: () => void;
  onPlayPause?: () => void;
  close?: () => void;
  onBack?: () => void;
  seek?: (deltaSeconds: number) => void;
  showControls?: () => void;
}

const TRANSPORT_CSS = `
.player-transport {
  position: relative;
  z-index: 5;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 1rem;
  width: 100%;
  padding: 0;
  pointer-events: auto;
}
.player-transport[data-visible='false'] {
  opacity: 0;
  pointer-events: none;
}
.player-transport__cluster {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}
.player-transport__cluster--start { justify-self: start; }
.player-transport__cluster--center { justify-self: center; gap: 0.85rem; }
.player-transport__cluster--end { justify-self: end; }
.player-transport__slot:empty { display: none; }
.player-transport__glyph { width: 1.45rem; height: 1.45rem; }
.player-transport__btn--play .player-transport__glyph { width: 1.85rem; height: 1.85rem; }
.player-transport__caption {
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  line-height: 1;
  text-transform: uppercase;
}
`;

function useDerivedPaused(controlled: boolean | undefined): boolean {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (controlled !== undefined) return;
    const video = document.querySelector<HTMLVideoElement>('.player__video, .player video, video');
    if (video === null) return;
    const sync = (): void => setPaused(video.paused);
    sync();
    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);
    return () => {
      video.removeEventListener('play', sync);
      video.removeEventListener('pause', sync);
    };
  }, [controlled]);

  return controlled ?? paused;
}

export function TransportBar({
  paused: pausedProp,
  busy: busyProp = false,
  disabled = false,
  error = null,
  controlsVisible,
  visible: visibleProp,
  autoFocus = true,
  skipRecap,
  nextEpisode,
  togglePlayback,
  onPlayPause,
  close,
  onBack,
  seek,
  showControls,
}: TransportBarProps): React.JSX.Element {
  const session = usePlayerSession();
  const paused = useDerivedPaused(pausedProp ?? session?.paused);
  const visible = visibleProp ?? controlsVisible ?? session?.controlsVisible ?? true;
  const seekBlocked = disabled || busyProp || session?.busy === true || error !== null || session?.error !== null;
  const playKey = useScopedFocusKey(TRANSPORT_FOCUS_IDS.play);
  const groupKey = useScopedFocusKey('player-transport');
  const { ref } = useFocusable<object, HTMLElement>({
    focusKey: groupKey,
    focusable: false,
    trackChildren: true,
    saveLastFocusedChild: true,
    preferredChildFocusKey: playKey,
  });
  const preloaded = useRef(false);

  useEffect(() => {
    if (preloaded.current) return;
    preloaded.current = true;
    void loadSeekBy();
  }, []);

  useEffect(() => {
    if (!autoFocus || !visible) return;
    const frame = window.requestAnimationFrame(() => requestFocus(playKey));
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus, playKey, visible]);

  const bumpChrome = (): void => {
    (showControls ?? session?.showControls)?.();
  };

  const playLabel = paused ? 'Play' : 'Pause';

  return (
    <nav
      ref={ref}
      className="player-transport"
      aria-label="Playback"
      data-player-transport="true"
      data-default-focus={TRANSPORT_DEFAULT_FOCUS}
      data-visible={visible ? 'true' : 'false'}
      inert={!visible ? true : undefined}
    >
      <style>{TRANSPORT_CSS}</style>
      <div className="player-transport__cluster player-transport__cluster--start">
        <FocusButton
          id={TRANSPORT_FOCUS_IDS.back}
          className="player-transport__btn player-transport__btn--back"
          disabled={!visible}
          onSelect={() => {
            bumpChrome();
            const go = onBack ?? close ?? session?.close;
            if (go) {
              go();
              return;
            }
            emitMediaIntent('stop');
          }}
        >
          <IconChevronLeft className="player-transport__glyph" />
          Back
        </FocusButton>
        <div className="player-transport__slot" data-slot="skip-recap">
          {slotChild(skipRecap)}
        </div>
      </div>

      <div className="player-transport__cluster player-transport__cluster--center">
        <FocusButton
          id={TRANSPORT_FOCUS_IDS.seekBack}
          className="player-transport__btn"
          disabled={!visible || seekBlocked}
          onSelect={() => {
            bumpChrome();
            requestTransportSeek(-SEEK_BY_HINT_SECONDS, seek ?? session?.seek);
          }}
        >
          <IconRewind className="player-transport__glyph" />
          <span className="player-transport__caption">10</span>
        </FocusButton>
        <FocusButton
          id={TRANSPORT_FOCUS_IDS.play}
          className="player-transport__btn player-transport__btn--play"
          variant="primary"
          disabled={!visible}
          onSelect={() => {
            bumpChrome();
            const toggle = onPlayPause ?? togglePlayback ?? session?.togglePlayback;
            if (toggle) {
              toggle();
              return;
            }
            emitMediaIntent('playPause');
          }}
        >
          {paused ? (
            <IconPlay className="player-transport__glyph" />
          ) : (
            <IconPause className="player-transport__glyph" />
          )}
          <span className="player-transport__caption">{playLabel}</span>
        </FocusButton>
        <FocusButton
          id={TRANSPORT_FOCUS_IDS.seekFwd}
          className="player-transport__btn"
          disabled={!visible || seekBlocked}
          onSelect={() => {
            bumpChrome();
            requestTransportSeek(SEEK_BY_HINT_SECONDS, seek ?? session?.seek);
          }}
        >
          <IconForward className="player-transport__glyph" />
          <span className="player-transport__caption">10</span>
        </FocusButton>
      </div>

      <div className="player-transport__cluster player-transport__cluster--end">
        <div className="player-transport__slot" data-slot="next-episode">
          {slotChild(nextEpisode)}
        </div>
      </div>
    </nav>
  );
}

export default TransportBar;
