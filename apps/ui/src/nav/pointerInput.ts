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
export const RAIL_SELECTOR = [
  '.rail__track',
  '[data-wrap="row"]',
  '.service-nav[data-wrap="row"]',
  '.service-nav__tabs',
  '.home__launcher',
  '.season-row',
  '.max-nav',
  '.max-nav__tabs',
  '.dplus-nav__tabs',
  '.dplus-brands',
  '.channel-chips',
  '.search-recent__items',
].join(', ');
const TOUCH_TAP_SLOP = 8;
const FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
/** Player chrome and sliders own the finger; do not steal their pointer stream. */
const OWNED_TOUCH_SELECTOR = '.player, [data-player], .tvm-progress, [role="slider"]';
/** Gap between a focused field and the visual-viewport edge (keyboard). */
export const FIELD_GAP = 20;
export const VISUAL_HEIGHT_VAR = '--tvm-visual-height';
export const VISUAL_TOP_VAR = '--tvm-visual-top';

export function tapShouldActivate(moved: boolean, distance: number, slop = TOUCH_TAP_SLOP): boolean {
  return !moved && Number.isFinite(distance) && distance <= slop;
}

function closestMatches(node: EventTarget | null, selector: string): boolean {
  if (node == null || typeof Element === 'undefined') return false;
  if (!(node instanceof Element) || typeof node.closest !== 'function') return false;
  try {
    return node.closest(selector) !== null;
  } catch {
    return false;
  }
}

/** Inputs must receive the real tap so iOS/Android can open the system keyboard. */
export function isTextEntryTarget(node: EventTarget | null): boolean {
  return closestMatches(node, FIELD_SELECTOR);
}

/** Seeking, volume and idle-chrome live on these nodes and must see the pointer. */
export function isOwnedTouchTarget(node: EventTarget | null): boolean {
  return closestMatches(node, OWNED_TOUCH_SELECTOR);
}

export function isPhoneNavShell(root: { classList: { contains(name: string): boolean } } = document.documentElement): boolean {
  if (root.classList.contains('phone-shell') || root.classList.contains('keyboard-open')) return true;
  try {
    return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 47.99rem)').matches;
  } catch {
    return false;
  }
}

/**
 * While a system keyboard is up, D-pad / spatial-nav must not claim the event.
 * Escape still bubbles so Search and sheets can close. Television remotes keep
 * arrow-hop out of the field because phone-shell is off.
 */
export function navShouldIgnoreKey(event: { key: string; target: EventTarget | null }, phoneShell: boolean): boolean {
  if (!phoneShell) return false;
  if (event.key === 'Escape') return false;
  return isTextEntryTarget(event.target);
}

/** Extra scrollTop so the field sits inside the visual viewport above the keyboard. */
export function fieldScrollDelta(
  fieldTop: number,
  fieldBottom: number,
  visibleTop: number,
  visibleBottom: number,
  gap = FIELD_GAP,
): number {
  if (![fieldTop, fieldBottom, visibleTop, visibleBottom, gap].every(Number.isFinite)) return 0;
  let delta = 0;
  if (fieldBottom > visibleBottom - gap) delta += fieldBottom - (visibleBottom - gap);
  const nextTop = fieldTop - delta;
  if (nextTop < visibleTop + gap) delta -= visibleTop + gap - nextTop;
  return delta;
}

/** Undo iOS layout-viewport pan so the page is not translated off-screen. */
export function pinLayoutViewport(): void {
  try {
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  } catch {
    // test stubs
  }
}

export function publishVisualViewport(root: HTMLElement = document.documentElement): void {
  try {
    const vv = window.visualViewport;
    const height = vv?.height ?? window.innerHeight;
    const top = vv?.offsetTop ?? 0;
    if (!Number.isFinite(height) || !Number.isFinite(top)) return;
    root.style?.setProperty?.(VISUAL_HEIGHT_VAR, `${Math.max(0, Math.round(height))}px`);
    root.style?.setProperty?.(VISUAL_TOP_VAR, `${Math.max(0, Math.round(top))}px`);
  } catch {
    // test stubs
  }
}

/** Scroll a focused field into the visual viewport above the software keyboard. */
export function revealFieldAboveKeyboard(field: HTMLElement): void {
  pinLayoutViewport();
  publishVisualViewport();
  const vv = window.visualViewport;
  const visibleTop = vv?.offsetTop ?? 0;
  const visibleBottom = vv != null ? vv.offsetTop + vv.height : window.innerHeight;
  const box = field.getBoundingClientRect();
  const extra = fieldScrollDelta(box.top, box.bottom, visibleTop, visibleBottom);
  if (extra === 0) return;
  const scroller = nearestScrollable(field, 'y');
  if (scroller !== null) {
    scroller.scrollTop += extra;
    return;
  }
  try {
    field.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } catch {
    // ignore
  }
}

/** Keep every text field on `host` visible while the software keyboard is open. */
export function bindKeyboardFields(host: ParentNode | null | undefined): () => void {
  if (host == null) return () => undefined;
  const sync = (): void => {
    publishVisualViewport();
    pinLayoutViewport();
    const active = document.activeElement;
    if (typeof HTMLElement === 'undefined' || !(active instanceof HTMLElement) || !isTextEntryTarget(active)) return;
    if (typeof host.contains === 'function' && !host.contains(active)) return;
    revealFieldAboveKeyboard(active);
  };
  const onFocusIn = (event: Event): void => {
    if (!isTextEntryTarget(event.target)) return;
    window.setTimeout(sync, 50);
  };
  host.addEventListener('focusin', onFocusIn);
  window.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('scroll', sync);
  sync();
  return () => {
    host.removeEventListener('focusin', onFocusIn);
    window.removeEventListener('resize', sync);
    window.visualViewport?.removeEventListener('resize', sync);
    window.visualViewport?.removeEventListener('scroll', sync);
  };
}

