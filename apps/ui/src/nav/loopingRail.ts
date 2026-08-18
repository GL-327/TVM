import { jumpAxis, scrollAxis } from './revealFocused';

/** Horizontal rails are a conveyor: three copies, always ride the middle set. */

export const LOOP_COPIES = 3;

export function shouldLoopRail(count: number): boolean {
  return count >= 2;
}

export function loopSetWidth(scrollWidth: number, copies = LOOP_COPIES): number {
  if (copies < 2 || scrollWidth <= 0) return 0;
  return scrollWidth / copies;
}

export function loopPitch(setWidth: number, count: number): number {
  if (count < 1 || setWidth <= 0) return 0;
  return setWidth / count;
}

/**
 * Keep scroll inside the cloned strip, but not so tightly that centering the
 * first or last card teleports to the other end (that is the snap-back).
 */
export function normalizeLoopScroll(scrollLeft: number, setWidth: number): number {
  if (setWidth <= 1) return scrollLeft;
  let x = scrollLeft;
  while (x < setWidth * 0.2) x += setWidth;
  while (x >= setWidth * 2.2) x -= setWidth;
  return x;
}

export function conveyorWrapDelta(direction: 'left' | 'right', pitch: number): number {
  return direction === 'right' ? pitch : -pitch;
}

/** After sliding one card past the seam, land on the same card in the middle copy. */
export function conveyorAfterWrap(scrollLeft: number, direction: 'left' | 'right', setWidth: number): number {
  if (setWidth <= 1) return scrollLeft;
  return direction === 'left' ? scrollLeft + setWidth : scrollLeft - setWidth;
}

const wrapping = new WeakSet<HTMLElement>();

export function wrapLoopingTrack(
  track: HTMLElement,
  direction: 'left' | 'right',
  thenFocus: () => void,
): void {
  if (wrapping.has(track)) return;
  const count = Number(track.dataset.loopCount ?? '0');
  const setWidth = loopSetWidth(track.scrollWidth);
  const pitch = loopPitch(setWidth, count);
  if (pitch <= 0 || setWidth <= 0) {
    thenFocus();
    return;
  }
  wrapping.add(track);
  track.dataset.wrapping = 'true';
  scrollAxis(track, 'x', track.scrollLeft + conveyorWrapDelta(direction, pitch), () => {
    jumpAxis(track, 'x', conveyorAfterWrap(track.scrollLeft, direction, setWidth));
    thenFocus();
    window.requestAnimationFrame(() => {
      wrapping.delete(track);
      delete track.dataset.wrapping;
    });
  });
}

export function isWrapAcross(index: number, direction: 'left' | 'right', count: number): boolean {
  if (count < 2 || index < 0 || index >= count) return false;
  if (direction === 'right') return index === count - 1;
  return index === 0;
}

/** Clone ids are `realId--0` / `realId--2`. The focusable copy has no suffix. */
export function canonicalFocusId(id: string): string {
  return id.replace(/--[02]$/, '');
}

export function isLoopClone(element: HTMLElement): boolean {
  return element.getAttribute('data-loop-clone') === 'true';
}

export function isWrappingTrack(track: HTMLElement): boolean {
  return wrapping.has(track);
}
