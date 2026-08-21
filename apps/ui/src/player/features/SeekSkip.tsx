import { useEffect, useState, type RefObject } from 'react';
import { IconForward, IconRewind } from '../../components/Icons';

/** Tap Left/Right (and `seekBy` from transport / the keyboard agent). */
export const SEEK_TAP_SECONDS = 10;
/** Held Left/Right after {@link SEEK_HOLD_AFTER_MS}. */
export const SEEK_HOLD_SECONDS = 30;
export const SEEK_HOLD_AFTER_MS = 480;
export const SEEK_HOLD_EVERY_MS = 480;
export const SEEK_GLYPH_MS = 720;

const STYLE_ID = 'tvm-seek-skip-css';
const VIDEO_SEL = 'video.player__video, .player__video, [data-player-video], [data-screen="player"] video, .player video, .player-root video';

const MENU_SEL = [
  '[data-player-menu="open"]',
  '[data-player-menu="true"]',
  '[data-picker-open]',
  '[data-menu-open="true"]',
  '.player-picker[data-open="true"]',
  '.player-menu[data-open="true"]',
].join(',');

const MENU_FOCUS_SEL = [
  '[data-player-menu]',
  '[data-picker]',
  '[data-picker-open]',
  '.player-picker',
  '.player-menu',
  '[role="menu"]',
  '[role="listbox"]',
  '.osk',
  '.keyboard',
].join(',');

const VIDEO_FOCUS_IDS = new Set([
  'player-video',
  'player-layer',
  'player-surface',
]);

const TRANSPORT_SEEK_IDS = new Set([
  'player-seek-back',
  'player-seek-fwd',
  'back-10',
  'fwd-10',
]);

const VOLUME_FOCUS_IDS = new Set(['mute', 'player-mute', 'player-volume', 'player-vol', 'volume']);

const CSS = `
.player-seek-skip {
  position: absolute;
  inset: 0;
  z-index: 7;
  pointer-events: none;
}
.player-seek-skip__burst {
  position: absolute;
  top: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  width: 6.25rem;
  height: 6.25rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--tvm-bg-deep, #000) 46%, transparent);
  box-shadow:
    inset 0 0 0 0.08rem rgba(255, 255, 255, 0.22),
    0 0.6rem 1.8rem rgba(0, 0, 0, 0.4);
  color: var(--tvm-text, #f5f5f5);
  transform: translateY(-50%) scale(0.88);
  opacity: 0;
  animation: player-seek-skip-pop var(--tvm-motion-slow, 260ms) var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)) forwards;
}
.player-seek-skip__burst--back { left: 11%; }
.player-seek-skip__burst--fwd { right: 11%; }
.player-seek-skip__glyph {
  width: 2.15rem;
  height: 2.15rem;
}
.player-seek-skip__secs {
  font-family: var(--tvm-font-family);
  font-size: var(--tvm-font-size-body-lg, 1.25rem);
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  line-height: 1;
}
@keyframes player-seek-skip-pop {
  from { opacity: 0; transform: translateY(-50%) scale(0.82); }
  35% { opacity: 1; transform: translateY(-50%) scale(1.04); }
  to { opacity: 1; transform: translateY(-50%) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .player-seek-skip__burst { animation: none; opacity: 1; transform: translateY(-50%); }
}
`;

export interface SeekSkipProps {
  videoRef?: RefObject<HTMLVideoElement | null>;
  video?: HTMLVideoElement | null;
  engine?: string;
  mediaId?: string;
  seek?: (deltaSeconds: number) => void;
  showControls?: () => void;
  controlsVisible?: boolean;
  error?: string | null;
  busy?: boolean;
  duration?: number;
}

export interface SeekFlash {
  direction: 'back' | 'fwd';
  seconds: number;
  token: number;
}

type SeekApply = (deltaSeconds: number) => boolean;

interface BoundSeek {
  apply: SeekApply;
  videoRef?: RefObject<HTMLVideoElement | null>;
  video?: HTMLVideoElement | null;
  engine?: string;
  mediaId?: string;
  error?: string | null;
  showControls?: () => void;
}