function isMouse(event: PointerEvent): boolean {
  return event.pointerType === 'mouse' || event.pointerType === 'pen';
}

function isCoarsePointerEnv(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Finger, or a coarse pointer that iOS sometimes labels as mouse. */
function isTapPointer(event: PointerEvent): boolean {
  if (event.pointerType === 'touch') return true;
  if (event.pointerType === 'pen') return false;
  // WKWebView often reports `mouse` for a finger. phone-shell is the
  // injected truth on iOS/Android; coarse media-query is the rest.
  if (isPhoneNavShell()) return true;
  return isCoarsePointerEnv();
}

/** Lock a gesture to one axis once it has left the tap slop. */
export function panAxis(dx: number, dy: number, slop = TOUCH_TAP_SLOP): 'x' | 'y' | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax <= slop && ay <= slop) return null;
  return ax > ay ? 'x' : 'y';
}

/** Horizontal camera follow from a finger that started at `startX`. */
export function railPanLeft(startScroll: number, startX: number, x: number): number {
  if (![startScroll, startX, x].every(Number.isFinite)) return startScroll;
  return startScroll - (x - startX);
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
  let touch: {
    id: number;
    x: number;
    y: number;
    host: HTMLElement | null;
    moved: boolean;
    rail: HTMLElement | null;
    page: HTMLElement | null;
    startScroll: number;
    startPage: number;
    axis: 'x' | 'y' | null;
  } | null = null;
  let suppressTrustedClickUntil = 0;

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
      const dx = event.clientX - touch.x;
      const dy = event.clientY - touch.y;
      touch.moved ||= Math.hypot(dx, dy) > TOUCH_TAP_SLOP;
      if (touch.axis === null) {
        touch.axis = panAxis(dx, dy);
        if (touch.axis === 'x' && touch.rail !== null) {
          if (touch.rail.dataset.wrapping === 'true') cancelLoopingTrack(touch.rail);
          try {
            touch.rail.setPointerCapture(event.pointerId);
          } catch {
            // Capture is optional; document listeners still see the move.
          }
        }
        if (touch.axis === 'y') touch.rail = null;
      }
      if (touch.axis === 'x' && touch.rail !== null) {
        event.preventDefault();
        touch.rail.scrollLeft = railPanLeft(touch.startScroll, touch.x, event.clientX);
      }
      if (touch.axis === 'y' && touch.page !== null) {
        event.preventDefault();
        touch.page.scrollTop = railPanLeft(touch.startPage, touch.y, event.clientY);
      }
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
    if (isTextEntryTarget(node)) return;
    if (isOwnedTouchTarget(node)) {
      releaseCamera(node);
      return;
    }
    if (isTapPointer(event)) {
      // Native scrolling/pinch takes precedence. Focus only a completed tap;
      // selecting on touch-down pans the card away from the finger mid-swipe.
      // Do not stopImmediatePropagation: that swallowed React pointer handlers
      // (progress, idle chrome) and the window bubble edge-swipe.
      releaseCamera(node);
      const rail = node.closest<HTMLElement>(RAIL_SELECTOR);
      const panRail = rail !== null && canScroll(rail, 'x') ? rail : null;
      const page = nearestScrollable(node, 'y');
      touch = event.isPrimary === false ? null : {
        id: event.pointerId, x: event.clientX, y: event.clientY,
        host: node.closest<HTMLElement>('[data-focus-id]'), moved: false,
        rail: panRail, page,
        startScroll: panRail?.scrollLeft ?? 0,
        startPage: page?.scrollTop ?? 0,
        axis: null,
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
    if (tap.axis !== null || tap.moved || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TOUCH_TAP_SLOP) return;
    const host = tap.host;
    if (host === null || !host.isConnected || host.closest('[inert]') !== null) return;
    const key = focusKeyFor(host);
    if (key !== null) { suppressNextReveal(host); requestFocus(key); }
    // Activate in this turn. Waiting for the compatibility click loses the tap
    // after requestFocus re-renders the card.
    suppressTrustedClickUntil = performance.now() + 80;
    host.click();
  };

  const onPointerCancel = (): void => { touch = null; };

  const onClick = (event: MouseEvent): void => {
    if (!event.isTrusted || performance.now() >= suppressTrustedClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

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

  // Any remote/keyboard press means the viewer is back on the couch —
  // except typing in a field, which must keep its keys and the caret.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (navShouldIgnoreKey(event, isPhoneNavShell())) {
      event.stopPropagation();
      return;
    }
    if (isTextEntryTarget(event.target)) return;
    hideCursor();
  };

  const stopFields = bindKeyboardFields(document);

  const onTouchMove = (event: TouchEvent): void => {
    // iOS will not honour preventDefault on pointermove; the native
    // touchmove must also cancel once we have claimed a pan.
    if (touch?.axis === 'x' || touch?.axis === 'y') event.preventDefault();
  };

  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerCancel, true);
  document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('keydown', onKeyDown);

  return () => {
    clearHover();
    stopFields();
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerCancel, true);
    document.removeEventListener('touchmove', onTouchMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('wheel', onWheel);
    document.removeEventListener('keydown', onKeyDown);
  };
}
