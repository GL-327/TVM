import { useEffect, useRef, type RefObject } from 'react';
import type { PlayerEngine, PlayerSession } from '../PlayerRoot';

/** Matches the existing player chrome auto-hide so the pointer and controls leave together. */
export const MOUSE_IDLE_MS = 3_200;

const STYLE_ID = 'tvm-player-mouse-layer';

const PROGRESS_SEL = [
  '[data-focus-id="player-progress"]',
  '[data-focus-id="seek"]',
  '[data-player-progress]',
  '.tvm-progress__control',
  '.tvm-progress__track',
  '.player__seek',
].join(',');

const SKIP_SEL = [
  '[data-focus-id="player-skip-recap"]',
  '[data-focus-id="skip-recap"]',
  '[data-player-skip-recap]',
  '.player-skip-recap',
].join(',');

const INTERACTIVE_SEL = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[data-focus-id]',
  '[role="button"]',
  '[role="slider"]',
  '.player__vol-track',
  '.player-transport',
].join(',');

const OVERLAY_SEL = [
  '.player__queue',
  '.player__ad',
  '.player__error',
  '.player__error-block',
  '[data-player-overlay]',
  '[data-player-menu]',
  '[role="menu"]',
  '[role="listbox"]',
].join(',');

const CURSOR_CSS = `
  .player.player--mouse-active,
  .player.player--mouse-active * {
    cursor: default !important;
  }
  .player.player--mouse-active button,
  .player.player--mouse-active [data-focus-id] {
    cursor: pointer !important;
  }
  .player.player--mouse-idle,
  .player.player--mouse-idle * {
    cursor: none !important;
  }
  /* PlayerRoot is pointer-events: none; these targets must still receive a mouse. */
  [data-player-root] .chrome-frame__top,
  [data-player-root] .chrome-frame__bottom,
  [data-player-root] .player-dock,
  [data-player-root] .player-transport,
  [data-player-root] .player-volume,
  [data-player-root] .tvm-progress,
  [data-player-root] .tvm-progress__control,
  [data-player-root] [data-focus-id="player-progress"],
  [data-player-root] [data-focus-id="player-skip-recap"],
  [data-player-root] [data-focus-id="skip-recap"],
  [data-player-root] [data-player-skip-recap],
  [data-player-root] .player-skip-recap {
    pointer-events: auto;
  }
`;

export type MouseLayerProps = Partial<PlayerSession> & {
  idleMs?: number;
  rootRef?: RefObject<HTMLElement | null>;
};

export interface PlayerMouseBindings {
  video?: () => HTMLVideoElement | null;
  duration?: () => number;
  engine?: () => PlayerEngine | string | undefined;
  togglePlayback?: () => void;
  seekTo?: (seconds: number) => void;
  showControls?: () => void;
  idleMs?: number;
}

export function progressRatio(clientX: number, rect: Pick<DOMRect, 'left' | 'width'>): number {
  if (rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

export function isProgressTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(PROGRESS_SEL) !== null;
}

export function isSkipRecapTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(SKIP_SEL) !== null;
}

export function isInteractiveChrome(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SEL) !== null;
}

export function isBlockingOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OVERLAY_SEL) !== null;
}

/** Empty stage / letterbox / chrome gutter — not a control. */
export function isVideoToggleTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (isBlockingOverlay(target) || isProgressTarget(target) || isSkipRecapTarget(target)) return false;
  return !isInteractiveChrome(target);
}

export function revealPlayerChrome(): void {
  window.dispatchEvent(new CustomEvent('tvm:user-activity'));
}

export function togglePlayerPlayback(): void {
  window.dispatchEvent(new CustomEvent('tvm:media-intent', { detail: 'playPause' }));
}

export function seekPlayerToRatio(
  host: HTMLElement,
  ratio: number,
  bindings: PlayerMouseBindings = {},
): void {
  const clamped = Math.min(1, Math.max(0, ratio));
  const node = bindings.video?.() ?? host.querySelector('video');
  const fromClock = bindings.duration?.() ?? 0;
  const fromVideo = node !== null && Number.isFinite(node.duration) ? node.duration : 0;
  const duration = fromClock > 0 ? fromClock : fromVideo;
  const seconds = duration > 0 ? clamped * duration : undefined;
  const engine = bindings.engine?.();

  if (seconds !== undefined && bindings.seekTo !== undefined) {
    bindings.seekTo(seconds);
  } else if (seconds !== undefined && engine !== 'native' && node !== null) {
    node.currentTime = seconds;
  }

  window.dispatchEvent(
    new CustomEvent('tvm:player-seek', {
      detail: { ratio: clamped, seconds },
    }),
  );
  if (bindings.showControls !== undefined) bindings.showControls();
  else revealPlayerChrome();
}

function ensureCursorStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CURSOR_CSS;
  document.head.appendChild(style);
}

/**
 * Bind to `.player`, never the `pointer-events: none` PlayerRoot shell.
 * Video and the legacy chrome are siblings of that shell.
 */
export function resolvePlayerHost(start: HTMLElement | null): HTMLElement | null {
  if (start !== null) {
    const player = start.closest<HTMLElement>('.player');
    if (player !== null) return player;
    const shell = start.closest<HTMLElement>('[data-player], [data-player-shell]');
    if (shell !== null) return shell;
    const overlay = start.closest<HTMLElement>('[data-player-root], .player-root');
    if (overlay?.parentElement instanceof HTMLElement) return overlay.parentElement;
  }
  return document.querySelector<HTMLElement>('.player');
}

