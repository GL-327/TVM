import { useEffect, useRef, useState, type RefObject } from 'react';
import { TvmMark } from '../../brand/TvmMark';

/** HTMLMediaElement events that drive the indicator. */
export const BUFFERING_EVENTS = ['waiting', 'playing', 'stalled', 'pause'] as const;
export type BufferingEvent = (typeof BUFFERING_EVENTS)[number];

/** Ignore tiny MSE gaps so a healthy stream does not flash the mark. */
const SHOW_DELAY_MS = 520;

const STYLES = `
.tvm-buffering {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: grid;
  place-items: center;
  pointer-events: none;
  opacity: 0;
  transform: scale(0.96);
  transition:
    opacity var(--tvm-motion-slow, 260ms) var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--tvm-motion-slow, 260ms) var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
}

.tvm-buffering[data-on='true'] {
  opacity: 1;
  transform: none;
}

.tvm-buffering__brand {
  filter: drop-shadow(0 0 1.4rem var(--player-fill-glow, rgba(122, 215, 255, 0.55)));
}

.tvm-buffering__label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .tvm-buffering {
    transition-duration: 1ms;
  }
}
`;

export interface BufferingProps {
  /** Video node, or a ref to one. Discovers `.player video` when omitted. */
  video?: HTMLVideoElement | null | RefObject<HTMLVideoElement | null>;
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** Session flag from Player / native. Combined with media events. */
  buffering?: boolean;
  busy?: boolean;
  engine?: 'loading' | 'html5' | 'native';
  overlay?: 'queue' | 'ad' | null;
  error?: string | null;
  /** Force visible (initial load). Combined with media events. */
  active?: boolean;
  onChange?: (buffering: boolean) => void;
}

function unwrapVideo(
  value: HTMLVideoElement | null | RefObject<HTMLVideoElement | null> | undefined,
): HTMLVideoElement | null {
  if (value == null) return null;
  if (value instanceof HTMLVideoElement) return value;
  return value.current;
}

function findVideo(
  explicit: HTMLVideoElement | null | RefObject<HTMLVideoElement | null> | undefined,
  videoRef: RefObject<HTMLVideoElement | null> | undefined,
  host: HTMLElement | null,
): HTMLVideoElement | null {
  const fromProp = unwrapVideo(explicit) ?? unwrapVideo(videoRef);
  if (fromProp !== null) return fromProp;
  const scope = host?.closest('.player') ?? host?.parentElement;
  const scoped = scope?.querySelector('video');
  if (scoped instanceof HTMLVideoElement) return scoped;
  const fallback = document.querySelector('.player video, .player__video');
  return fallback instanceof HTMLVideoElement ? fallback : null;
}

function mediaIsStarved(el: HTMLVideoElement): boolean {
  return !el.paused && el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
}

/**
 * Single loading mark for initial open and mid-stream waits.
 * Decorative only — never focusable, never intercepts pointer input.
 */
export function Buffering({
  video,
  videoRef,
  buffering,
  busy,
  engine,
  overlay,
  error,
  active,
  onChange,
}: BufferingProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [waiting, setWaiting] = useState(false);
  const [latched, setLatched] = useState(engine === 'loading' || busy === true);

  useEffect(() => {
    if (engine === 'loading' || busy === true) {
      setLatched(true);
      return;
    }
    if (buffering === false) setLatched(false);
  }, [busy, buffering, engine]);

  useEffect(() => {
    let attached: HTMLVideoElement | null = null;
    let showTimer = 0;

    const publish = (next: boolean): void => {
      setWaiting((prev) => (prev === next ? prev : next));
    };

    const clearShow = (): void => {
      if (showTimer === 0) return;
      window.clearTimeout(showTimer);
      showTimer = 0;
    };

    const hide = (): void => {
      clearShow();
      setLatched(false);
      publish(false);
    };

    const scheduleShow = (el: HTMLVideoElement): void => {
      if (el.paused) return;
      if (showTimer !== 0) return;
      showTimer = window.setTimeout(() => {
        showTimer = 0;
        if (!el.paused && mediaIsStarved(el)) publish(true);
      }, SHOW_DELAY_MS);
    };

    const onWaiting = (event: Event): void => {
      if (event.currentTarget instanceof HTMLVideoElement) scheduleShow(event.currentTarget);
    };

    const onStalled = (event: Event): void => {
      if (event.currentTarget instanceof HTMLVideoElement) scheduleShow(event.currentTarget);
    };

    const onPlaying = (event: Event): void => {
      if (event.currentTarget instanceof HTMLVideoElement && mediaIsStarved(event.currentTarget)) return;
      hide();
    };

    const onPause = (): void => {
      clearShow();
      publish(false);
    };

    const onTimeUpdate = (event: Event): void => {
      if (!(event.currentTarget instanceof HTMLVideoElement)) return;
      const el = event.currentTarget;
      if (!el.paused && el.currentTime > 0.2 && el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        hide();
      }
    };

    const detach = (): void => {
      if (attached === null) return;
      attached.removeEventListener('waiting', onWaiting);
      attached.removeEventListener('stalled', onStalled);
      attached.removeEventListener('playing', onPlaying);
      attached.removeEventListener('pause', onPause);
      attached.removeEventListener('timeupdate', onTimeUpdate);
      attached = null;
    };

    const attach = (el: HTMLVideoElement): void => {
      if (attached === el) return;
      detach();
      attached = el;
      el.addEventListener('waiting', onWaiting);
      el.addEventListener('stalled', onStalled);
      el.addEventListener('playing', onPlaying);
      el.addEventListener('pause', onPause);
      el.addEventListener('timeupdate', onTimeUpdate);
      if (mediaIsStarved(el)) scheduleShow(el);
      else if (!el.paused && el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) hide();
    };

    let pulse = 0;
    const scan = (): void => {
      const el = findVideo(video, videoRef, hostRef.current);
      if (el === null) return;
      attach(el);
      if (pulse !== 0) {
        window.clearInterval(pulse);
        pulse = 0;
      }
    };

    scan();
    pulse = window.setInterval(scan, 400);
    const scope = hostRef.current?.closest('.player') ?? hostRef.current?.closest('.player-root') ?? document.body;
    const observer = new MutationObserver(scan);
    observer.observe(scope, { childList: true, subtree: true });

    return () => {
      clearShow();
      detach();
      window.clearInterval(pulse);
      observer.disconnect();
    };
  }, [video, videoRef]);

  useEffect(() => {
    onChangeRef.current?.(waiting);
  }, [waiting]);

  const blocked = overlay === 'queue' || overlay === 'ad' || error != null;
  const fromSession =
    active === true || busy === true || engine === 'loading' || (engine === 'native' && buffering === true);
  const shown = !blocked && (fromSession || latched || waiting);

  return (
    <div
      ref={hostRef}
      className="tvm-buffering"
      data-on={shown ? 'true' : 'false'}
      data-player-feature="buffering"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-hidden={shown ? undefined : true}
    >
      <style href="tvm-player-buffering" precedence="player">
        {STYLES}
      </style>
      <TvmMark size="md" animated loop className="tvm-buffering__brand" />
      <span className="tvm-buffering__label">{shown ? 'Loading' : ''}</span>
    </div>
  );
}

export default Buffering;
