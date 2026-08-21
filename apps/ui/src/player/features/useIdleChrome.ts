import { useCallback, useEffect, useRef, useState } from 'react';

/** Hide transport / title / progress after this idle while playing. */
export const IDLE_CHROME_HIDE_MS = 3_000;
/** Skip Recap stays up longer than the rest of chrome during the recap window. */
export const IDLE_RECAP_HIDE_MS = 8_000;
/** Opacity fade only — chrome is never unmounted. Matches `--tvm-motion-base`. */
export const IDLE_CHROME_FADE_MS = 200;
/** Existing player offers Skip Recap before this playback time. */
export const RECAP_WINDOW_END_S = 90;

export const IDLE_CHROME_TIMINGS = {
  hideMs: IDLE_CHROME_HIDE_MS,
  recapHideMs: IDLE_RECAP_HIDE_MS,
  fadeMs: IDLE_CHROME_FADE_MS,
  recapWindowEndS: RECAP_WINDOW_END_S,
} as const;

export const IDLE_RECAP_SELECTOR = [
  '[data-focus-id="player-skip-recap"]',
  '[data-focus-id="skip-recap"]',
  '[data-idle-keep="recap"]',
  '[data-player-skip-recap]',
].join(',');

export const IDLE_CHROME_FADE_SELECTOR = [
  '.player__chrome',
  '.player-chrome',
  '.chrome-frame',
  '[data-player-chrome]',
  '.player-dock',
  '.player-transport',
  '.tvm-progress',
  '.player-title-overlay',
  '.player-volume',
  '[data-player-volume]',
  '.player-audio',
  '.player-quality',
  '.player-cc',
].join(',');

export const IDLE_CHROME_HOST_SELECTOR = [
  '.player',
  '[data-player]',
  '[data-player-root]',
  '.player-root',
].join(',');

const FADE_ATTR = 'data-idle-fade';

const REVEAL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'NumpadEnter']);

export interface IdleChromePinInput {
  playing?: boolean;
  paused?: boolean;
  buffering?: boolean;
  busy?: boolean;
  error?: string | null;
  overlay?: unknown;
  pinned?: boolean;
}

export interface IdleChromeOptions extends IdleChromePinInput {
  inRecapWindow?: boolean;
  hideMs?: number;
  recapHideMs?: number;
}

export interface IdleChromeApi {
  chromeVisible: boolean;
  recapVisible: boolean;
  pinned: boolean;
  show: () => void;
}

export function idleHideMs(layer: 'chrome' | 'recap', inRecapWindow: boolean): number {
  if (layer === 'recap' && inRecapWindow) return IDLE_RECAP_HIDE_MS;
  return IDLE_CHROME_HIDE_MS;
}

export function idleChromePinned(input: IdleChromePinInput = {}): boolean {
  if (input.pinned === true) return true;
  if (input.paused === true) return true;
  if (input.playing === false) return true;
  if (typeof input.error === 'string' && input.error !== '') return true;
  if (input.buffering === true) return true;
  if (input.busy === true) return true;
  if (input.overlay !== undefined && input.overlay !== null && input.overlay !== '') return true;
  return false;
}

export function isInRecapWindow(
  input: {
    skipRecap?: boolean;
    position?: number;
    overlay?: unknown;
    live?: boolean;
    mediaId?: string;
  } = {},
): boolean {
  if (input.skipRecap !== true) return false;
  if (input.live === true) return false;
  if (typeof input.mediaId === 'string' && input.mediaId.startsWith('live:')) return false;
  if (input.overlay !== undefined && input.overlay !== null && input.overlay !== '') return false;
  const position = input.position;
  if (position === undefined || !Number.isFinite(position) || position < 0) return false;
  return position < RECAP_WINDOW_END_S;
}

export function applyIdleChromeHost(
  host: Element,
  chromeVisible: boolean,
  recapVisible: boolean,
): void {
  host.setAttribute('data-chrome-visible', chromeVisible ? 'true' : 'false');
  host.setAttribute('data-chrome-hidden', chromeVisible ? 'false' : 'true');
  host.setAttribute('data-recap-visible', recapVisible ? 'true' : 'false');
}

function markFade(el: Element, state: 'hide' | 'show'): void {
  el.setAttribute(FADE_ATTR, state);
}

function clearFades(root: ParentNode): void {
  if (root instanceof Element) root.removeAttribute(FADE_ATTR);
  root.querySelectorAll(`[${FADE_ATTR}]`).forEach((el) => el.removeAttribute(FADE_ATTR));
}

function fadeExcept(node: Element, keep: Element): void {
  for (const child of Array.from(node.children)) {
    if (child === keep || child.contains(keep)) {
      markFade(child, 'show');
      if (child !== keep) fadeExcept(child, keep);
    } else {
      markFade(child, 'hide');
    }
  }
}

