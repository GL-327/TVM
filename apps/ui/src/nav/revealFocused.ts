/**
 * Camera for the ten-foot UI.
 *
 * Spatial nav measures live bounding boxes, so a long ease would send the next
 * D-pad hop to the wrong card. The camera therefore lerps quickly (~120ms) and
 * always writes the final target, which is how Home used to feel frozen: the
 * highlight moved and the page never did.
 */

const EASE = 0.28;
const SETTLE = 0.6;

type Axis = 'x' | 'y';

interface ScrollAnim {
  axis: Axis;
  target: number;
  raf: number;
  onSettle?: () => void;
}

const animByEl = new WeakMap<HTMLElement, ScrollAnim>();

export function cancelScrollAnim(el: HTMLElement): void {
  const anim = animByEl.get(el);
  if (anim === undefined) return;
  if (anim.raf !== 0) cancelAnimationFrame(anim.raf);
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
  const done = anim.onSettle;
  anim.onSettle = undefined;
  done?.();
}

function animate(el: HTMLElement, axis: Axis, target: number, onSettle?: () => void): void {
  const max = axis === 'x' ? Math.max(0, el.scrollWidth - el.clientWidth) : Math.max(0, el.scrollHeight - el.clientHeight);
  const next = clamp(target, 0, max);
  const current = read(el, axis);
  if (Math.abs(next - current) < SETTLE) {
    write(el, axis, next);
    onSettle?.();
    return;
  }

  let state = animByEl.get(el);
  if (state === undefined || state.axis !== axis) {
    state = { axis, target: next, raf: 0 };
    animByEl.set(el, state);
  }
  state.target = next;
  if (onSettle !== undefined) state.onSettle = onSettle;
  if (state.raf !== 0) return;

  const step = (): void => {
    const anim = animByEl.get(el);
    if (anim === undefined) return;
    const now = read(el, anim.axis);
    const diff = anim.target - now;
    if (Math.abs(diff) < SETTLE) {
      finish(el, anim);
      return;
    }
    write(el, anim.axis, now + diff * EASE);
    anim.raf = requestAnimationFrame(step);
  };

  state.raf = requestAnimationFrame(step);
}

export function scrollAxis(el: HTMLElement, axis: Axis, target: number, onSettle?: () => void): void {
  animate(el, axis, target, onSettle);
}

function centerInRow(row: HTMLElement, card: HTMLElement): void {
  if (row.dataset.wrapping === 'true') return;
  const cardBox = card.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  let target = row.scrollLeft + cardBox.left - rowBox.left - (rowBox.width - cardBox.width) / 2;
  if (row.dataset.looping === 'true') {
    const setWidth = row.scrollWidth / 3;
    if (setWidth > 1) {
      while (target < setWidth * 0.5) target += setWidth;
      while (target >= setWidth * 1.5) target -= setWidth;
    }
  }
  animate(row, 'x', target);
}

export function rowCameraTop(scrollTop: number, railTop: number, viewTop: number, ribbonHeight: number): number {
  return scrollTop + (railTop - viewTop) - ribbonHeight;
}

export function revealFocused(element: HTMLElement): void {
  const row = element.closest<HTMLElement>('.rail__track, .ribbon');
  if (row !== null) centerInRow(row, element);

  const scroller = element.closest<HTMLElement>('.home, .page, .details');
  if (scroller === null) return;

  const onHome = scroller.classList.contains('home');
  const onChrome = element.closest('.ribbon, .stage, .stream-chrome') !== null;

  if (onHome && onChrome) {
    animate(scroller, 'y', 0);
    return;
  }

  if (onHome) {
    const rail = element.closest<HTMLElement>('.rail, .home-row');
    const chrome = scroller.querySelector<HTMLElement>('.stream-chrome, .ribbon');
    if (rail !== null) {
      const chromeHeight = chrome?.getBoundingClientRect().height ?? 0;
      const view = scroller.getBoundingClientRect();
      const railBox = rail.getBoundingClientRect();
      animate(scroller, 'y', rowCameraTop(scroller.scrollTop, railBox.top, view.top, chromeHeight + 6));
      return;
    }
  }

  const chrome = scroller.querySelector<HTMLElement>('.ribbon, .dock, .topbar');
  const padTop = (chrome?.getBoundingClientRect().height ?? 0) + 16;
  const padBottom = 28;
  const card = element.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const top = card.top - view.top;
  const bottom = card.bottom - view.top;
  const height = scroller.clientHeight;

  if (top < padTop) {
    animate(scroller, 'y', scroller.scrollTop - (padTop - top));
  } else if (bottom > height - padBottom) {
    animate(scroller, 'y', scroller.scrollTop + (bottom - (height - padBottom)));
  }
}
