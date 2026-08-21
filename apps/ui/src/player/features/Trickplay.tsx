import { useEffect, useRef, useState, type RefObject } from 'react';
import { usePlayerSession } from '../PlayerRoot';

export const SKIP_LADDER = [10, 30, 60] as const;
export type SkipStep = (typeof SKIP_LADDER)[number];

export const HOLD_ARM_MS = 320;
export const HOLD_STEP_30_MS = 700;
export const HOLD_STEP_60_MS = 1_500;
export const HOLD_TICK_MS = 400;

const MENU_SELECTOR = [
  '[data-player-menu]',
  '[data-picker-open]',
  '.player-picker',
  '.player-menu',
  '[role="listbox"]',
  '[role="menu"]',
].join(', ');

const VIDEO_SELECTOR = [
  'video[data-player-video]',
  'video.player__video',
  '.player video',
  '[data-player] video',
].join(', ');

export interface TrickplaySprites {
  src: string;
  interval: number;
  columns: number;
  rows?: number;
  tileWidth?: number;
  tileHeight?: number;
}

export interface SpriteCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TrickplayProps {
  video?: HTMLVideoElement | null;
  videoRef?: RefObject<HTMLVideoElement | null>;
  currentTime?: number;
  position?: number;
  duration?: number;
  sprites?: TrickplaySprites | null;
  seekBy?: (deltaSeconds: number) => void;
  seek?: (deltaSeconds: number) => void;
  seekTo?: (seconds: number) => void;
  live?: boolean;
  overlay?: 'queue' | 'ad' | null;
  error?: string | null;
  busy?: boolean;
  mediaId?: string;
  engine?: 'loading' | 'html5' | 'native';
  showControls?: () => void;
}

type HoldDirection = -1 | 1;

interface PreviewState {
  time: number;
  duration: number;
  step: SkipStep;
  direction: HoldDirection;
}

interface SeekFns {
  seekBy?: (deltaSeconds: number) => void;
  seekTo?: (seconds: number) => void;
  engine?: 'loading' | 'html5' | 'native';
}

export function skipStepForHoldMs(heldMs: number): SkipStep {
  if (heldMs >= HOLD_STEP_60_MS) return 60;
  if (heldMs >= HOLD_STEP_30_MS) return 30;
  return 10;
}

export function holdSkipDelta(heldMs: number, direction: HoldDirection): number {
  return skipStepForHoldMs(heldMs) * direction;
}

export function isSeekableClock(currentTime: number, duration: number): boolean {
  return Number.isFinite(currentTime) && currentTime >= 0 && Number.isFinite(duration) && duration > 1;
}

export function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(duration, time));
}