function setCursorIdle(host: HTMLElement, idle: boolean): void {
  host.classList.toggle('player--mouse-idle', idle);
  host.classList.toggle('player--mouse-active', !idle);
  host.setAttribute('data-mouse-idle', idle ? 'true' : 'false');
}

/**
 * Pointer bindings for the desktop player.
 *
 * Do not preventDefault on pointerdown. Chromium treats that as cancelling the
 * compatibility `click`, so FocusButton (Play, Back, Skip Recap) never fires.
 * After a click, focus is returned to the prior control so the D-pad map stays
 * on chrome instead of parking on <video>.
 */
export function bindPlayerMouse(host: HTMLElement, bindings: PlayerMouseBindings = {}): () => void {
  if (host === document.body || host === document.documentElement) return () => undefined;

  ensureCursorStyles();
  setCursorIdle(host, true);

  const idleMs = bindings.idleMs ?? MOUSE_IDLE_MS;
  let idleTimer: number | null = null;
  let priorFocus: HTMLElement | null = null;

  const hideCursor = (): void => {
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = null;
    setCursorIdle(host, true);
  };

  const pokeCursor = (): void => {
    setCursorIdle(host, false);
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(hideCursor, idleMs);
  };

  const reveal = (): void => {
    if (bindings.showControls !== undefined) bindings.showControls();
    else revealPlayerChrome();
  };

  const retainRemoteFocus = (): void => {
    const restore = priorFocus;
    priorFocus = null;
    const run = (): void => {
      if (restore === null || !restore.isConnected) return;
      const stolen = document.activeElement;
      if (stolen === restore) return;
      if (stolen instanceof HTMLElement && host.contains(stolen)) stolen.blur();
      restore.focus({ preventScroll: true });
    };
    queueMicrotask(run);
    requestAnimationFrame(run);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    pokeCursor();
    reveal();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !host.contains(event.target as Node)) return;
    const active = document.activeElement;
    priorFocus = active instanceof HTMLElement ? active : null;

    if (isInteractiveChrome(event.target) || isSkipRecapTarget(event.target) || isBlockingOverlay(event.target)) {
      return;
    }

    if (isProgressTarget(event.target)) {
      // ProgressBar owns scrub. Don't seek on every move — that blacks HLS.
      retainRemoteFocus();
      return;
    }

    retainRemoteFocus();
  };

  const onClick = (event: MouseEvent): void => {
    if (event.button !== 0 || !host.contains(event.target as Node)) return;

    if (isSkipRecapTarget(event.target)) {
      // FocusButton already wires onClick → skip. Do not stopPropagation or the
      // recap control never fires. Focus was blocked on pointerdown.
      reveal();
      return;
    }

    if (isProgressTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (isBlockingOverlay(event.target) || isInteractiveChrome(event.target)) {
      reveal();
      return;
    }

    if (isVideoToggleTarget(event.target)) {
      event.preventDefault();
      reveal();
      if (bindings.togglePlayback !== undefined) bindings.togglePlayback();
      else togglePlayerPlayback();
    }
  };

  host.addEventListener('pointermove', onPointerMove);
  host.addEventListener('pointerenter', onPointerMove);
  host.addEventListener('pointerdown', onPointerDown, true);
  host.addEventListener('click', onClick, true);
  window.addEventListener('keydown', hideCursor);

  return () => {
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    host.removeEventListener('pointermove', onPointerMove);
    host.removeEventListener('pointerenter', onPointerMove);
    host.removeEventListener('pointerdown', onPointerDown, true);
    host.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', hideCursor);
    host.classList.remove('player--mouse-idle', 'player--mouse-active');
    host.removeAttribute('data-mouse-idle');
  };
}

/**
 * Desktop pointer layer. Not focusable. PlayerRoot lazy-mounts this with a
 * PlayerSession spread; missing siblings are reached via session methods and
 * data-focus-id hooks.
 */
export function MouseLayer(props: MouseLayerProps = {}): React.JSX.Element {
  const anchorRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const host = propsRef.current.rootRef?.current ?? resolvePlayerHost(anchorRef.current);
    if (host === null) return;
    return bindPlayerMouse(host, {
      idleMs: propsRef.current.idleMs,
      video: () => propsRef.current.videoRef?.current ?? null,
      duration: () => propsRef.current.duration ?? 0,
      engine: () => propsRef.current.engine,
      togglePlayback: () => {
        if (propsRef.current.togglePlayback !== undefined) propsRef.current.togglePlayback();
        else togglePlayerPlayback();
      },
      seekTo: (seconds) => {
        if (propsRef.current.seekTo !== undefined) {
          propsRef.current.seekTo(seconds);
          return;
        }
        const node = propsRef.current.videoRef?.current ?? host.querySelector('video');
        if (node !== null && propsRef.current.engine !== 'native') node.currentTime = seconds;
      },
      showControls: () => {
        if (propsRef.current.showControls !== undefined) propsRef.current.showControls();
        else revealPlayerChrome();
      },
    });
  }, []);

  return (
    <div
      ref={anchorRef}
      className="player-mouse-layer"
      data-player-mouse-layer=""
      aria-hidden="true"
      // Zero-size sentinel: listeners bind to `.player`, never this node.
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
    />
  );
}

export default MouseLayer;
