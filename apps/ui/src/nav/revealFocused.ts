/**
 * Camera for the ten-foot UI.
 *
 * Down parks the focused rail/card just under chrome. That is a pan of the
 * page scroller, not scrollIntoView / jumpAxis — a whole-page snap would send
 * the next D-pad hop to the wrong box. Work is one coalesced rAF; the first
 * lerp tick runs there so the camera is not a frame late.
 */

import { cameraXForCard } from './loopingRail';
import { animate } from './scrollAnim';

export { cancelScrollAnim, jumpAxis, scrollAxis } from './scrollAnim';

/** Poster scale / focus ring must not nudge the page camera on every hop. */
const PAGE_Y_SLOP = 12;
/** Home Down camera parks the focused category just under the floating ribbon. */
export const HOME_ROW_CAMERA_PAD = 72;

function centerInRow(row: HTMLElement, card: HTMLElement): void {
  if (row.dataset.wrapping === 'true') return;
  const cardBox = card.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  const target = row.scrollLeft + cardBox.left - rowBox.left - (rowBox.width - cardBox.width) / 2;
  animate(row, 'x', cameraXForCard(row, target));
}

export function rowCameraTop(scrollTop: number, railTop: number, viewTop: number, ribbonHeight: number): number {
  return scrollTop + (railTop - viewTop) - ribbonHeight;
}

/** Page Y target for a focused row. Relative pan; never a jump to document 0 unless the row is there. */
export function pagePanTarget(scrollTop: number, itemTop: number, viewTop: number, padTop: number): number {
  return Math.max(0, rowCameraTop(scrollTop, itemTop, viewTop, padTop));
}

/** Sidebar chrome (Prime-style) must not be treated as a full-viewport top pad. */
export function chromeReserve(height: number, width: number, viewHeight: number, viewWidth: number): number {
  if (height <= 0) return 0;
  if (height > viewHeight * 0.45 && width < viewWidth * 0.35) return 0;
  return Math.min(height, viewHeight * 0.35);
}

export function shouldNudgePageY(current: number, target: number, slop = PAGE_Y_SLOP): boolean {
  return Math.abs(target - current) >= slop;
}

const chromeByScroller = new WeakMap<HTMLElement, HTMLElement | null>();
let revealRaf = 0;
let revealTarget: HTMLElement | null = null;
let lockedHomeRail: HTMLElement | null = null;

const SCROLLER_SELECTOR = [
  '.home',
  '.page',
  '.details',
  '.service',
  '.prime-hub',
  '.dplus-hub',
  '.max-hub',
  '.nf-hub',
  '.hulu-hub',
  '.appletv-hub',
  '.peacock-hub',
].join(', ');

const PAGE_TOP_FOCUS = [
  '.stage',
  '.stream-chrome',
  '.service-hero',
  '.service-nav',
  '.page__toolbar',
  '.prime-hub__hero',
  '.prime-hub__nav',
  '.dplus-hero',
  '.dplus-nav',
  '.max-hero',
  '.max-nav',
  '.hulu-hub__hero',
  '.hulu-hub__nav',
  '.appletv-hub__hero',
  '.appletv-hub__nav',
  '.peacock-hub__hero',
  '.peacock-hub__nav',
  '.nf-hub__hero',
  '.nf-hub__nav',
  '.legacy-hub__hero',
  '.legacy-hub__nav',
].join(', ');

function chromeFor(scroller: HTMLElement): HTMLElement | null {
  const hit = chromeByScroller.get(scroller);
  if (hit !== undefined && (hit === null || hit.isConnected)) return hit;
  const chrome = scroller.querySelector<HTMLElement>(
    '.topbar, .service-nav, .prime-hub__nav, .dplus-nav, .max-nav, .hulu-hub__nav, .appletv-hub__nav, .peacock-hub__nav, .nf-hub__nav, .legacy-hub__nav',
  );
  chromeByScroller.set(scroller, chrome);
  return chrome;
}

function cameraPadTop(scroller: HTMLElement, view: DOMRect): number {
  if (scroller.classList.contains('home')) return HOME_ROW_CAMERA_PAD;
  const chrome = chromeFor(scroller);
  const chromeBox = chrome?.getBoundingClientRect();
  if (chromeBox === undefined) return 16;
  return chromeReserve(chromeBox.height, chromeBox.width, view.height, view.width) + 16;
}

function panPageY(scroller: HTMLElement, target: number): void {
  if (!shouldNudgePageY(scroller.scrollTop, target)) return;
  animate(scroller, 'y', target);
}

function revealPageY(scroller: HTMLElement, element: HTMLElement): void {
  if (element.closest('.ribbon') !== null) return;

  if (element.closest(PAGE_TOP_FOCUS) !== null) {
    lockedHomeRail = null;
    panPageY(scroller, 0);
    return;
  }

  const row = element.closest<HTMLElement>('.rail, .service-rail, .home-row') ?? element;
  const view = scroller.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  const target = pagePanTarget(scroller.scrollTop, box.top, view.top, cameraPadTop(scroller, view));
  if (lockedHomeRail === row && !shouldNudgePageY(scroller.scrollTop, target)) return;
  lockedHomeRail = row;
  panPageY(scroller, target);
}

function revealNow(element: HTMLElement): void {
  const strip = element.closest<HTMLElement>(
    '.rail__track, .ribbon__list, .service-nav__tabs, .channel-chips, [data-wrap="row"]',
  );
  if (strip !== null) {
    if (strip.classList.contains('ribbon__list') || strip.scrollWidth > strip.clientWidth + 8) {
      centerInRow(strip, element);
    }
  }

  const scroller = element.closest<HTMLElement>(SCROLLER_SELECTOR);
  if (scroller === null) return;
  revealPageY(scroller, element);
}

/** Coalesce stacked onFocus rAFs so a held D-pad only cameras the latest tile. */
export function revealFocused(element: HTMLElement): void {
  revealTarget = element;
  if (revealRaf !== 0) return;
  revealRaf = requestAnimationFrame(() => {
    revealRaf = 0;
    const node = revealTarget;
    revealTarget = null;
    if (node !== null && node.isConnected) revealNow(node);
  });
}
