/** Shared camera tweens. Kept out of loopingRail ↔ revealFocused so they do not cycle. */
import { prefersReducedMotion, subscribeMotionPreference } from '../theme/motion';

type Axis = 'x' | 'y';

interface ScrollAnim {
  axis: Axis;
  target: number;
  raf: number;
  steps: number;
  position: number;
  displayed: number;
  lastTime?: number;
  onSettle?: () => void;
}

// Avoid jumping almost half a poster pitch in the first frame; held D-pad
// input still retargets immediately, with the same response on every display.
const EASE = 0.24;
const SETTLE = 0.6;
const MAX_STEPS = 90;
const FRAME_MS = 1000 / 60;

/** Same camera response at 30, 60 and 120 Hz; cap pauses on a background tab. */
export function scrollEase(elapsedMs: number): number {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : FRAME_MS;
  return 1 - Math.pow(1 - EASE, Math.min(elapsed, 64) / FRAME_MS);
}

const animByEl = new WeakMap<HTMLElement, ScrollAnim>();
const live = new Set<HTMLElement>();
let watchingMotion = false;

/** Snap every in-flight camera the moment Performance mode (or Reduced) turns on. */
function watchMotionFreeze(): void {
  if (watchingMotion) return;
  watchingMotion = true;
  subscribeMotionPreference(() => {
    if (!prefersReducedMotion()) return;
    for (const el of [...live]) {
      const anim = animByEl.get(el);
      if (anim !== undefined) finish(el, anim);
    }
  });
}

export function isScrollAnimating(el: HTMLElement): boolean {
  return animByEl.has(el);
}

/**
 * Where the camera is heading: the in-flight target if a tween is running,
 * otherwise the current offset. Wheel notches add onto this so a fast spin
 * keeps accumulating instead of re-measuring a position that is still moving.
 */
export function scrollTarget(el: HTMLElement, axis: Axis): number {
  const anim = animByEl.get(el);
  if (anim !== undefined && anim.axis === axis) return anim.target;
  return read(el, axis);
}

/** Stop a lerp. Does not run onSettle — cancel is not a successful wrap. */
export function cancelScrollAnim(el: HTMLElement): void {
  const anim = animByEl.get(el);
  if (anim === undefined) return;
  if (anim.raf > 0) cancelAnimationFrame(anim.raf);
  anim.onSettle = undefined;
  animByEl.delete(el);
  live.delete(el);
}

export function jumpAxis(el: HTMLElement, axis: Axis, value: number): void {
  cancelScrollAnim(el);
  write(el, axis, value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function read(el: HTMLElement, axis: Axis): number {
  return axis === 'x' ? el.scrollLeft : el.scrollTop;
}

function write(el: HTMLElement, axis: Axis, value: number): void {
  if (axis === 'x') el.scrollLeft = value;
  else el.scrollTop = value;
}

function finish(el: HTMLElement, anim: ScrollAnim): void {
  write(el, anim.axis, anim.target);
  anim.raf = 0;
  animByEl.delete(el);
  live.delete(el);
  const done = anim.onSettle;
  anim.onSettle = undefined;
  done?.();
}

export function animate(el: HTMLElement, axis: Axis, target: number, onSettle?: () => void): void {
  const max =
    axis === 'x' ? Math.max(0, el.scrollWidth - el.clientWidth) : Math.max(0, el.scrollHeight - el.clientHeight);
  const next = clamp(target, 0, max);
  const current = read(el, axis);
  if (!Number.isFinite(target)) return;
  if (prefersReducedMotion() || Math.abs(next - current) < SETTLE) {
    cancelScrollAnim(el);
    write(el, axis, next);
    onSettle?.();
    return;
  }

  let state = animByEl.get(el);
  if (state !== undefined && state.axis !== axis) {
    cancelScrollAnim(el);
    state = undefined;
  }
  if (state === undefined) {
    state = { axis, target: next, raf: 0, steps: 0, position: current, displayed: current };
    animByEl.set(el, state);
  }
  watchMotionFreeze();
  live.add(el);
  if (state.target !== next) state.steps = 0;
  state.target = next;
  if (onSettle !== undefined) state.onSettle = onSettle;
  if (state.raf !== 0) return;

  const step = (time: number): void => {
    const anim = animByEl.get(el);
    if (anim === undefined) return;
    if (el.isConnected === false) {
      cancelScrollAnim(el);
      return;
    }
    if (prefersReducedMotion()) {
      finish(el, anim);
      return;
    }
    // Retain fractional motion internally. Some TV browsers round scroll
    // offsets to pixels, which otherwise stalls the final frames at 120 Hz.
    const diff = anim.target - anim.position;
    if (Math.abs(diff) < SETTLE) {
      finish(el, anim);
      return;
    }
    const elapsed = anim.lastTime === undefined ? FRAME_MS : time - anim.lastTime;
    anim.lastTime = time;
    const nextPosition = anim.position + diff * scrollEase(elapsed);
    anim.position = nextPosition;
    write(el, anim.axis, nextPosition);
    anim.steps += 1;
    // Reading scrollLeft forces layout. Check a frozen scroller on the first
    // tick and every few frames, not on every camera hop.
    if (anim.steps >= MAX_STEPS) {
      finish(el, anim);
      return;
    }
    if (anim.steps === 1 || anim.steps % 4 === 0) {
      const moved = read(el, anim.axis);
      if (Math.abs(moved - anim.displayed) < 0.01 && Math.abs(nextPosition - anim.displayed) >= 1) {
        finish(el, anim);
        return;
      }
      anim.displayed = moved;
    }
    anim.raf = requestAnimationFrame(step);
  };

  state.raf = requestAnimationFrame(step);
}

export function scrollAxis(el: HTMLElement, axis: Axis, target: number, onSettle?: () => void): void {
  animate(el, axis, target, onSettle);
}
