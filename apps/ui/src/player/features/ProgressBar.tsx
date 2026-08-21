import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { revealFocused } from '../../nav/revealFocused';
import { useScopedFocusKey } from '../../nav/ViewStackContext';

export const PROGRESS_FOCUS_ID = 'player-progress';
export const DEFAULT_SEEK_STEP = 10;
/** Arrow nudges on the bar — a slice of duration, not a 10s skip. */
export const BAR_NUDGE_RATIO = 0.015;
export const BAR_NUDGE_MIN_SECONDS = 8;
/** Wait until the D-pad rests before committing, so HLS keeps the last frame. */
export const BAR_COMMIT_MS = 280;

export type VideoRef = RefObject<HTMLVideoElement | null>;

export interface ProgressBarProps {
  currentTime?: number;
  /** Session alias for {@link currentTime}. */
  position?: number;
  duration?: number;
  /** Buffered end in seconds, 0–1 ratio, or a live TimeRanges object. */
  buffered?: number | TimeRanges;
  video?: HTMLVideoElement | VideoRef | null;
  videoRef?: VideoRef;
  /** Absolute seek in seconds. Wins over touching the video element. */
  onSeek?: (seconds: number) => void;
  /** Session alias for {@link onSeek}. */
  seekTo?: (seconds: number) => void;
  /** Relative skip. Not used by bar arrows — those scrub the playhead. */
  seekBy?: (deltaSeconds: number) => void;
  engine?: string;
  live?: boolean;
  disabled?: boolean;
  stepSeconds?: number;
  className?: string;
}

interface Clock {
  time: number;
  duration: number;
  buffered: number;
}

const STYLE_ID = 'tvm-progress-css';

