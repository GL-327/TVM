import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FocusButton } from '../../components/FocusButton';
import { usePlayerSession } from '../PlayerRoot';
import { isLivePlayback } from './LiveOverlay';

/**
 * End-roll offer. Appears only in the last few seconds of a timed title.
 *
 * NextUp already owns the bottom-right card and a Watch credits control.
 * This module never overlays that card: it portals into `.next-up__actions`
 * so Skip / Watch sit in the same D-pad row as Play next. NextUp's own
 * Watch is hidden while we are in that row (one Watch, not two).
 *
 * No duration (live, NaN, 0) → hide. Never steals focus from Play next.
 */

export const CREDITS_FOCUS_IDS = {
  skip: 'skip-credits',
  watch: 'watch-credits',
} as const;

/** Tighter than NextUp's 45s window so we join an already-visible card. */
export const CREDITS_NEAR_END_SECONDS = 18;
export const CREDITS_NEAR_END_FLOOR = 8;
export const CREDITS_NEAR_END_RATIO = 0.06;

export const NEXT_UP_ROW_SELECTOR = '.next-up__actions';
export const NEXT_UP_HOST_SELECTOR = '[data-next-up]';
export const NEXT_UP_DISMISS_ID = 'player-next-up-dismiss';

export interface CreditsActionInput {
  position: number;
  duration: number;
  /** Viewer chose to stay through the roll. */
  watching?: boolean;
  /** Queue, ad, error, live, or an explicit hide. */
  blocked?: boolean;
}

export interface CreditsActionBehavior {
  visible: boolean;
  remaining: number;
  windowSeconds: number;
  skipFocusId: typeof CREDITS_FOCUS_IDS.skip;
  watchFocusId: typeof CREDITS_FOCUS_IDS.watch;
}

export interface CreditsActionProps {
  position?: number;
  duration?: number;
  seekTo?: (seconds: number) => void;
  showControls?: () => void;
  video?: HTMLVideoElement | null;
  videoRef?: { readonly current: HTMLVideoElement | null };
  overlay?: 'queue' | 'ad' | null;
  error?: string | null;
  busy?: boolean;
  mediaId?: string;
  id?: string;
  hidden?: boolean;
  onSkip?: () => void;
  onWatch?: () => void;
}

export function hasKnownDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

/** Last slice of a timed title. Unknown / live duration → 0 (hidden). */
export function creditsWindowSeconds(duration: number): number {
  if (!hasKnownDuration(duration)) return 0;
  const scaled = duration * CREDITS_NEAR_END_RATIO;
  const capped = Math.min(CREDITS_NEAR_END_SECONDS, Math.max(CREDITS_NEAR_END_FLOOR, scaled));
  return Math.min(capped, duration * 0.35);
}

export function creditsRemaining(position: number, duration: number): number {
  if (!hasKnownDuration(duration) || !Number.isFinite(position)) return 0;
  return Math.max(0, duration - position);
}

export function creditsSkipTarget(duration: number): number {
  if (!hasKnownDuration(duration)) return 0;
  return Math.max(0, duration - 0.08);
}

export function creditsActionBehavior(input: CreditsActionInput): CreditsActionBehavior {
  const windowSeconds = creditsWindowSeconds(input.duration);
  const remaining = creditsRemaining(input.position, input.duration);
  const inWindow =
    windowSeconds > 0 &&
    Number.isFinite(input.position) &&
    input.position >= 0 &&
    remaining > 0 &&
    remaining <= windowSeconds;
  return {
    visible: inWindow && input.watching !== true && input.blocked !== true,
    remaining,
    windowSeconds,
    skipFocusId: CREDITS_FOCUS_IDS.skip,
    watchFocusId: CREDITS_FOCUS_IDS.watch,
  };
}

/** Orchestrator alias — visibility / window / focus ids, no chrome of its own. */
export const behavior = creditsActionBehavior;

