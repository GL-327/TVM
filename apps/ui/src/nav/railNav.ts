/**
 * Vertical moves stay on neighbouring rows.
 *
 * The top nav pill is an overlay, so spatial navigation would otherwise treat
 * it as a left-edge target or miss it while it is hidden. Rails, the ribbon
 * and the hero are a stack of rows: Up/Down pick the closest card on the next
 * row. Up with no row above emerges the ribbon.
 */

import { canonicalFocusId, isLoopClone, isWrapAcross } from './loopingRail';

export const VERTICAL_ROW_SELECTOR = [
  '.stage__copy',
  '.ribbon',
  '.stream-chrome',
  '.rail__track',
  '.service-rail',
  '.service-nav',
  '.service-hero__actions',
  '.service-side',
  '.page__toolbar',
  '.hero__actions',
  '.channel-chips',
  '.prime-hub__nav',
  '.prime-hub__actions',
  '.dplus-nav',
  '.dplus-brands',
  '.dplus-hero__actions',
  '.max-nav',
  '.max-hero__actions',
  '.hulu-hub__actions',
  '.appletv-hub__actions',
  '.peacock-hub__actions',
  '.legacy-hub__actions',
  '.nf-hub__actions',
].join(', ');

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

/** Modular distance on a looping rail. Adjacent (or wrap) is always 1. */
export function railHopDistance(from: number, to: number, count: number): number {
  if (count < 1 || from < 0 || to < 0 || from >= count || to >= count) return Number.POSITIVE_INFINITY;
  const right = (to - from + count) % count;
  const left = (from - to + count) % count;
  return Math.min(right, left);
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

export function logicalCard(element: HTMLElement): HTMLElement {
  if (!isLoopClone(element)) return element;
  const id = canonicalFocusId(element.getAttribute('data-focus-id') ?? '');
  const track = element.closest('.rail__track');
  if (track === null || id === '') return element;
  const real = track.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]:not([data-loop-clone="true"])`);
  return real ?? element;
}

/** Bumped only when focusable nodes are added, removed, or retargeted — not on focus. */
let focusTreeGen = 0;
let focusTreeWatching = false;

const focusablesCache = new WeakMap<HTMLElement, { gen: number; items: HTMLElement[] }>();
const rowsCache = new WeakMap<ParentNode, { gen: number; rows: HTMLElement[] }>();

export function focusTreeGeneration(): number {
  watchFocusTree();
  return focusTreeGen;
}

function watchFocusTree(): void {
  if (focusTreeWatching || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  focusTreeWatching = true;
  new MutationObserver(() => {
    focusTreeGen += 1;
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-focus-id', 'data-loop-clone'],
  });
}

function itemsLive(items: readonly HTMLElement[]): boolean {
  for (const item of items) {
    if (!item.isConnected) return false;
  }
  return true;
}

function navRows(root: ParentNode): HTMLElement[] {
  const gen = focusTreeGeneration();
  const hit = rowsCache.get(root);
  if (hit !== undefined && hit.gen === gen && itemsLive(hit.rows)) return hit.rows;

  const found = [...root.querySelectorAll<HTMLElement>(VERTICAL_ROW_SELECTOR)];
  const rows = found.filter((row) => !found.some((other) => other !== row && other.contains(row)));
  const ribbon: HTMLElement[] = [];
  const rest: HTMLElement[] = [];
  for (const row of rows) {
    if (row.classList.contains('ribbon') || row.closest('.ribbon') !== null) ribbon.push(row);
    else rest.push(row);
  }
  const ordered = [...ribbon, ...rest];
  rowsCache.set(root, { gen, rows: ordered });
  return ordered;
}

export function focusablesIn(row: HTMLElement): HTMLElement[] {
  const gen = focusTreeGeneration();
  const hit = focusablesCache.get(row);
  if (hit !== undefined && hit.gen === gen && itemsLive(hit.items)) return hit.items;

  const found = [...row.querySelectorAll<HTMLElement>('[data-focus-id]:not([data-loop-clone="true"])')];
  const seen = new Set<string>();
  const unique: HTMLElement[] = [];
  for (const element of found) {
    const id = canonicalFocusId(element.getAttribute('data-focus-id') ?? '');
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    unique.push(element);
  }
  focusablesCache.set(row, { gen, items: unique });
  return unique;
}

export function indexOfFocusable(items: readonly HTMLElement[], card: HTMLElement): number {
  const direct = items.findIndex((item) => item === card || item.contains(card));
  if (direct >= 0) return direct;
  const id = canonicalFocusId(card.getAttribute('data-focus-id') ?? '');
  if (id === '') return -1;
  return items.findIndex((item) => canonicalFocusId(item.getAttribute('data-focus-id') ?? '') === id);
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
  const track = card.closest<HTMLElement>('.rail__track');
  if (track === null) return null;
  const items = focusablesIn(track);
  if (items.length === 0) return null;
  const index = indexOfFocusable(items, card);
  const nextIndex = wrapIndex(index, direction, items.length);
  if (nextIndex === null) return null;
  return items[nextIndex] ?? null;
}

export function loopingTrackOf(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>('.rail__track[data-looping="true"]');
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
  const index = indexOfFocusable(items, card);
  return isWrapAcross(index, direction, items.length);
}

export function ribbonFocusTarget(element: HTMLElement): string | null {
  if (element.closest('.ribbon') !== null) return null;
  const root = element.closest('.screen-layer, .modal-layer');
  const ribbon = root?.querySelector<HTMLElement>('.ribbon');
  if (ribbon === undefined || ribbon === null) return null;
  const items = focusablesIn(ribbon);
  if (items.length === 0) return null;
  const index = pickClosestIndex(
    items.map((item) => centerX(item)),
    centerX(element),
  );
  const next = items[index] ?? items[0];
  return next === undefined ? null : focusKeyFor(next);
}