let bound: BoundSeek | null = null;
let lastSeekAt = 0;
let lastSeekDelta = 0;
const flashListeners = new Set<(flash: SeekFlash) => void>();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function playerHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-screen="player"], [data-player], .player, .player-root');
}

function findPlayerVideo(): HTMLVideoElement | null {
  const fromBound = bound?.video ?? bound?.videoRef?.current;
  if (fromBound instanceof HTMLVideoElement && fromBound.isConnected) return fromBound;
  const host = playerHost();
  const scoped = host?.querySelector<HTMLVideoElement>(VIDEO_SEL);
  if (scoped !== null && scoped !== undefined) return scoped;
  return document.querySelector<HTMLVideoElement>(VIDEO_SEL);
}

function html5Seekable(video: HTMLVideoElement): boolean {
  if (video.readyState < 1) return false;
  if (video.seekable.length > 0) return true;
  return Number.isFinite(video.duration) && video.duration > 0;
}

function isLiveId(id: string | undefined): boolean {
  return typeof id === 'string' && id.startsWith('live:');
}

function playbackIsLive(): boolean {
  if (isLiveId(bound?.mediaId)) return true;
  const host = playerHost();
  const marked = host?.getAttribute('data-media-id') ?? host?.getAttribute('data-player-id') ?? '';
  return isLiveId(marked);
}

function announceActivity(): void {
  window.dispatchEvent(new CustomEvent('tvm:user-activity'));
}

function emitFlash(deltaSeconds: number): void {
  const flash: SeekFlash = {
    direction: deltaSeconds < 0 ? 'back' : 'fwd',
    seconds: Math.max(1, Math.round(Math.abs(deltaSeconds))),
    token: performance.now(),
  };
  for (const listener of flashListeners) listener(flash);
  window.dispatchEvent(new CustomEvent('tvm:seek-skip', { detail: { deltaSeconds } }));
}

function applyNative(deltaSeconds: number): boolean {
  if (window.tvmNativePlayer === undefined) return false;
  const hops = Math.max(1, Math.round(Math.abs(deltaSeconds) / SEEK_TAP_SECONDS));
  const command = deltaSeconds < 0 ? 'seekBack' : 'seekForward';
  for (let i = 0; i < hops; i += 1) void window.tvmNativePlayer.command(command);
  return true;
}

function applyHtml5(video: HTMLVideoElement, deltaSeconds: number): boolean {
  if (!html5Seekable(video)) return false;
  const duration = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
  video.currentTime = Math.max(0, Math.min(duration, video.currentTime + deltaSeconds));
  return true;
}

function applyFallback(deltaSeconds: number): boolean {
  const engine = bound?.engine;
  const video = findPlayerVideo();
  if (engine !== 'native' && video !== null && applyHtml5(video, deltaSeconds)) return true;
  if (engine === 'native' || engine === undefined) {
    if (applyNative(deltaSeconds)) return true;
  }
  if (video !== null && applyHtml5(video, deltaSeconds)) return true;
  return false;
}

function focusedControl(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    const marked = active.closest<HTMLElement>('[data-focus-id]');
    if (marked !== null) return marked;
    return active;
  }
  return document.querySelector<HTMLElement>('[data-focused="true"]');
}

function focusIdOf(node: Element | null): string {
  return node?.closest('[data-focus-id]')?.getAttribute('data-focus-id') ?? '';
}

function modalOrInertBlocks(): boolean {
  if (document.querySelector('.modal-layer') !== null) return true;
  const screen = document.querySelector('[data-screen="player"]')?.closest('.app__screen, .screen-layer');
  return screen instanceof HTMLElement && screen.hasAttribute('inert');
}