const CSS = `
.tvm-progress {
  display: grid;
  grid-template-columns: minmax(4.5rem, auto) minmax(0, 1fr) minmax(4.5rem, auto);
  align-items: center;
  gap: 1rem 1.15rem;
  width: 100%;
  min-height: 3.25rem;
  padding: 0.15rem 0;
  color: var(--tvm-text);
  font-family: var(--tvm-font-family);
  user-select: none;
  -webkit-user-select: none;
}

.tvm-progress__time {
  min-width: 4.5rem;
  color: var(--tvm-text);
  font-size: var(--tvm-font-size-body-lg);
  font-weight: 680;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  line-height: var(--tvm-line-height-tight);
  text-shadow: 0 0.12rem 0.55rem rgba(0, 0, 0, 0.65);
  white-space: nowrap;
}

.tvm-progress__time--end {
  text-align: right;
}

.tvm-progress__remain {
  display: block;
  margin-top: 0.2rem;
  color: var(--tvm-text-muted);
  font-size: var(--tvm-font-size-caption);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.tvm-progress__control {
  position: relative;
  display: block;
  width: 100%;
  margin: 0;
  padding: 1rem 0.35rem;
  border: none;
  border-radius: var(--tvm-radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  touch-action: none;
  cursor: inherit;
}

.tvm-progress__control:disabled {
  opacity: 0.45;
}

.tvm-progress__control:focus {
  outline: none;
}

.tvm-progress__track {
  position: relative;
  display: block;
  height: 0.55rem;
  border-radius: var(--tvm-radius-pill);
  background: color-mix(in srgb, #fff 18%, transparent);
  box-shadow: inset 0 0 0 0.06rem rgba(255, 255, 255, 0.08);
  transition:
    height var(--tvm-motion-fast) var(--tvm-motion-ease),
    background var(--tvm-motion-fast) var(--tvm-motion-ease);
}

.tvm-progress__control[data-focused='true'] .tvm-progress__track,
.tvm-progress__control[data-scrubbing='true'] .tvm-progress__track {
  height: 0.82rem;
  background: color-mix(in srgb, #fff 26%, transparent);
}

.tvm-progress__buffered,
.tvm-progress__played {
  position: absolute;
  inset: 0 auto 0 0;
  display: block;
  height: 100%;
  border-radius: inherit;
  pointer-events: none;
}

.tvm-progress__buffered {
  background: color-mix(in srgb, #fff 34%, transparent);
}

.tvm-progress__played {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--tvm-mark) 82%, #fff) 0%,
    var(--tvm-mark) 100%
  );
  box-shadow: 0 0 0.85rem var(--tvm-mark-glow);
}

.tvm-progress__knob {
  position: absolute;
  top: 50%;
  z-index: 1;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 50%;
  background: #fff;
  box-shadow:
    0 0 0 0.16rem color-mix(in srgb, var(--tvm-mark) 70%, transparent),
    0 0.25rem 0.7rem rgba(0, 0, 0, 0.45);
  transform: translate(-50%, -50%);
  pointer-events: none;
  transition:
    width var(--tvm-motion-fast) var(--tvm-motion-ease),
    height var(--tvm-motion-fast) var(--tvm-motion-ease),
    box-shadow var(--tvm-motion-fast) var(--tvm-motion-ease);
}

.tvm-progress__control[data-focused='true'] .tvm-progress__knob,
.tvm-progress__control[data-scrubbing='true'] .tvm-progress__knob {
  width: 1.7rem;
  height: 1.7rem;
  box-shadow:
    0 0 0 var(--tvm-focus-ring-width) var(--tvm-focus-ring-color),
    0 0 0 calc(var(--tvm-focus-ring-width) + var(--tvm-focus-ring-offset))
      color-mix(in srgb, var(--tvm-mark) 55%, transparent),
    0 0.35rem 1rem rgba(0, 0, 0, 0.5);
}

.tvm-progress__bubble {
  position: absolute;
  bottom: calc(100% + 0.45rem);
  z-index: 2;
  padding: 0.28rem 0.62rem;
  border-radius: var(--tvm-radius-sm);
  background: color-mix(in srgb, var(--tvm-bg-elevated) 88%, transparent);
  box-shadow: var(--tvm-shadow-card);
  color: var(--tvm-text);
  font-size: var(--tvm-font-size-body);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.03em;
  line-height: 1;
  pointer-events: none;
  transform: translateX(-50%);
  white-space: nowrap;
}

.tvm-progress__live {
  justify-self: end;
  padding: 0.2rem 0.55rem;
  border-radius: var(--tvm-radius-pill);
  background: color-mix(in srgb, var(--tvm-danger) 28%, transparent);
  color: #fff;
  font-size: var(--tvm-font-size-caption);
  font-weight: 750;
  letter-spacing: 0.12em;
}

@media (prefers-reduced-motion: reduce) {
  .tvm-progress__track,
  .tvm-progress__knob {
    transition: none;
  }
}
`;

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function formatPlayerTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const total = Math.floor(value);
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`;
}

export function clampTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return seconds;
  return Math.min(duration, seconds);
}

export function isSeekableDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

/** Map a pointer X on the track to an absolute media time. */
export function timeFromClientX(clientX: number, track: DOMRect, duration: number): number {
  if (!isSeekableDuration(duration) || track.width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - track.left) / track.width));
  return ratio * duration;
}

export function bufferedEndSeconds(
  buffered: number | TimeRanges | undefined,
  currentTime: number,
  duration: number,
): number {
  if (typeof buffered === 'number') {
    if (!Number.isFinite(buffered)) return Math.max(0, currentTime);
    if (buffered >= 0 && buffered <= 1 && duration > 1) return buffered * duration;
    return Math.max(0, buffered);
  }
  if (buffered === undefined || buffered.length === 0) return Math.max(0, currentTime);
  const ranges = buffered;
  for (let i = 0; i < ranges.length; i += 1) {
    if (currentTime >= ranges.start(i) && currentTime <= ranges.end(i)) {
      return ranges.end(i);
    }
  }
  let end = 0;
  for (let i = 0; i < ranges.length; i += 1) end = Math.max(end, ranges.end(i));
  return end;
}

function unwrapVideo(video: ProgressBarProps['video']): HTMLVideoElement | null {
  if (video === undefined || video === null) return null;
  if (video instanceof HTMLVideoElement) return video;
  return video.current;
}

function findPlayerVideo(root: HTMLElement | null): HTMLVideoElement | null {
  const scope = root?.closest('.player') ?? document;
  return scope.querySelector<HTMLVideoElement>('video.player__video, .player__video, video');
}

function readVideoClock(video: HTMLVideoElement): Clock {
  const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  return {
    time,
    duration,
    buffered: bufferedEndSeconds(video.buffered, time, duration),
  };
}

export function barNudgeSeconds(duration: number): number {
  if (!isSeekableDuration(duration)) return BAR_NUDGE_MIN_SECONDS;
  return Math.max(BAR_NUDGE_MIN_SECONDS, duration * BAR_NUDGE_RATIO);
}

export function nudgeTime(from: number, direction: -1 | 1, duration: number): number {
  return clampTime(from + direction * barNudgeSeconds(duration), duration);
}

/**
 * Apply an absolute seek. Callbacks win so PlayerRoot can own the engine.
 * Native mpv is never written through the empty html5 element — that paints black.
 */
export function applyAbsoluteSeek(
  seconds: number,
  options: {
    duration: number;
    onSeek?: (seconds: number) => void;
    video?: HTMLVideoElement | null;
    currentTime?: number;
    engine?: string;
  },
): number {
  const target = clampTime(seconds, options.duration);
  if (options.onSeek !== undefined) {
    options.onSeek(target);
    return target;
  }
  if (options.engine !== 'native' && options.video !== null && options.video !== undefined) {
    options.video.currentTime = target;
    return target;
  }
  const native = typeof window !== 'undefined' ? window.tvmNativePlayer : undefined;
  void native?.seekTo?.(target);
  return target;
}

/** Left/Right on the knob: relative skip, same 10s default as transport. */
export function applyRelativeSeek(
  deltaSeconds: number,
  options: {
    currentTime: number;
    duration: number;
    seekBy?: (deltaSeconds: number) => void;
    onSeek?: (seconds: number) => void;
    video?: HTMLVideoElement | null;
  },
): void {
  if (options.seekBy !== undefined) {
    options.seekBy(deltaSeconds);
    return;
  }
  if (options.onSeek !== undefined) {
    options.onSeek(clampTime(options.currentTime + deltaSeconds, options.duration));
    return;
  }
  if (options.video !== null && options.video !== undefined) {
    options.video.currentTime = clampTime(options.video.currentTime + deltaSeconds, options.video.duration);
    return;
  }
  void window.tvmNativePlayer?.command(deltaSeconds < 0 ? 'seekBack' : 'seekForward');
}

export function ProgressBar({
  currentTime,
  position,
  duration,
  buffered,
  video,
  videoRef,
  onSeek,
  seekTo,
  engine,
  live = false,
  disabled = false,
  className,
}: ProgressBarProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const pending = useRef<number | null>(null);
  const commitTimer = useRef<number | null>(null);
  const [clock, setClock] = useState<Clock>({ time: 0, duration: 0, buffered: 0 });
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const resolvedOnSeek = onSeek ?? seekTo;
  const resolvedEngine = engine;
  const resolvedLive = live;

  useEffect(() => {
    ensureStyles();
  }, []);

  useEffect(() => {
    const events = ['timeupdate', 'durationchange', 'progress', 'seeked', 'loadedmetadata'] as const;
    let node: HTMLVideoElement | null = null;

    const syncFromVideo = (): void => {
      const found = unwrapVideo(video ?? videoRef) ?? findPlayerVideo(rootRef.current);
      if (found !== node) {
        for (const event of events) node?.removeEventListener(event, syncFromVideo);
        node = found;
        for (const event of events) node?.addEventListener(event, syncFromVideo);
      }
      if (node === null) return;
      setClock(readVideoClock(node));
    };

    syncFromVideo();
    const poll = window.setInterval(syncFromVideo, 400);
    const nativeOff = window.tvmNativePlayer?.onEvent((event) => {
      if (event.type !== 'state') return;
      setClock((prev) => ({
        time: event.position,
        duration: event.duration,
        buffered: Math.max(prev.buffered, event.position),
      }));
    });

    return () => {
      for (const event of events) node?.removeEventListener(event, syncFromVideo);
      window.clearInterval(poll);
      nativeOff?.();
    };
  }, [video, videoRef]);

  const time = currentTime ?? position ?? clock.time;
  const length = duration ?? clock.duration;
  const bufferEnd =
    buffered !== undefined ? bufferedEndSeconds(buffered, time, length) : clock.buffered;
  const display = scrub ?? time;
  const seekable = !disabled && !resolvedLive && isSeekableDuration(length);
  const playedRatio = seekable ? Math.min(1, Math.max(0, display / length)) : 0;
  const bufferedRatio = seekable ? Math.min(1, Math.max(0, bufferEnd / length)) : 0;
  const remaining = seekable ? Math.max(0, length - display) : 0;
  const bubbleTime = hover ?? display;

  const resolveVideo = useCallback(
    (): HTMLVideoElement | null => unwrapVideo(video ?? videoRef) ?? findPlayerVideo(rootRef.current),
    [video, videoRef],
  );

  const seekAbsolute = useCallback(
    (seconds: number): number =>
      applyAbsoluteSeek(seconds, {
        duration: length,
        onSeek: resolvedOnSeek,
        video: resolveVideo(),
        currentTime: time,
        engine: resolvedEngine,
      }),
    [length, resolveVideo, resolvedEngine, resolvedOnSeek, time],
  );

  const clearCommitTimer = (): void => {
    if (commitTimer.current !== null) {
      window.clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
  };

  const commitPreview = useCallback(
    (seconds?: number): void => {
      clearCommitTimer();
      const target = seconds ?? pending.current;
      if (target === null || !isSeekableDuration(length)) return;
      pending.current = null;
      seekAbsolute(target);
      window.setTimeout(() => setScrub(null), 180);
    },
    [length, seekAbsolute],
  );

  const previewTo = useCallback(
    (seconds: number, commitMs: number | null): void => {
      if (!isSeekableDuration(length)) return;
      const next = clampTime(seconds, length);
      pending.current = next;
      setScrub(next);
      setHover(next);
      clearCommitTimer();
      window.dispatchEvent(new CustomEvent('tvm:user-activity'));
      if (commitMs === null) return;
      commitTimer.current = window.setTimeout(() => commitPreview(next), commitMs);
    },
    [commitPreview, length],
  );

  useEffect(() => {
    return () => clearCommitTimer();
  }, []);

  const pointToTime = useCallback(
    (clientX: number): number => {
      const track = trackRef.current?.getBoundingClientRect();
      if (track === undefined) return display;
      return timeFromClientX(clientX, track, length);
    },
    [display, length],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!seekable) return;
    if (event.pointerType !== 'mouse' && event.pointerType !== 'touch' && event.pointerType !== 'pen') {
      return;
    }
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    previewTo(pointToTime(event.clientX), null);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!seekable) return;
    const next = pointToTime(event.clientX);
    if (dragging.current) {
      previewTo(next, null);
      return;
    }
    if (event.pointerType === 'mouse') setHover(next);
  };

  const endPointer = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (dragging.current) {
      dragging.current = false;
      commitPreview(pointToTime(event.clientX));
    }
    setHover(null);
  };

  const focusKey = useScopedFocusKey(PROGRESS_FOCUS_ID);
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    focusable: seekable,
    onArrowPress: (direction) => {
      if (!seekable) return true;
      if (direction === 'left' || direction === 'right') {
        const from = pending.current ?? display;
        previewTo(nudgeTime(from, direction === 'left' ? -1 : 1, length), BAR_COMMIT_MS);
        return false;
      }
      commitPreview();
      return true;
    },
    onEnterPress: () => {
      commitPreview();
    },
    onFocus: () => {
      const node = ref.current;
      if (node !== null) revealFocused(node);
    },
    onBlur: () => {
      commitPreview();
    },
  });

  const bubbleLeft = `${(hover !== null && seekable ? hover / length : playedRatio) * 100}%`;
  const showBubble = focused || hover !== null || scrub !== null;
  const classes = ['tvm-progress', 'player-progress', className].filter(Boolean).join(' ');
  const bubbleLabel = formatPlayerTime(bubbleTime);

  return (
    <div ref={rootRef} className={classes} data-seek-track="true">
      <span className="tvm-progress__time tvm-progress__time--now">{formatPlayerTime(display)}</span>
      <button
        ref={ref}
        type="button"
        className="tvm-progress__control"
        tabIndex={-1}
        data-focus-id={PROGRESS_FOCUS_ID}
        data-focused={focused ? 'true' : undefined}
        data-scrubbing={dragging.current || scrub !== null ? 'true' : undefined}
        data-seek-arrows="scrub"
        disabled={!seekable}
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={seekable ? Math.floor(length) : 0}
        aria-valuenow={Math.floor(display)}
        aria-valuetext={
          seekable
            ? `${formatPlayerTime(display)} of ${formatPlayerTime(length)}`
            : 'Live'
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => {
          if (!dragging.current) setHover(null);
        }}
        onClick={(event) => {
          event.preventDefault();
          commitPreview();
        }}
      >
        <span className="tvm-progress__track" ref={trackRef}>
          <span className="tvm-progress__buffered" style={{ width: `${bufferedRatio * 100}%` }} />
          <span className="tvm-progress__played" style={{ width: `${playedRatio * 100}%` }} />
          <span className="tvm-progress__knob" style={{ left: `${playedRatio * 100}%` }} />
          {showBubble && seekable && (
            <span className="tvm-progress__bubble" style={{ left: bubbleLeft }}>
              {bubbleLabel}
            </span>
          )}
        </span>
      </button>
      {seekable ? (
        <span className="tvm-progress__time tvm-progress__time--end">
          {formatPlayerTime(length)}
          <span className="tvm-progress__remain">−{formatPlayerTime(remaining)}</span>
        </span>
      ) : (
        <span className="tvm-progress__live">Live</span>
      )}
    </div>
  );
}

export default ProgressBar;
