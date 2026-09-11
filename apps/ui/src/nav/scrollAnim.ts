/** Shared camera tweens. Kept out of loopingRail ↔ revealFocused so they do not cycle. */
import { prefersReducedMotion } from '../theme/motion';

type Axis = 'x' | 'y';

interface ScrollAnim {
  axis: Axis;
  target: number;
  raf: number;
  steps: number;
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

export function isScrollAnimating(el: HTMLElement): boolean {
  return animByEl.has(el);
}

/** Stop a lerp. Does not run onSettle — cancel is not a successful wrap. */
export function cancelScrollAnim(el: HTMLElement): void {
  const anim = animByEl.get(el);
  if (anim === undefined) return;
  if (anim.raf > 0) cancelAnimationFrame(anim.raf);
  anim.onSettle = undefined;
  animByEl.delete(el);
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
  const done = anim.onSettle;
  anim.onSettle = undefined;
  done?.();
}

export function animate(el: HTMLElement, axis: Axis, target: number, onSettle?: () => void): void {
  const max =
    axis === 'x' ? Math.max(0, el.scrollWidth - el.clientWidth) : Math.max(0, el.scrollHeight - el.clientHeight);
  const next = clamp(target, 0, max);
  const current = read(el, axis);
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
    state = { axis, target: next, raf: 0, steps: 0 };
    animByEl.set(el, state);
  }
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
    const now = read(el, anim.axis);
    const diff = anim.target - now;
    if (Math.abs(diff) < SETTLE) {
      finish(el, anim);
      return;
    }
    const elapsed = anim.lastTime === undefined ? FRAME_MS : time - anim.lastTime;
    anim.lastTime = time;
    write(el, anim.axis, now + diff * scrollEase(elapsed));
    const moved = read(el, anim.axis);
    anim.steps += 1;
    if (Math.abs(moved - now) < 0.01 || anim.steps >= MAX_STEPS) {
      finish(el, anim);
      return;
    }
    anim.raf = requestAnimationFrame(step);
  };

  state.raf = requestAnimationFrame(step);
}

export function scrollAxis(el: HTMLElement, axis: Axis, target: number, onSettle?: () => void): void {
  animate(el, axis, target, onSettle);
}