function menuBlocksSeek(): boolean {
  if (modalOrInertBlocks()) return true;
  const host = playerHost() ?? document;
  if (host.querySelector(MENU_SEL) !== null) return true;
  const focused = focusedControl();
  if (focused === null) return false;
  if (focused.closest(MENU_FOCUS_SEL) !== null) return true;
  if (focused.getAttribute('aria-expanded') === 'true') return true;
  const id = focusIdOf(focused);
  if (id.startsWith('key-')) return true;
  if (/(picker|menu|listbox)/i.test(id)) return true;
  if (/^(player-audio|player-sub|player-cc|player-quality|audio-|sub-|quality-)/.test(id)) return true;
  return false;
}

function chromeHidden(): boolean {
  const host = playerHost();
  if (host === null) return false;
  if (host.getAttribute('data-controls') === 'hidden') return true;
  if (host.getAttribute('data-chrome') === 'hidden') return true;
  if (host.getAttribute('data-chrome-hidden') === 'true') return true;
  return (
    host.querySelector('.player__chrome--hidden, [data-player-chrome="hidden"], .player-chrome--hidden') !== null
  );
}

function videoLayerFocused(node: Element | null): boolean {
  if (node === null) return false;
  const id = focusIdOf(node);
  if (VIDEO_FOCUS_IDS.has(id)) return true;
  if (node.closest('[data-player-layer="video"], [data-player-surface="video"]') !== null) return true;
  if (node.matches('video, .player__video')) return true;
  if (node.closest('video, .player__video') !== null && node.closest('[data-focus-id]') === null) return true;
  return false;
}

function transportSeekFocused(node: Element | null): boolean {
  if (node === null) return false;
  return TRANSPORT_SEEK_IDS.has(focusIdOf(node));
}

/**
 * Left/Right skip only while watching the picture (chrome hidden / video
 * layer). The progress bar scrubs instead; skip buttons are a separate OK
 * action. Open menus, volume, and Back keep Left.
 */
export function seekAllowed(): boolean {
  if (typeof document === 'undefined') return false;
  if (playbackIsLive()) return false;
  if (bound?.error) return false;
  if (bound?.engine === 'loading') return false;
  if (menuBlocksSeek()) return false;
  const focused = focusedControl();
  const id = focusIdOf(focused);
  if (VOLUME_FOCUS_IDS.has(id)) return false;
  if (focused?.getAttribute('data-seek-arrows') === 'false') return false;
  if (focused?.getAttribute('data-seek-arrows') === 'scrub') return false;
  if (id === 'player-progress' || id === 'seek') return false;
  if (transportSeekFocused(focused)) return false;
  if (videoLayerFocused(focused)) return true;
  if (chromeHidden()) return true;
  if (focused === null) return true;
  if (focused.matches('[data-screen="player"], .player, .player-root, [data-player-root], [data-player-layer]')) {
    return true;
  }
  return false;
}

function applySeek(deltaSeconds: number): boolean {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds === 0) return false;
  if (playbackIsLive()) return false;
  if (bound?.apply !== undefined) return bound.apply(deltaSeconds);
  return applyFallback(deltaSeconds);
}

/**
 * Relative skip used by transport OK, the desktop keyboard agent, and remote
 * Left/Right. Shows the skip glyph whenever time actually moves.
 */
export function seekBy(deltaSeconds: number): boolean {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds === 0) return false;
  const now = performance.now();
  if (now - lastSeekAt < 48 && lastSeekDelta === deltaSeconds) return false;
  const applied = applySeek(deltaSeconds);
  if (!applied) return false;
  lastSeekAt = now;
  lastSeekDelta = deltaSeconds;
  bound?.showControls?.();
  announceActivity();
  emitFlash(deltaSeconds);
  return true;
}

function directionFromKey(key: string): -1 | 1 | null {
  if (key === 'ArrowLeft' || key === 'MediaRewind') return -1;
  if (key === 'ArrowRight' || key === 'MediaFastForward') return 1;
  return null;
}