export function formatPlayerTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const total = Math.floor(value);
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`;
}

export function chapterMark(time: number, duration: number): { index: number; total: number; start: number } {
  const span = duration >= 3_600 ? 600 : duration >= 1_200 ? 300 : Math.max(60, duration / 8);
  const total = Math.max(1, Math.ceil(duration / span));
  const index = Math.min(total, Math.floor(Math.max(0, time) / span) + 1);
  return { index, total, start: (index - 1) * span };
}

export function spritesFromVideo(video: HTMLVideoElement | null | undefined): TrickplaySprites | null {
  if (video == null) return null;
  const src = video.getAttribute('data-trickplay-src') ?? video.dataset.trickplaySrc ?? '';
  if (src === '') return null;
  const interval = Number(video.getAttribute('data-trickplay-interval') ?? video.dataset.trickplayInterval);
  const columns = Number(video.getAttribute('data-trickplay-cols') ?? video.dataset.trickplayCols);
  if (!Number.isFinite(interval) || interval <= 0 || !Number.isFinite(columns) || columns < 1) return null;
  const rows = Number(video.getAttribute('data-trickplay-rows') ?? video.dataset.trickplayRows);
  const tileWidth = Number(video.getAttribute('data-trickplay-tile-width') ?? video.dataset.trickplayTileWidth);
  const tileHeight = Number(video.getAttribute('data-trickplay-tile-height') ?? video.dataset.trickplayTileHeight);
  return {
    src,
    interval,
    columns,
    rows: Number.isFinite(rows) && rows > 0 ? rows : undefined,
    tileWidth: Number.isFinite(tileWidth) && tileWidth > 0 ? tileWidth : undefined,
    tileHeight: Number.isFinite(tileHeight) && tileHeight > 0 ? tileHeight : undefined,
  };
}

export function spriteAt(sprites: TrickplaySprites, time: number): SpriteCell | null {
  if (sprites.src === '' || sprites.interval <= 0 || sprites.columns < 1) return null;
  const width = sprites.tileWidth ?? 160;
  const height = sprites.tileHeight ?? 90;
  let frame = Math.max(0, Math.floor(time / sprites.interval));
  const maxFrame = sprites.rows !== undefined ? sprites.rows * sprites.columns - 1 : Number.POSITIVE_INFINITY;
  if (Number.isFinite(maxFrame)) frame = Math.min(frame, maxFrame);
  const col = frame % sprites.columns;
  const row = Math.floor(frame / sprites.columns);
  return { x: col * width, y: row * height, width, height };
}

export function menuBlocksTrickplay(root: ParentNode = document): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    if (active.closest(MENU_SELECTOR) !== null) return true;
    if (active.getAttribute('aria-expanded') === 'true') return true;
  }
  const player = (root instanceof Element ? root.closest('.player') : null) ?? root.querySelector('.player') ?? root;
  const open = player.querySelector(MENU_SELECTOR);
  return open instanceof HTMLElement && open.offsetParent !== null;
}

function unwrapVideo(
  video?: HTMLVideoElement | null,
  videoRef?: RefObject<HTMLVideoElement | null>,
): HTMLVideoElement | null {
  if (video != null && video.isConnected) return video;
  const fromRef = videoRef?.current;
  if (fromRef != null && fromRef.isConnected) return fromRef;
  return document.querySelector<HTMLVideoElement>(VIDEO_SELECTOR);
}

function readClock(
  video: HTMLVideoElement | null,
  currentTime?: number,
  duration?: number,
): { currentTime: number; duration: number } | null {
  const time =
    video != null && Number.isFinite(video.duration) && video.duration > 1 && Number.isFinite(video.currentTime)
      ? video.currentTime
      : (currentTime ?? Number.NaN);
  const length =
    video != null && Number.isFinite(video.duration) && video.duration > 1
      ? video.duration
      : (duration ?? Number.NaN);
  if (!isSeekableClock(time, length)) return null;
  return { currentTime: time, duration: length };
}

function seekButtonDirection(node: EventTarget | null): HoldDirection | null {
  if (!(node instanceof Element)) return null;
  const button = node.closest<HTMLElement>('[data-focus-id]');
  const id = button?.getAttribute('data-focus-id') ?? '';
  if (id === 'player-seek-back' || id === 'back-10') return -1;
  if (id === 'player-seek-fwd' || id === 'fwd-10') return 1;
  return null;
}

function applySeek(video: HTMLVideoElement | null, from: number, target: number, fns: SeekFns): void {
  const html5 = video !== null && Number.isFinite(video.duration) && video.duration > 1 && fns.engine !== 'native';
  if (html5 && fns.seekTo !== undefined) {
    fns.seekTo(target);
    return;
  }
  if (html5) {
    video.currentTime = clampTime(target, video.duration);
    return;
  }
  const hops = Math.max(1, Math.round(Math.abs(target - from) / 10));
  const delta = target < from ? -10 : 10;
  if (fns.seekBy !== undefined) {
    for (let i = 0; i < hops; i += 1) fns.seekBy(delta);
    return;
  }
  const command = delta < 0 ? 'seekBack' : 'seekForward';
  for (let i = 0; i < hops; i += 1) void window.tvmNativePlayer?.command(command);
}

function markPlayer(active: boolean, step: SkipStep | null): void {
  const root = document.querySelector<HTMLElement>('.player-root, .player');
  if (root === null) return;
  if (active && step !== null) {
    root.dataset.trickplay = 'hold';
    root.dataset.trickplayStep = String(step);
  } else {
    delete root.dataset.trickplay;
    delete root.dataset.trickplayStep;
  }
}

function announceActivity(showControls?: () => void): void {
  showControls?.();
  window.dispatchEvent(new CustomEvent('tvm:user-activity'));
}

function directionFromKey(key: string): HoldDirection | null {
  if (key === 'ArrowLeft' || key === 'MediaRewind') return -1;
  if (key === 'ArrowRight' || key === 'MediaFastForward') return 1;
  return null;
}

function sessionBlocks(props: TrickplayProps): boolean {
  if (props.live === true) return true;
  if (props.mediaId?.startsWith('live:') === true) return true;
  if (props.overlay === 'queue' || props.overlay === 'ad') return true;
  if (props.busy === true) return true;
  if (props.error !== null && props.error !== undefined && props.error !== '') return true;
  return false;
}

export function Trickplay(props: TrickplayProps = {}): React.JSX.Element | null {
  const ctx = usePlayerSession();
  const merged: TrickplayProps = {
    ...ctx,
    ...props,
    video: props.video ?? ctx?.videoRef.current ?? null,
    videoRef: props.videoRef ?? ctx?.videoRef,
    currentTime: props.currentTime ?? props.position ?? ctx?.position,
    duration: props.duration ?? ctx?.duration,
    seekBy: props.seekBy ?? props.seek ?? ctx?.seek,
    seekTo: props.seekTo ?? ctx?.seekTo,
    showControls: props.showControls ?? ctx?.showControls,
  };

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const hold = useRef<{
    direction: HoldDirection;
    startedAt: number;
    armed: boolean;
    preview: number;
    step: SkipStep;
  } | null>(null);
  const hideTimer = useRef<number | null>(null);
  const armTimer = useRef<number | null>(null);
  const tickTimer = useRef<number | null>(null);
  const watchTimer = useRef<number | null>(null);
  const mergedRef = useRef(merged);
  mergedRef.current = merged;

  useEffect(() => {
    const clearTimers = (): void => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
      if (tickTimer.current !== null) window.clearInterval(tickTimer.current);
      if (watchTimer.current !== null) window.clearTimeout(watchTimer.current);
      hideTimer.current = null;
      armTimer.current = null;
      tickTimer.current = null;
      watchTimer.current = null;
    };

    const clock = (): { currentTime: number; duration: number } | null => {
      const next = mergedRef.current;
      if (sessionBlocks(next)) return null;
      const video = unwrapVideo(next.video, next.videoRef);
      return readClock(video, next.currentTime, next.duration);
    };

    let visible = false;

    const show = (next: PreviewState): void => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
      visible = true;
      setPreview(next);
      markPlayer(true, next.step);
    };

    const hideSoon = (): void => {
      if (!visible) return;
      markPlayer(false, null);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        visible = false;
        setPreview(null);
      }, 220);
    };

    const tickHold = (): void => {
      const active = hold.current;
      const now = clock();
      if (active === null || now === null) {
        endHold();
        return;
      }
      const step = skipStepForHoldMs(performance.now() - active.startedAt);
      active.step = step;
      const video = unwrapVideo(mergedRef.current.video, mergedRef.current.videoRef);
      const from = video !== null && Number.isFinite(video.currentTime) ? video.currentTime : active.preview;
      const target = clampTime(active.preview + step * active.direction, now.duration);
      if (target === active.preview) return;
      applySeek(video, from, target, {
        seekBy: mergedRef.current.seekBy,
        seekTo: mergedRef.current.seekTo,
        engine: mergedRef.current.engine,
      });
      active.preview = target;
      show({ time: target, duration: now.duration, step, direction: active.direction });
      announceActivity(mergedRef.current.showControls);
    };

    const armHold = (): void => {
      const active = hold.current;
      if (active === null || active.armed) return;
      active.armed = true;
      tickHold();
      if (tickTimer.current !== null) window.clearInterval(tickTimer.current);
      tickTimer.current = window.setInterval(tickHold, HOLD_TICK_MS);
    };

    const endHold = (): void => {
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
      if (tickTimer.current !== null) window.clearInterval(tickTimer.current);
      if (watchTimer.current !== null) window.clearTimeout(watchTimer.current);
      armTimer.current = null;
      tickTimer.current = null;
      watchTimer.current = null;
      if (hold.current !== null) {
        hold.current = null;
        hideSoon();
      }
    };

    const bumpWatch = (): void => {
      if (watchTimer.current !== null) window.clearTimeout(watchTimer.current);
      watchTimer.current = window.setTimeout(endHold, 260);
    };

    const beginHold = (direction: HoldDirection): void => {
      const now = clock();
      if (now === null) return;
      if (hold.current?.direction === direction) {
        bumpWatch();
        return;
      }
      endHold();
      hold.current = {
        direction,
        startedAt: performance.now(),
        armed: false,
        preview: now.currentTime,
        step: 10,
      };
      announceActivity(mergedRef.current.showControls);
      armTimer.current = window.setTimeout(armHold, HOLD_ARM_MS);
      bumpWatch();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const direction = directionFromKey(event.key);
      if (direction === null) return;
      if (hold.current !== null && hold.current.direction === direction) {
        event.preventDefault();
        event.stopPropagation();
        bumpWatch();
        return;
      }
      if (menuBlocksTrickplay()) return;
      const mediaKey = event.key === 'MediaRewind' || event.key === 'MediaFastForward';
      if (!mediaKey) return;
      if (clock() === null) return;
      beginHold(direction);
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      const direction = directionFromKey(event.key);
      if (direction === null) return;
      if (hold.current?.direction === direction) endHold();
    };

    const onIntent = (raw: Event): void => {
      const intent = (raw as CustomEvent<string>).detail;
      if (intent !== 'rewind' && intent !== 'fastForward') return;
      const direction: HoldDirection = intent === 'rewind' ? -1 : 1;
      if (hold.current !== null && hold.current.direction === direction) {
        raw.stopImmediatePropagation();
        bumpWatch();
      }
    };

    const onPointerDown = (event: PointerEvent): void => {
      const direction = seekButtonDirection(event.target);
      if (direction === null) return;
      if (menuBlocksTrickplay() || clock() === null) return;
      beginHold(direction);
    };

    const onPointerUp = (): void => {
      if (hold.current !== null) endHold();
    };

    const onClickCapture = (event: Event): void => {
      if (hold.current?.armed !== true) return;
      if (seekButtonDirection(event.target) === null) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('tvm:media-intent', onIntent, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('click', onClickCapture, true);
    window.addEventListener('blur', endHold);

    return () => {
      clearTimers();
      markPlayer(false, null);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('tvm:media-intent', onIntent, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      window.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('blur', endHold);
    };
  }, []);

  if (preview === null) return null;

  const video = unwrapVideo(merged.video, merged.videoRef);
  const sprites = merged.sprites ?? spritesFromVideo(video);
  const cell = sprites !== null ? spriteAt(sprites, preview.time) : null;
  const mark = chapterMark(preview.time, preview.duration);
  const remaining = Math.max(0, preview.duration - preview.time);
  const ratio = preview.duration > 0 ? preview.time / preview.duration : 0;
  const skipLabel = `${preview.direction < 0 ? '−' : '+'}${preview.step}s`;

  return (
    <div className="player-trickplay" data-kind="hold" aria-live="polite" role="status">
      <style>{css}</style>
      <div className="player-trickplay__card">
        {cell !== null && sprites !== null ? (
          <div
            className="player-trickplay__thumb"
            style={{
              width: cell.width,
              height: cell.height,
              backgroundImage: `url(${sprites.src})`,
              backgroundPosition: `-${cell.x}px -${cell.y}px`,
            }}
          />
        ) : null}
        <div className="player-trickplay__meta">
          <p className="player-trickplay__time">
            {preview.direction < 0 ? '‹ ' : null}
            {formatPlayerTime(preview.time)}
            {preview.direction > 0 ? ' ›' : null}
          </p>
          <p className="player-trickplay__sub">
            <span className="player-trickplay__step">{skipLabel}</span>
            {mark.total > 1 ? <span>{formatPlayerTime(mark.start)}</span> : null}
            <span>{formatPlayerTime(remaining)} left</span>
          </p>
          <span className="player-trickplay__bar" aria-hidden="true">
            <span className="player-trickplay__fill" style={{ width: `${ratio * 100}%` }} />
            <span className="player-trickplay__knob" style={{ left: `${ratio * 100}%` }} />
          </span>
        </div>
      </div>
    </div>
  );
}

const css = `
.player-trickplay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(var(--tvm-safe-y, 1.5rem) + 6.4rem);
  z-index: 6;
  display: flex;
  justify-content: center;
  pointer-events: none;
}
.player-trickplay__card {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-width: 11rem;
  max-width: 22rem;
  padding: 0.7rem 0.9rem 0.8rem;
  border: 1px solid var(--tvm-border-soft, rgba(255, 255, 255, 0.12));
  border-radius: var(--tvm-radius-md, 0.875rem);
  background: color-mix(in srgb, var(--tvm-surface-glass, rgba(28, 28, 28, 0.78)) 88%, #000);
  box-shadow: var(--tvm-shadow-card, 0 0.8rem 2rem rgba(0, 0, 0, 0.55));
  color: var(--tvm-text, #f5f5f5);
  backdrop-filter: blur(12px);
}
.player-trickplay__thumb {
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 0.4rem;
  background-color: #111;
  background-repeat: no-repeat;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.player-trickplay__meta {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.28rem;
  min-width: 8.5rem;
}
.player-trickplay__time {
  margin: 0;
  font-size: var(--tvm-font-size-body-lg, 1.25rem);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: var(--tvm-line-height-tight, 1.12);
}
.player-trickplay__sub {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.7rem;
  margin: 0;
  color: var(--tvm-text-muted, #c4c4c4);
  font-size: var(--tvm-font-size-caption, 0.8125rem);
  font-variant-numeric: tabular-nums;
}
.player-trickplay__step {
  color: var(--tvm-text, #f5f5f5);
  font-weight: 750;
}
.player-trickplay__bar {
  position: relative;
  display: block;
  height: 0.22rem;
  margin-top: 0.2rem;
  overflow: visible;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
}
.player-trickplay__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--tvm-accent, #fff);
}
.player-trickplay__knob {
  position: absolute;
  top: 50%;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--tvm-accent, #fff);
  transform: translate(-50%, -50%);
}
`;

export default Trickplay;