export function formatCreditsRemain(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function applySkipCredits(
  duration: number,
  options: { seekTo?: (seconds: number) => void; video?: HTMLVideoElement | null },
): number {
  const target = creditsSkipTarget(duration);
  if (options.seekTo !== undefined) {
    options.seekTo(target);
    return target;
  }
  if (options.video !== null && options.video !== undefined) {
    options.video.currentTime = target;
  }
  return target;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function unwrapVideo(
  video: HTMLVideoElement | null | undefined,
  videoRef: { readonly current: HTMLVideoElement | null } | undefined,
): HTMLVideoElement | null {
  if (video !== null && video !== undefined) return video;
  return videoRef?.current ?? null;
}

function findPlayerVideo(explicit: HTMLVideoElement | null): HTMLVideoElement | null {
  if (explicit !== null) return explicit;
  const node = document.querySelector('.player video, video.player__video, .player__video');
  return node instanceof HTMLVideoElement ? node : null;
}

function knownDuration(...candidates: Array<number | undefined>): number {
  for (const value of candidates) {
    if (typeof value === 'number' && hasKnownDuration(value)) return value;
  }
  return 0;
}

function findNextUpRow(): HTMLElement | null {
  const row = document.querySelector(NEXT_UP_ROW_SELECTOR);
  return row instanceof HTMLElement ? row : null;
}

function nextUpCardOpen(): boolean {
  return document.querySelector(NEXT_UP_HOST_SELECTOR) !== null;
}

function dismissNextUpCard(): void {
  const node = document.querySelector(`[data-focus-id="${NEXT_UP_DISMISS_ID}"]`);
  if (node instanceof HTMLElement) node.click();
}

function sessionBlocked(props: CreditsActionProps, mediaId: string): boolean {
  if (props.hidden === true) return true;
  if (isLivePlayback(mediaId) || mediaId.startsWith('live:')) return true;
  if (props.overlay === 'queue' || props.overlay === 'ad') return true;
  if (props.error !== undefined && props.error !== null && props.error !== '') return true;
  return false;
}

export function CreditsAction(props: CreditsActionProps = {}): React.JSX.Element | null {
  const session = usePlayerSession();
  const merged: CreditsActionProps = {
    ...session,
    ...props,
    mediaId: props.mediaId ?? props.id ?? session?.mediaId,
    video: props.video ?? session?.videoRef.current ?? null,
    videoRef: props.videoRef ?? session?.videoRef,
    seekTo: props.seekTo ?? session?.seekTo,
    showControls: props.showControls ?? session?.showControls,
  };

  const mediaId = merged.mediaId ?? merged.id ?? '';
  const [watching, setWatching] = useState(false);
  const [row, setRow] = useState<HTMLElement | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [clock, setClock] = useState(() => ({
    position: asNumber(merged.position) ?? 0,
    duration: knownDuration(asNumber(merged.duration)),
  }));
  const probeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const tick = (): void => {
      const video = findPlayerVideo(unwrapVideo(merged.video, merged.videoRef));
      const duration = knownDuration(
        asNumber(merged.duration),
        video !== null && Number.isFinite(video.duration) ? video.duration : undefined,
      );
      const position =
        video !== null && Number.isFinite(video.duration) && video.duration > 1 && Number.isFinite(video.currentTime)
          ? video.currentTime
          : (asNumber(merged.position) ?? 0);
      setClock({ position, duration });
      setRow(findNextUpRow());
      setCardOpen(nextUpCardOpen());
    };
    tick();
    const video = findPlayerVideo(unwrapVideo(merged.video, merged.videoRef));
    video?.addEventListener('timeupdate', tick);
    video?.addEventListener('durationchange', tick);
    const timer = window.setInterval(tick, 400);
    const observer = new MutationObserver(tick);
    const scope = probeRef.current?.closest('.player, [data-player-root]') ?? document.body;
    observer.observe(scope, { childList: true, subtree: true });
    return () => {
      video?.removeEventListener('timeupdate', tick);
      video?.removeEventListener('durationchange', tick);
      window.clearInterval(timer);
      observer.disconnect();
    };
  }, [merged.duration, merged.position, merged.video, merged.videoRef]);

  const inWindow = creditsActionBehavior({
    position: clock.position,
    duration: clock.duration,
  }).visible;

  useEffect(() => {
    if (!inWindow) setWatching(false);
  }, [inWindow]);

  const state = creditsActionBehavior({
    position: clock.position,
    duration: clock.duration,
    watching,
    blocked: sessionBlocked(merged, mediaId),
  });

  const skip = useCallback((): void => {
    const video = findPlayerVideo(unwrapVideo(merged.video, merged.videoRef));
    applySkipCredits(clock.duration, { seekTo: merged.seekTo, video });
    merged.showControls?.();
    merged.onSkip?.();
  }, [clock.duration, merged]);

  const watch = useCallback((): void => {
    setWatching(true);
    merged.onWatch?.();
    dismissNextUpCard();
  }, [merged]);

  const offer = state.visible ? (
    <div className="player-credits" data-credits-action="true" data-end-action="credits" role="group" aria-label="Credits">
      <FocusButton
        id={CREDITS_FOCUS_IDS.skip}
        variant="standard"
        className="player-credits__skip"
        onSelect={skip}
      >
        Skip credits
        <span className="player-credits__remain">{formatCreditsRemain(state.remaining)}</span>
      </FocusButton>
      <FocusButton id={CREDITS_FOCUS_IDS.watch} variant="quiet" className="player-credits__watch" onSelect={watch}>
        Watch credits
      </FocusButton>
    </div>
  ) : null;

  let placed: React.ReactNode = null;
  if (offer !== null && row !== null) {
    placed = createPortal(offer, row);
  } else if (offer !== null && !cardOpen) {
    placed = <div className="player-credits-dock">{offer}</div>;
  }

  return (
    <>
      <span ref={probeRef} hidden data-player-feature="credits" />
      <style href="tvm-player-credits" precedence="player">
        {CREDITS_CSS}
      </style>
      {placed}
    </>
  );
}

const CREDITS_CSS = `
.next-up__actions:has([data-credits-action]) .next-up__dismiss {
  display: none;
}

.player-credits {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
}

.player-credits-dock {
  pointer-events: auto;
  position: absolute;
  right: var(--tvm-safe-x, 2.2rem);
  bottom: 7.2rem;
  z-index: 6;
  display: flex;
  align-items: center;
}

.player-credits .tvm-button,
.player-credits-dock .tvm-button {
  min-height: 2.6rem;
  padding-inline: 1rem;
  pointer-events: auto;
}

.player-credits__skip .tvm-button__label {
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
}

.player-credits__remain {
  color: color-mix(in srgb, var(--tvm-text, #fff) 62%, transparent);
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  letter-spacing: 0.04em;
}
`;

export default CreditsAction;