function bindSession(props: SeekSkipProps): BoundSeek {
  return {
    videoRef: props.videoRef,
    video: props.video,
    engine: props.engine,
    mediaId: props.mediaId,
    error: props.error,
    showControls: props.showControls,
    apply: (deltaSeconds) => {
      if (props.engine === 'loading' || props.error) return false;
      // Native mpv only hops ±10s; a 30s hold is three commands.
      if (props.engine === 'native' && Math.abs(deltaSeconds) !== SEEK_TAP_SECONDS) {
        return applyNative(deltaSeconds);
      }
      if (typeof props.seek === 'function') {
        props.seek(deltaSeconds);
        return true;
      }
      return applyFallback(deltaSeconds);
    },
  };
}

/**
 * Remote Left/Right skip. Mounted by PlayerRoot; glyphs are decorative.
 *
 * Focus: video layer (`player-video` / `[data-player-layer=video]`) or
 * hidden chrome. The progress bar scrubs instead. Skip buttons are OK-only.
 * Open menus and volume keep Left/Right.
 */
export function SeekSkip(props: SeekSkipProps = {}): React.JSX.Element {
  const [flash, setFlash] = useState<SeekFlash | null>(null);

  useEffect(() => {
    ensureStyles();
  }, []);

  const { videoRef, video, engine, mediaId, seek, showControls, error } = props;

  useEffect(() => {
    const next = bindSession({ videoRef, video, engine, mediaId, seek, showControls, error });
    bound = next;
    return () => {
      if (bound === next) bound = null;
    };
  }, [engine, error, mediaId, seek, showControls, video, videoRef]);

  useEffect(() => {
    const onFlash = (next: SeekFlash): void => setFlash(next);
    flashListeners.add(onFlash);
    return () => {
      flashListeners.delete(onFlash);
    };
  }, []);

  useEffect(() => {
    if (flash === null) return;
    const timer = window.setTimeout(() => setFlash(null), SEEK_GLYPH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    let held: { direction: -1 | 1; tapTimer: number; tickTimer: number | null } | null = null;

    const stopHold = (): void => {
      if (held === null) return;
      window.clearTimeout(held.tapTimer);
      if (held.tickTimer !== null) window.clearInterval(held.tickTimer);
      held = null;
    };

    const startHold = (direction: -1 | 1): void => {
      stopHold();
      seekBy(direction * SEEK_TAP_SECONDS);
      const tapTimer = window.setTimeout(() => {
        if (held === null || held.direction !== direction) return;
        seekBy(direction * SEEK_HOLD_SECONDS);
        held.tickTimer = window.setInterval(() => {
          seekBy(direction * SEEK_HOLD_SECONDS);
        }, SEEK_HOLD_EVERY_MS);
      }, SEEK_HOLD_AFTER_MS);
      held = { direction, tapTimer, tickTimer: null };
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const direction = directionFromKey(event.key);
      if (direction === null) return;
      if (!seekAllowed()) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      startHold(direction);
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      const direction = directionFromKey(event.key);
      if (direction === null) return;
      if (held?.direction === direction) stopHold();
    };

    const onIntent = (raw: Event): void => {
      const intent = (raw as CustomEvent<string>).detail;
      if (intent !== 'rewind' && intent !== 'fastForward') return;
      if (!seekAllowed()) return;
      emitFlash(intent === 'rewind' ? -SEEK_TAP_SECONDS : SEEK_TAP_SECONDS);
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', stopHold);
    window.addEventListener('tvm:media-intent', onIntent);
    return () => {
      stopHold();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', stopHold);
      window.removeEventListener('tvm:media-intent', onIntent);
    };
  }, []);

  return (
    <div className="player-seek-skip" data-player-seek-skip="true" aria-live="polite" role="status">
      {flash !== null ? (
        <div
          key={flash.token}
          className={`player-seek-skip__burst player-seek-skip__burst--${flash.direction}`}
        >
          {flash.direction === 'back' ? (
            <IconRewind className="player-seek-skip__glyph" />
          ) : (
            <IconForward className="player-seek-skip__glyph" />
          )}
          <span className="player-seek-skip__secs">{flash.seconds}</span>
        </div>
      ) : null}
    </div>
  );
}

export default SeekSkip;