/**
 * Fade chrome with opacity only. When Skip Recap is still due, walk around it
 * so a parent fade cannot composite it away.
 */
export function syncIdleChromeFade(root: ParentNode, chromeVisible: boolean, recapVisible: boolean): void {
  const recap = recapVisible ? root.querySelector<HTMLElement>(IDLE_RECAP_SELECTOR) : null;

  if (chromeVisible) {
    clearFades(root);
    root.querySelectorAll(IDLE_RECAP_SELECTOR).forEach((node) => markFade(node, 'show'));
    return;
  }

  const targets = root.querySelectorAll(IDLE_CHROME_FADE_SELECTOR);
  if (targets.length === 0 && root instanceof Element) {
    if (recap !== null) fadeExcept(root, recap);
    else markFade(root, 'hide');
  } else {
    targets.forEach((target) => {
      if (recap !== null && (target === recap || target.contains(recap))) {
        markFade(target, 'show');
        if (target !== recap) fadeExcept(target, recap);
        return;
      }
      markFade(target, 'hide');
    });
  }

  root.querySelectorAll(IDLE_RECAP_SELECTOR).forEach((node) => {
    markFade(node, recapVisible ? 'show' : 'hide');
  });
}

export function findIdleChromeHosts(from?: ParentNode | null): HTMLElement[] {
  const scope = from ?? (typeof document === 'undefined' ? null : document);
  if (scope === null) return [];
  return Array.from(scope.querySelectorAll<HTMLElement>(IDLE_CHROME_HOST_SELECTOR));
}

export function revealIdleChrome(): void {
  window.dispatchEvent(new CustomEvent('tvm:user-activity'));
}

export function isRevealKey(key: string): boolean {
  return REVEAL_KEYS.has(key);
}

/**
 * Hide player chrome after a short idle while playing. Arrow / OK / mouse
 * reveal it. Skip Recap uses a longer idle when `inRecapWindow` is set.
 */
export function useIdleChrome(options: IdleChromeOptions = {}): IdleChromeApi {
  const pinned = idleChromePinned(options);
  const inRecapWindow = options.inRecapWindow === true;
  const hideMs = options.hideMs ?? IDLE_CHROME_HIDE_MS;
  const recapHideMs = options.recapHideMs ?? IDLE_RECAP_HIDE_MS;

  const [chromeVisible, setChromeVisible] = useState(true);
  const [recapVisible, setRecapVisible] = useState(true);

  const chromeTimer = useRef<number | null>(null);
  const recapTimer = useRef<number | null>(null);
  const pinnedRef = useRef(pinned);
  const inRecapRef = useRef(inRecapWindow);
  const hideMsRef = useRef(hideMs);
  const recapHideMsRef = useRef(recapHideMs);
  pinnedRef.current = pinned;
  inRecapRef.current = inRecapWindow;
  hideMsRef.current = hideMs;
  recapHideMsRef.current = recapHideMs;

  const clearTimers = useCallback((): void => {
    if (chromeTimer.current !== null) {
      window.clearTimeout(chromeTimer.current);
      chromeTimer.current = null;
    }
    if (recapTimer.current !== null) {
      window.clearTimeout(recapTimer.current);
      recapTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback((): void => {
    clearTimers();
    if (pinnedRef.current) return;
    chromeTimer.current = window.setTimeout(() => {
      chromeTimer.current = null;
      setChromeVisible(false);
    }, hideMsRef.current);
    recapTimer.current = window.setTimeout(
      () => {
        recapTimer.current = null;
        setRecapVisible(false);
      },
      inRecapRef.current ? recapHideMsRef.current : hideMsRef.current,
    );
  }, [clearTimers]);

  const show = useCallback((): void => {
    setChromeVisible(true);
    setRecapVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    if (pinned) {
      clearTimers();
      setChromeVisible(true);
      setRecapVisible(true);
      return;
    }
    scheduleHide();
    return clearTimers;
  }, [clearTimers, hideMs, inRecapWindow, pinned, recapHideMs, scheduleHide]);

  useEffect(() => {
    if (inRecapWindow || chromeVisible) return;
    setRecapVisible(false);
  }, [chromeVisible, inRecapWindow]);

  useEffect(() => {
    const onShow = (): void => show();
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (isRevealKey(event.key)) show();
    };
    const onPointer = (event: PointerEvent): void => {
      if (event.type === 'pointermove' && event.pointerType === 'touch') return;
      show();
    };

    window.addEventListener('tvm:user-activity', onShow);
    window.addEventListener('tvm:media-intent', onShow);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointermove', onPointer);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('tvm:user-activity', onShow);
      window.removeEventListener('tvm:media-intent', onShow);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [show]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { chromeVisible, recapVisible, pinned, show };
}
