import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { FocusButton } from '../../components/FocusButton';
import { IconVolume, IconVolumeMute } from '../../components/Icons';

export const PLAYER_MUTE_ID = 'player-mute';
export const VOLUME_STEP = 0.1;
export const VOLUME_WHEEL_STEP = 0.05;
export const OS_VOLUME_HINT = 'Use the TV volume buttons';

export type VolumeMode = 'programmable' | 'os' | 'pending';

export interface VolumeControlProps {
  videoRef?: RefObject<HTMLVideoElement | null>;
  video?: HTMLVideoElement | null;
  engine?: 'loading' | 'html5' | 'native' | string;
  volume?: number;
  muted?: boolean;
  controlsVisible?: boolean;
  visible?: boolean;
  /** Force the OS-only hint (native/mpv). When omitted, probed from engine + video.volume. */
  osOnly?: boolean;
  adjustVolume?: (delta: number) => void;
  setMuted?: (muted: boolean) => void;
  showControls?: () => void;
}

const STYLE_ID = 'tvm-player-volume-css';
const probeCache = new WeakMap<HTMLMediaElement, boolean>();

const CSS = `
.player-volume {
  position: relative;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 12.5rem;
  max-width: min(22rem, 42vw);
  padding: 0.35rem 0.55rem 0.35rem 0.3rem;
  border-radius: var(--tvm-radius-pill, 999rem);
  background: color-mix(in srgb, var(--tvm-bg-deep, #000) 38%, transparent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  color: var(--tvm-text, #f5f5f5);
  pointer-events: auto;
  user-select: none;
  opacity: 1;
  transition: opacity var(--tvm-motion-base, 200ms) var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
}

.player-volume[data-hidden='true'] {
  opacity: 0;
  pointer-events: none;
}

.player-volume--os {
  pointer-events: none;
}

.player-volume .tvm-button.player-volume__mute {
  flex: 0 0 auto;
  width: 3.1rem;
  min-width: 3.1rem;
  height: 3.1rem;
  min-height: 3.1rem;
  padding: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  box-shadow: none;
}

.player-volume .tvm-button.player-volume__mute .tvm-button__label {
  justify-content: center;
  gap: 0;
}

.player-volume .tvm-button.player-volume__mute[data-focused='true'] {
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 var(--tvm-focus-ring-width, 0.18rem) var(--tvm-focus-ring-color, #fff);
}

.player-volume__glyph {
  width: 1.35rem;
  height: 1.35rem;
}

.player-volume__meter {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  flex: 1 1 auto;
}

.player-volume__track {
  display: block;
  width: 7.6rem;
  height: 0.38rem;
  overflow: hidden;
  border-radius: var(--tvm-radius-pill, 999rem);
  background: rgba(255, 255, 255, 0.22);
}

.player-volume__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #fff;
  transition: width var(--tvm-motion-fast, 140ms) var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
}

.player-volume__pct {
  min-width: 2.4rem;
  color: var(--tvm-text, #f5f5f5);
  font-size: var(--tvm-font-size-caption, 0.8125rem);
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}

.player-volume__hint {
  color: color-mix(in srgb, var(--tvm-text, #f5f5f5) 78%, transparent);
  font-size: var(--tvm-font-size-caption, 0.8125rem);
  font-weight: 650;
  letter-spacing: 0.04em;
  line-height: 1.25;
}

.player-volume__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .player-volume,
  .player-volume__fill {
    transition: none;
  }
}
`;

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

/**
 * True when writing `media.volume` actually sticks. iOS and some TV browsers
 * expose the property but keep OS volume in charge.
 */
export function canSetVideoVolume(media: HTMLMediaElement | null | undefined): boolean {
  if (media == null) return false;
  const cached = probeCache.get(media);
  if (cached !== undefined) return cached;
  try {
    const before = media.volume;
    const probe = before > 0.5 ? before - 0.0625 : before + 0.0625;
    media.volume = probe;
    const ok = Math.abs(media.volume - probe) < 0.02;
    media.volume = before;
    probeCache.set(media, ok);
    return ok;
  } catch {
    probeCache.set(media, false);
    return false;
  }
}

export function resolveVolumeMode(input: {
  engine?: string;
  video?: HTMLVideoElement | null;
  osOnly?: boolean;
}): VolumeMode {
  if (input.osOnly === true) return 'os';
  if (input.engine === 'native') return 'os';
  if (input.video != null) return canSetVideoVolume(input.video) ? 'programmable' : 'os';
  if (input.engine === 'html5') return 'programmable';
  return 'pending';
}

function unwrapVideo(
  video: HTMLVideoElement | null | undefined,
  videoRef: RefObject<HTMLVideoElement | null> | undefined,
): HTMLVideoElement | null {
  if (video != null) return video;
  return videoRef?.current ?? null;
}

function findPlayerVideo(host: HTMLElement | null): HTMLVideoElement | null {
  const scope = host?.closest('.player, [data-player], [data-player-root], .player-root') ?? document;
  const found = scope.querySelector('video.player__video, .player video, video');
  return found instanceof HTMLVideoElement ? found : null;
}

