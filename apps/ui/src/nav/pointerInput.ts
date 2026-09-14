/**
 * Mouse support for a UI that was built remote-first.
 *
 * The appliance hides the cursor (`body { cursor: none }`) and only revealed it
 * for `?desktop=1` or after a *click* — so on a laptop the pointer was invisible
 * until you guessed where to press. Hover did nothing, and the wheel did nothing
 * because the page scrollers are driven by the D-pad camera rather than by
 * native overflow.
 *
 * This module makes the two input styles coexist:
 *   - the cursor appears the moment the mouse actually moves, and goes away
 *     again as soon as the remote is used, so the ten-foot view stays clean;
 *   - hovering moves focus, so a click always lands on the same element the
 *     D-pad would have activated;
 *   - the wheel scrolls the nearest scrollable ancestor, including the
 *     `overflow: hidden` page scrollers, which still scroll programmatically.
 */
import { focusKeyFor } from './railNav';
import { requestFocus } from './focusEngine';
import { cancelPendingReveal, suppressNextReveal } from './revealFocused';
import { animate, cancelScrollAnim, scrollTarget } from './scrollAnim';
import { cancelLoopingTrack } from './loopingRail';

const DESKTOP_CLASS = 'desktop-shell';
/** Ignore sub-pixel jitter and the synthetic move a scroll emits under a still mouse. */
const MOVE_EPSILON = 2;
/** A rail is a horizontal camera; a plain wheel over one should still scroll it. */
const RAIL_SELECTOR = '.rail__track, [data-wrap="row"]';
const TOUCH_TAP_SLOP = 8;

function isMouse(event: PointerEvent): boolean {
  return event.pointerType === 'mouse' || event.pointerType === 'pen';
}

