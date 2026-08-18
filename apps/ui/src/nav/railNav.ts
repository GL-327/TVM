/**
 * Vertical moves on Home stay on neighbouring rows.
 *
 * The ribbon is sticky, so spatial navigation treats it as the nearest target
 * above every poster and Up jumps to the top of the page. Rails, the ribbon
 * and the hero are therefore a stack of rows: Up/Down pick the closest card
 * on the next row, and clamp at the ends.
 */

import { canonicalFocusId, isLoopClone, isWrapAcross } from './loopingRail';

export const VERTICAL_ROW_SELECTOR =
  '.stage__copy, .ribbon, .stream-chrome, .rail__track, .service-nav, .service-hero__actions, .service-side';

export const HORIZONTAL_TRACK_SELECTOR =
  '.rail__track, .ribbon, .service-nav__tabs, .live-cats, .search-results, .season-row';

export function pickClosestIndex(centers: readonly number[], target: number): number {
  if (centers.length === 0) return -1;
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let index = 0; index < centers.length; index += 1) {
    const dist = Math.abs((centers[index] ?? 0) - target);
    if (dist < bestDist) {
      best = index;
      bestDist = dist;
    }
  }
  return best;
}

export function neighborRowIndex(current: number, direction: 'up' | 'down', count: number): number | null {
  if (count <= 0 || current < 0 || current >= count) return null;
  if (direction === 'up') return current > 0 ? current - 1 : null;
  return current < count - 1 ? current + 1 : null;
}

export function wrapIndex(index: number, direction: 'left' | 'right', count: number): number | null {
  if (count < 1 || index < 0 || index >= count) return null;
  if (direction === 'right') return (index + 1) % count;
  return (index - 1 + count) % count;
}

export function adjacentIndex(
  index: number,
  direction: 'left' | 'right',
  count: number,
  loop: boolean,
): number | null {
  if (loop) return wrapIndex(index, direction, count);
  if (count < 1 || index < 0 || index >= count) return null;
  if (direction === 'right') return index < count - 1 ? index + 1 : null;
  return index > 0 ? index - 1 : null;
}

export function isVerticalNavContext(element: HTMLElement): boolean {
  return element.closest(VERTICAL_ROW_SELECTOR) !== null;
}

export function focusKeyFor(element: HTMLElement): string | null {
  const raw = element.getAttribute('data-focus-id');
  const id = raw === null || raw === '' ? '' : canonicalFocusId(raw);
  const scope = element.closest('[data-focus-scope]')?.getAttribute('data-focus-scope');
  if (id === '' || scope === null || scope === '') return null;
  return `${scope}/${id}`;
}

export function loopingTrackOf(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>('[data-looping="true"]');
}

export function logicalCard(element: HTMLElement): HTMLElement {
  if (!isLoopClone(element)) return element;
  const id = canonicalFocusId(element.getAttribute('data-focus-id') ?? '');
  const track = loopingTrackOf(element) ?? element.closest<HTMLElement>(HORIZONTAL_TRACK_SELECTOR);
  if (track === null || id === '') return element;
  const real = track.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]:not([data-loop-clone="true"])`);
  return real ?? element;
}

function navRows(root: ParentNode): HTMLElement[] {
  const found = [...root.querySelectorAll<HTMLElement>(VERTICAL_ROW_SELECTOR)];
  return found.filter((row) => !found.some((other) => other !== row && other.contains(row)));
}

function focusablesIn(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>('[data-focus-id]:not([data-loop-clone="true"])')];
}

function centerX(element: HTMLElement): number {
  const box = element.getBoundingClientRect();
  return box.left + box.width / 2;
}

export function neighborElement(element: HTMLElement, direction: 'up' | 'down'): HTMLElement | null {
  const root = element.closest('.screen-layer, .modal-layer');
  if (root === null) return null;
  const rows = navRows(root).filter((row) => focusablesIn(row).length > 0);
  const currentRow = rows.find((row) => row.contains(element));
  if (currentRow === undefined) return null;
  const nextIndex = neighborRowIndex(rows.indexOf(currentRow), direction, rows.length);
  if (nextIndex === null) return null;
  const nextRow = rows[nextIndex];
  if (nextRow === undefined) return null;
  const items = focusablesIn(nextRow);
  const index = pickClosestIndex(
    items.map((item) => centerX(item)),
    centerX(element),
  );
  return items[index] ?? null;
}

export function neighborFocusTarget(element: HTMLElement, direction: 'up' | 'down'): string | null {
  const next = neighborElement(element, direction);
  if (next === null) return null;
  return focusKeyFor(next);
}

export function neighborInTrack(element: HTMLElement, direction: 'left' | 'right'): HTMLElement | null {
  const card = logicalCard(element);
  const track = card.closest<HTMLElement>(HORIZONTAL_TRACK_SELECTOR);
  if (track === null) return null;
  const items = focusablesIn(track);
  if (items.length === 0) return null;
  const index = items.findIndex((item) => item === card || item.contains(card));
  const nextIndex = wrapIndex(index, direction, items.length);
  if (nextIndex === null) return null;
  return items[nextIndex] ?? null;
}

export function neighborInTrackFocusTarget(element: HTMLElement, direction: 'left' | 'right'): string | null {
  const next = neighborInTrack(element, direction);
  if (next === null) return null;
  return focusKeyFor(next);
}

export function conveyorWrapNeeded(element: HTMLElement, direction: 'left' | 'right'): boolean {
  const card = logicalCard(element);
  const track = loopingTrackOf(card);
  if (track === null) return false;
  const items = focusablesIn(track);
  const index = items.findIndex((item) => item === card || item.contains(card));
  return isWrapAcross(index, direction, items.length);
}
