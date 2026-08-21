import { cancelScrollAnim, jumpAxis, scrollAxis } from './scrollAnim';

/** Horizontal rails are a conveyor: three copies, always ride the middle set. */

export const LOOP_COPIES = 3;
/** If wrap settle never fires, release the conveyor so D-pad is not frozen. */
export const WRAP_UNLOCK_MS = 560;

export function shouldLoopRail(count: number): boolean {
  return count >= 2;
}

export function loopSetWidth(scrollWidth: number, copies = LOOP_COPIES): number {
  if (copies < 2 || scrollWidth <= 0) return 0;
  return scrollWidth / copies;
}

/**
 * One catalog set, measured from copy 0 → copy 1. `scrollWidth / 3` is wrong:
 * track padding is counted once and there are 3N−1 gaps, not 3(N−1).
 */
export function measureLoopSetWidth(track: HTMLElement): number {
  const copy0 = track.querySelector<HTMLElement>('[data-loop-copy="0"]');
  const copy1 = track.querySelector<HTMLElement>('[data-loop-copy="1"]');
  const copy2 = track.querySelector<HTMLElement>('[data-loop-copy="2"]');
  if (copy0 !== null && copy1 !== null && copy0.offsetParent !== null) {
    const width = copy1.offsetLeft - copy0.offsetLeft;
    if (width > 1) return width;
  }
  if (copy0 !== null && copy2 !== null && copy0.offsetParent !== null) {
    const width = (copy2.offsetLeft - copy0.offsetLeft) / 2;
    if (width > 1) return width;
  }
  return loopSetWidth(track.scrollWidth);
}

/** Prefer the last measured catalog width so scroll parking does not reflow. */
export function readLoopSetWidth(track: HTMLElement): number {
  const saved = Number(track.dataset.loopSet ?? '0');
  if (saved > 1) return saved;
  const measured = measureLoopSetWidth(track);
  if (measured > 1) track.dataset.loopSet = String(measured);
  return measured;
}

export function measureLoopPitch(track: HTMLElement): number {
  const real = track.querySelectorAll<HTMLElement>('[data-loop-copy="1"]:not([data-loop-clone="true"])');
  const first = real.item(0);
  const second = real.item(1);
  if (first !== null && second !== null) {
    const pitch = second.offsetLeft - first.offsetLeft;
    if (pitch > 1) return pitch;
  }
  const count = Number(track.dataset.loopCount ?? '0');
  return loopPitch(measureLoopSetWidth(track), count);
}

/** True when one catalog set already fits, so clone copies would sit on screen. */
export function oneSetFitsCamera(track: HTMLElement, setWidth = measureLoopSetWidth(track)): boolean {
  return setWidth > 1 && setWidth <= track.clientWidth + 2;
}

export function loopPitch(setWidth: number, count: number): number {
  if (count < 1 || setWidth <= 0) return 0;
  return setWidth / count;
}

/**
 * Park the camera where a middle-copy card can stay centered.
 *
 * Copy 1 lives at [setWidth, 2*setWidth). Centering a card there needs
 * scrollLeft in [setWidth - viewWidth/2, 2*setWidth - viewWidth/2). The old
 * [0.5S, 1.5S) window assumed the viewport was as wide as one set, so a long
 * rail teleported onto copy-0 clones — visible titles that cannot take focus.
 */
export function normalizeLoopScroll(scrollLeft: number, setWidth: number, viewWidth: number): number {
  if (setWidth <= 1) return scrollLeft;
  const half = Math.max(0, viewWidth) / 2;
  const min = setWidth - half;
  const max = setWidth * 2 - half;
  if (max <= min) return scrollLeft;
  let x = scrollLeft;
  while (x < min) x += setWidth;
  while (x >= max) x -= setWidth;
  return x;
}

export function parkLoopScroll(track: HTMLElement, scrollLeft = track.scrollLeft): number {
  return normalizeLoopScroll(scrollLeft, readLoopSetWidth(track), track.clientWidth);
}