export interface ScrollBox {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Pure so it can be tested without a DOM, like the rest of the nav helpers. */
export function canScrollAxis(box: ScrollBox, axis: 'x' | 'y'): boolean {
  if (axis === 'x') return box.scrollWidth - box.clientWidth > 1;
  return box.scrollHeight - box.clientHeight > 1;
}

/**
 * Which axis a wheel notch should drive over a rail.
 *
 * A trackpad sends deltaX for a sideways swipe; a plain mouse wheel only ever
 * sends deltaY, so Shift is the conventional way to say "sideways" there.
 */
export function wheelWantsRail(deltaX: number, deltaY: number, shiftKey: boolean): boolean {
  return Math.abs(deltaX) > Math.abs(deltaY) || shiftKey;
}

export function wheelPixels(delta: number, mode: number, viewport: number): number {
  if (!Number.isFinite(delta)) return 0;
  return delta * (mode === 1 ? 16 : mode === 2 ? Math.max(1, viewport) : 1);
}

/** Reverse immediately instead of first consuming the previous wheel's backlog. */
export function wheelTarget(current: number, pending: number, delta: number): number {
  return ((pending - current) * delta < 0 ? current : pending) + delta;
}

function canScroll(el: HTMLElement, axis: 'x' | 'y'): boolean {
  return canScrollAxis(el, axis);
}

/**
 * Nearest ancestor that can actually move on this axis.
 *
 * Deliberately does not consult computed `overflow`: the page scrollers are
 * `overflow: hidden` precisely so no scrollbar shows on a TV, yet they scroll
 * fine when written to, and they are exactly what the wheel should drive.
 */
export function nearestScrollable(start: Element | null, axis: 'x' | 'y'): HTMLElement | null {
  let node: Element | null = start;
  while (node !== null && node !== document.body) {
    if (node instanceof HTMLElement && canScroll(node, axis)) return node;
    node = node.parentElement;
  }
  return null;
}

export function startPointerInput(): () => void {
  const root = document.documentElement;
  /** True once a real mouse has moved; gates hover-to-focus. Windowed
   *  laptop mode (`?desktop=1`) starts here already, so adopt that state. */
  let mouseActive = root.classList.contains(DESKTOP_CLASS);
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  let hoverRaf = 0;
  let hoverTarget: HTMLElement | null = null;
  let touch: { id: number; x: number; y: number; host: HTMLElement | null; moved: boolean } | null = null;

  const clearHover = (): void => {
    if (hoverRaf !== 0) cancelAnimationFrame(hoverRaf);
    hoverRaf = 0;
    hoverTarget = null;
  };

  const releaseCamera = (target: Element | null): void => {
    clearHover();
    cancelPendingReveal();
    let node = target;
    while (node !== null) {
      if (node instanceof HTMLElement) {
        if (node.dataset?.wrapping === 'true') cancelLoopingTrack(node);
        else cancelScrollAnim(node);
      }
      node = node.parentElement;
    }
  };

  const showCursor = (): void => {
    if (mouseActive) return;
    mouseActive = true;
    root.classList.add(DESKTOP_CLASS);
  };

  const hideCursor = (): void => {
    if (!mouseActive) return;
    mouseActive = false;
    lastX = Number.NaN;
    lastY = Number.NaN;
    root.classList.remove(DESKTOP_CLASS);
  };

  const applyHover = (): void => {
    hoverRaf = 0;
    const node = hoverTarget;
    hoverTarget = null;
    if (node === null || !node.isConnected || !mouseActive) return;
    if (node === document.activeElement) return;
    const key = focusKeyFor(node);
    if (key === null) return;
    // Focus without panning: the content must not slide out from under the cursor.
    suppressNextReveal(node);
    requestFocus(key);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (touch !== null && event.pointerId === touch.id) {
      touch.moved ||= Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > TOUCH_TAP_SLOP;
      return;
    }
    if (!isMouse(event)) return;
    if (event.buttons > 0) { clearHover(); return; }
    const dx = Math.abs(event.clientX - lastX);
    const dy = Math.abs(event.clientY - lastY);
    // NaN comparisons are false, so the first real move always passes.
    if (dx < MOVE_EPSILON && dy < MOVE_EPSILON) return;
    lastX = event.clientX;
    lastY = event.clientY;
    showCursor();

    const target = event.target;
    if (!(target instanceof Element)) return;
    const host = target.closest<HTMLElement>('[data-focus-id]');
    if (host === null || host.closest('[inert]') !== null) { clearHover(); return; }
    hoverTarget = host;
    if (hoverRaf === 0) hoverRaf = requestAnimationFrame(applyHover);
  };

  const onPointerDown = (event: PointerEvent): void => {
    const node = event.target;
    if (!(node instanceof Element)) return;
    if (event.pointerType === 'touch') {
      // Native scrolling/pinch takes precedence. Focus only a completed tap;
      // selecting on touch-down pans the card away from the finger mid-swipe.
      // Capture-phase stop keeps ViewStackProvider from focusing on finger-down
      // (that listener treats every pointer like a D-pad hover).
      event.stopImmediatePropagation();
      releaseCamera(node);
      touch = event.isPrimary === false ? null : {
        id: event.pointerId, x: event.clientX, y: event.clientY,
        host: node.closest<HTMLElement>('[data-focus-id]'), moved: false,
      };
      return;
    }
    if (isMouse(event)) showCursor();
    clearHover();
    const host = node.closest<HTMLElement>('[data-focus-id]');
    if (host === null) return;
    const key = focusKeyFor(host);
    if (key !== null) {
      suppressNextReveal(host);
      requestFocus(key);
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    const tap = touch;
    if (tap === null || tap.id !== event.pointerId) return;
    touch = null;
    if (tap.moved || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TOUCH_TAP_SLOP) return;
    const host = tap.host;
    if (host === null || !host.isConnected || host.closest('[inert]') !== null) return;
    const key = focusKeyFor(host);
    if (key !== null) { suppressNextReveal(host); requestFocus(key); }
  };

  const onPointerCancel = (): void => { touch = null; };

  const onWheel = (event: WheelEvent): void => {
    if (event.ctrlKey || event.defaultPrevented) return; // preserve pinch-zoom and owned controls
    showCursor();
    const target = event.target instanceof Element ? event.target : null;
    if (target !== null && target.closest('input, textarea, select, [contenteditable="true"], [inert]') !== null) return;
    clearHover();
    cancelPendingReveal();

    // A sideways wheel (or Shift+wheel) over a rail nudges the rail; anything
    // else pans the page.
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const rail = target?.closest<HTMLElement>(RAIL_SELECTOR) ?? null;
    if (rail !== null && wheelWantsRail(event.deltaX, event.deltaY, event.shiftKey) && canScroll(rail, 'x')) {
      if (rail.dataset.wrapping === 'true') cancelLoopingTrack(rail);
      const delta = wheelPixels(horizontal ? event.deltaX : event.deltaY, event.deltaMode, rail.clientWidth);
      if (delta === 0) return;
      event.preventDefault();
      // Retarget the running tween rather than cancelling it: the camera keeps
      // its momentum and successive notches stack up instead of stuttering.
      animate(rail, 'x', wheelTarget(rail.scrollLeft, scrollTarget(rail, 'x'), delta));
      return;
    }

    const page = nearestScrollable(target, 'y');
    if (page === null) return;
    const step = wheelPixels(event.deltaY, event.deltaMode, page.clientHeight);
    if (step === 0) return;
    event.preventDefault();
    animate(page, 'y', wheelTarget(page.scrollTop, scrollTarget(page, 'y'), step));
  };

  // Any remote/keyboard press means the viewer is back on the couch.
  const onKeyDown = (): void => hideCursor();

  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerCancel, true);
  document.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  return () => {
    clearHover();
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerCancel, true);
    document.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
  };
}
