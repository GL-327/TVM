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
import { suppressNextReveal } from './revealFocused';
import { animate, cancelScrollAnim } from './scrollAnim';

const DESKTOP_CLASS = 'desktop-shell';
/** Ignore sub-pixel jitter and the synthetic move a scroll emits under a still mouse. */
const MOVE_EPSILON = 2;
/** A rail is a horizontal camera; a plain wheel over one should still scroll it. */
const RAIL_SELECTOR = '.rail__track, [data-wrap="row"]';
const PAGE_WHEEL_STEP = 220;

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
    suppressNextReveal();
    requestFocus(key);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!isMouse(event)) return;
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
    if (host === null) return;
    hoverTarget = host;
    if (hoverRaf === 0) hoverRaf = requestAnimationFrame(applyHover);
  };

  const onPointerDown = (event: PointerEvent): void => {
    const node = event.target;
    if (!(node instanceof Element)) return;
    if (isMouse(event)) showCursor();
    const host = node.closest<HTMLElement>('[data-focus-id]');
    if (host === null) return;
    const key = focusKeyFor(host);
    if (key !== null) {
      suppressNextReveal();
      requestFocus(key);
    }
  };

  const onWheel = (event: WheelEvent): void => {
    if (event.ctrlKey) return; // pinch-zoom gesture, not a scroll
    showCursor();
    const target = event.target instanceof Element ? event.target : null;

    // A sideways wheel (or Shift+wheel) over a rail nudges the rail; anything
    // else pans the page.
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const rail = target?.closest<HTMLElement>(RAIL_SELECTOR) ?? null;
    if (rail !== null && wheelWantsRail(event.deltaX, event.deltaY, event.shiftKey) && canScroll(rail, 'x')) {
      const delta = horizontal ? event.deltaX : event.deltaY;
      event.preventDefault();
      cancelScrollAnim(rail);
      animate(rail, 'x', rail.scrollLeft + delta);
      return;
    }

    const page = nearestScrollable(target, 'y');
    if (page === null) return;
    event.preventDefault();
    const step = event.deltaMode === 1 ? event.deltaY * PAGE_WHEEL_STEP * 0.05 : event.deltaY;
    cancelScrollAnim(page);
    animate(page, 'y', page.scrollTop + step);
  };

  // Any remote/keyboard press means the viewer is back on the couch.
  const onKeyDown = (): void => hideCursor();

  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  return () => {
    if (hoverRaf !== 0) cancelAnimationFrame(hoverRaf);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
  };
}