/** True when the camera jumped a whole catalog set, not one title. */
export function isLoopSeamJump(from: number, to: number, setWidth: number): boolean {
  return setWidth > 1 && Math.abs(to - from) >= setWidth * 0.45;
}

export function cameraXForCard(track: HTMLElement, target: number): number {
  if (track.dataset.looping !== 'true') return target;
  const setWidth = readLoopSetWidth(track);
  // Park only when this hop already spans a catalog set (last→first). A
  // one-title target just past the window used to teleport onto clones.
  if (!isLoopSeamJump(track.scrollLeft, target, setWidth)) return target;
  const parked = parkLoopScroll(track, target);
  return isLoopSeamJump(target, parked, setWidth) ? parked : target;
}

function loopCardScrollTarget(track: HTMLElement, card: HTMLElement): number {
  const cardBox = card.getBoundingClientRect();
  const rowBox = track.getBoundingClientRect();
  const target = track.scrollLeft + cardBox.left - rowBox.left - (rowBox.width - cardBox.width) / 2;
  return cameraXForCard(track, target);
}

export function conveyorWrapDelta(direction: 'left' | 'right', pitch: number): number {
  return direction === 'right' ? pitch : -pitch;
}

const wrapping = new WeakSet<HTMLElement>();
const wrapTimers = new WeakMap<HTMLElement, number>();

function unlockTrack(track: HTMLElement): void {
  wrapping.delete(track);
  delete track.dataset.wrapping;
  const timer = wrapTimers.get(track);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    wrapTimers.delete(track);
  }
}

function jumpToFocusedCard(track: HTMLElement): void {
  const node = document.activeElement;
  const card = node instanceof HTMLElement ? node.closest<HTMLElement>('[data-focus-id]') : null;
  const target =
    card !== null && track.contains(card) ? loopCardScrollTarget(track, card) : parkLoopScroll(track);
  if (Math.abs(target - track.scrollLeft) >= 1) jumpAxis(track, 'x', target);
}

function lockTrack(track: HTMLElement): void {
  const prev = wrapTimers.get(track);
  if (prev !== undefined) {
    window.clearTimeout(prev);
    wrapTimers.delete(track);
  }
  wrapping.add(track);
  track.dataset.wrapping = 'true';
  const timer = window.setTimeout(() => {
    if (!wrapping.has(track) && track.dataset.wrapping !== 'true') return;
    try {
      jumpToFocusedCard(track);
    } finally {
      unlockTrack(track);
    }
  }, WRAP_UNLOCK_MS);
  wrapTimers.set(track, timer);
}

/** Finish an in-flight conveyor wrap so a new hop can move the camera. */
export function settleWrappingTrack(track: HTMLElement): void {
  cancelScrollAnim(track);
  if (!wrapping.has(track) && track.dataset.wrapping !== 'true') return;
  try {
    jumpToFocusedCard(track);
  } finally {
    unlockTrack(track);
  }
}

export function wrapLoopingTrack(
  track: HTMLElement,
  direction: 'left' | 'right',
  thenFocus: () => void,
): void {
  if (track.dataset.looping !== 'true') {
    thenFocus();
    return;
  }
  if (wrapping.has(track) || track.dataset.wrapping === 'true') {
    settleWrappingTrack(track);
  }
  const setWidth = measureLoopSetWidth(track);
  const pitch = measureLoopPitch(track);
  if (pitch <= 0 || setWidth <= 0) {
    thenFocus();
    return;
  }
  lockTrack(track);
  try {
    scrollAxis(track, 'x', track.scrollLeft + conveyorWrapDelta(direction, pitch), () => {
      try {
        jumpToFocusedCard(track);
      } finally {
        unlockTrack(track);
      }
    });
  } catch {
    unlockTrack(track);
  }
  thenFocus();
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
  return wrapping.has(track) || track.dataset.wrapping === 'true';
}
