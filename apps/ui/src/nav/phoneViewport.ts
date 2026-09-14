/**
 * Phone / WKWebView viewport helpers.
 *
 * The ten-foot pages scroll inside `.home` / `.page`, not `document`. iOS
 * therefore cannot lift a focused field by insetting the WKWebView scroll
 * view — the keyboard covers the input unless we (1) publish the occlusion
 * as `--tvm-keyboard-inset` and (2) scroll the nearest overflow ancestor.
 *
 * iOS also injects a matching script (apps/ios TVMWebView.swift). This
 * module is the shared copy so Android and a narrow desktop window behave
 * the same. Layout lives in theme/mobile.css.
 */
import { nearestScrollable } from './pointerInput';

export const KEYBOARD_INSET_VAR = '--tvm-keyboard-inset';
export const KEYBOARD_OPEN_CLASS = 'keyboard-open';
export const PHONE_SHELL_CLASS = 'phone-shell';
export type PhoneOrientation = 'portrait' | 'landscape';
/** Below this, treat the keyboard as closed (visualViewport jitter). */
export const KEYBOARD_OPEN_PX = 80;
export const FIELD_SCROLL_GAP = 20;
export const FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

export function isPhoneViewport(narrow: boolean, coarse: boolean, tablet: boolean): boolean {
  return narrow || (coarse && tablet);
}

/** Portrait when the window is at least as tall as it is wide. Both are allowed. */
export function phoneOrientation(width: number, height: number): PhoneOrientation {
  if (![width, height].every(Number.isFinite)) return 'portrait';
  return height >= width ? 'portrait' : 'landscape';
}

/**
 * How many CSS pixels the software keyboard covers, from Visual Viewport.
 *
 * `innerHeight - visualHeight - offsetTop` matches WKWebView: the visual
 * viewport shrinks from the bottom, and `offsetTop` stays 0 unless the
 * user pinched. A negative result is treated as 0.
 */
export function keyboardOcclusionPx(innerHeight: number, visualHeight: number, offsetTop: number): number {
  if (![innerHeight, visualHeight, offsetTop].every(Number.isFinite)) return 0;
  return Math.max(0, Math.round(innerHeight - visualHeight - offsetTop));
}

/** Extra scrollTop needed so `fieldBottom` sits above `visibleBottom`. */
export function extraScrollToReveal(fieldBottom: number, visibleBottom: number, gap = FIELD_SCROLL_GAP): number {
  if (![fieldBottom, visibleBottom, gap].every(Number.isFinite)) return 0;
  return Math.max(0, fieldBottom - visibleBottom + gap);
}

export function isEditableField(node: EventTarget | null): node is HTMLElement {
  return node instanceof HTMLElement && node.matches(FIELD_SELECTOR);
}

/** Left-edge swipe that should pop TVM's view stack (not WK history). */
export function edgeSwipeGoesBack(startX: number, dx: number, dy: number, edgePx = 28, minDx = 60): boolean {
  if (![startX, dx, dy, edgePx, minDx].every(Number.isFinite)) return false;
  return startX <= edgePx && dx >= minDx && Math.abs(dy) <= dx * 0.65;
}

function applyInset(root: HTMLElement, inset: number): void {
  root.style.setProperty(KEYBOARD_INSET_VAR, `${inset}px`);
  root.classList.toggle(KEYBOARD_OPEN_CLASS, inset >= KEYBOARD_OPEN_PX);
}

function liftField(field: HTMLElement, visibleBottom: number): void {
  const box = field.getBoundingClientRect();
  const extra = extraScrollToReveal(box.bottom, visibleBottom);
  if (extra === 0) return;
  const scroller = nearestScrollable(field, 'y');
  if (scroller !== null) {
    scroller.scrollTop += extra;
    return;
  }
  field.scrollIntoView({ block: 'center', inline: 'nearest' });
}

function ensureViewportFit(): void {
  const head = document.head;
  if (head === null) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta === null) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'viewport');
    head.appendChild(meta);
  }
  if (/TVM-iOS/.test(navigator.userAgent)) {
    meta.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
    return;
  }
  const content = meta.getAttribute('content') ?? 'width=device-width, initial-scale=1';
  if (!content.includes('viewport-fit')) {
    meta.setAttribute('content', `${content}, viewport-fit=cover`);
  }
}

/** Mark the document as a phone shell and keep the keyboard off the focused field. */
export function startPhoneViewport(): () => void {
  const root = document.documentElement;
  const narrow = window.matchMedia('(max-width: 47.99rem)');
  const tablet = window.matchMedia('(max-width: 63.99rem)');
  const coarse = window.matchMedia('(pointer: coarse)');

  const syncShell = (): void => {
    const ios = /TVM-iOS/.test(navigator.userAgent);
    root.classList.toggle(PHONE_SHELL_CLASS, ios || isPhoneViewport(narrow.matches, coarse.matches, tablet.matches));
    const orientation = phoneOrientation(window.innerWidth, window.innerHeight);
    root.dataset.orientation = orientation;
    root.classList.toggle('tvm-portrait', orientation === 'portrait');
    root.classList.toggle('tvm-landscape', orientation === 'landscape');
  };

  const syncKeyboard = (): void => {
    const vv = window.visualViewport;
    const inset = vv == null ? 0 : keyboardOcclusionPx(window.innerHeight, vv.height, vv.offsetTop);
    applyInset(root, inset);
    if (inset < KEYBOARD_OPEN_PX) return;
    if (!isEditableField(document.activeElement)) return;
    const visibleBottom = vv == null ? window.innerHeight : vv.offsetTop + vv.height;
    liftField(document.activeElement, visibleBottom);
  };

  const pinScale = (): void => {
    window.scrollTo(0, 0);
    if (window.visualViewport && window.visualViewport.scale !== 1) ensureViewportFit();
  };

  const onFocusIn = (event: FocusEvent): void => {
    if (!isEditableField(event.target)) return;
    window.setTimeout(syncKeyboard, 50);
  };

  ensureViewportFit();
  syncShell();
  syncKeyboard();
  pinScale();

  narrow.addEventListener('change', syncShell);
  tablet.addEventListener('change', syncShell);
  coarse.addEventListener('change', syncShell);
  window.addEventListener('resize', syncShell);
  window.addEventListener('orientationchange', syncShell);
  window.addEventListener('resize', syncKeyboard);
  window.addEventListener('resize', pinScale);
  window.visualViewport?.addEventListener('resize', syncKeyboard);
  window.visualViewport?.addEventListener('scroll', syncKeyboard);
  window.visualViewport?.addEventListener('resize', pinScale);
  window.visualViewport?.addEventListener('scroll', pinScale);
  document.addEventListener('focusin', onFocusIn);

  return () => {
    narrow.removeEventListener('change', syncShell);
    tablet.removeEventListener('change', syncShell);
    coarse.removeEventListener('change', syncShell);
    window.removeEventListener('resize', syncShell);
    window.removeEventListener('orientationchange', syncShell);
    window.removeEventListener('resize', syncKeyboard);
    window.removeEventListener('resize', pinScale);
    window.visualViewport?.removeEventListener('resize', syncKeyboard);
    window.visualViewport?.removeEventListener('scroll', syncKeyboard);
    window.visualViewport?.removeEventListener('resize', pinScale);
    window.visualViewport?.removeEventListener('scroll', pinScale);
    document.removeEventListener('focusin', onFocusIn);
  };
}