function nativeShell(host: HTMLElement | null): boolean {
  const root = host?.closest('.player, [data-player], [data-player-root], .player-root');
  if (root === null || root === undefined) {
    return document.querySelector('.player--native, [data-engine="native"]') !== null;
  }
  return root.classList.contains('player--native') || root.getAttribute('data-engine') === 'native';
}

function bumpActivity(showControls?: () => void): void {
  showControls?.();
  window.dispatchEvent(new CustomEvent('tvm:user-activity'));
}

/**
 * Remote mute + level when the desktop html5 player can set `video.volume`.
 * Native/mpv and OS-locked volume get a hint — never a fake slider.
 */
export function VolumeControl({
  videoRef,
  video,
  engine,
  volume: volumeProp,
  muted: mutedProp,
  controlsVisible,
  visible,
  osOnly,
  adjustVolume,
  setMuted,
  showControls,
}: VolumeControlProps): React.JSX.Element | null {
  const hostRef = useRef<HTMLDivElement>(null);
  const [found, setFound] = useState<HTMLVideoElement | null>(null);
  const [localVolume, setLocalVolume] = useState(1);
  const [localMuted, setLocalMuted] = useState(false);
  const chromeVisible = controlsVisible ?? visible ?? true;

  const resolveVideo = useCallback(
    (): HTMLVideoElement | null => unwrapVideo(video, videoRef) ?? found ?? findPlayerVideo(hostRef.current),
    [found, video, videoRef],
  );

  useEffect(() => {
    ensureStyles();
  }, []);

  useEffect(() => {
    const scan = (): void => {
      const next = unwrapVideo(video, videoRef) ?? findPlayerVideo(hostRef.current);
      setFound((current) => (current === next ? current : next));
    };
    scan();
    const pulse = window.setInterval(scan, 400);
    return () => window.clearInterval(pulse);
  }, [video, videoRef]);

  useEffect(() => {
    const node = resolveVideo();
    if (node === null) return;
    const sync = (): void => {
      setLocalVolume(node.volume);
      setLocalMuted(node.muted);
    };
    sync();
    node.addEventListener('volumechange', sync);
    return () => node.removeEventListener('volumechange', sync);
  }, [resolveVideo]);

  const node = resolveVideo();
  const mode = resolveVolumeMode({
    engine: engine ?? (nativeShell(hostRef.current) ? 'native' : undefined),
    video: node,
    osOnly,
  });

  const volume = clampVolume(volumeProp ?? localVolume);
  const muted = mutedProp ?? localMuted;
  const silent = muted || volume === 0;
  const shown = Math.round((silent ? 0 : volume) * 100);

  const applyDelta = useCallback(
    (delta: number): void => {
      if (mode !== 'programmable') return;
      bumpActivity(showControls);
      if (adjustVolume !== undefined) {
        adjustVolume(delta);
        return;
      }
      const media = resolveVideo();
      const next = clampVolume((media?.volume ?? volume) + delta);
      if (media !== null) {
        media.volume = next;
        media.muted = false;
      }
      setLocalVolume(next);
      setLocalMuted(false);
    },
    [adjustVolume, mode, resolveVideo, showControls, volume],
  );

  const toggleMute = useCallback((): void => {
    if (mode !== 'programmable') return;
    bumpActivity(showControls);
    const next = !muted;
    const media = resolveVideo();
    if (media !== null) media.muted = next;
    if (setMuted !== undefined) setMuted(next);
    else setLocalMuted(next);
  }, [mode, muted, resolveVideo, setMuted, showControls]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || mode !== 'programmable') return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      applyDelta(event.deltaY > 0 ? -VOLUME_WHEEL_STEP : VOLUME_WHEEL_STEP);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [applyDelta, mode]);

  if (mode === 'pending') return null;

  if (mode === 'os') {
    return (
      <div
        ref={hostRef}
        className="player-volume player-volume--os player__vol"
        data-player-volume="os"
        data-hidden={chromeVisible ? undefined : 'true'}
        role="status"
        aria-live="polite"
      >
        <IconVolume className="player-volume__glyph player__glyph" />
        <span className="player-volume__hint">{OS_VOLUME_HINT}</span>
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="player-volume player__vol"
      data-player-volume="programmable"
      data-hidden={chromeVisible ? undefined : 'true'}
      data-wrap="row"
    >
      <FocusButton
        id={PLAYER_MUTE_ID}
        className="player-volume__mute player__icon"
        variant="quiet"
        onSelect={toggleMute}
        onArrowPress={(direction) => {
          if (direction === 'up') {
            applyDelta(VOLUME_STEP);
            return false;
          }
          if (direction === 'down') {
            applyDelta(-VOLUME_STEP);
            return false;
          }
          return true;
        }}
      >
        {silent ? (
          <IconVolumeMute className="player-volume__glyph player__glyph" />
        ) : (
          <IconVolume className="player-volume__glyph player__glyph" />
        )}
        <span className="player-volume__sr">{silent ? 'Unmute' : 'Mute'}</span>
      </FocusButton>
      <div className="player-volume__meter" aria-hidden="true">
        <span className="player-volume__track player__vol-track">
          <span className="player-volume__fill player__vol-fill" style={{ width: `${shown}%` }} />
        </span>
        <span className="player-volume__pct">{shown}</span>
      </div>
    </div>
  );
}

export default VolumeControl;
