import { isWrapAcross } from './loopingRail';
import {
  focusablesIn,
  focusTreeGeneration,
  indexOfFocusable,
  logicalCard,
  loopingTrackOf,
  wrapIndex,
} from './railNav';

/** Horizontal rails, category tabs, chips, and 2D grids that must loop. */
export const WRAP_GROUP_SELECTOR = [
  '.rail__track',
  '.ribbon__list',
  '.service-nav__tabs',
  '.service-hero__actions',
  '.channel-chips',
  '.channel-grid',
  '.app-grid',
  '.plan-grid',
  '.hero__actions',
  '.settings-list',
  '[data-wrap]',
  '[class*="__tabs"]',
  '[class*="__actions"]',
  '[class*="-grid"]',
  '[class*="-chips"]',
  '[class*="-brands"]',
].join(', ');

export type WrapAxis = 'x' | 'y' | 'grid';

export interface WrapHop {
  next: HTMLElement | null;
  consume: boolean;
}

export interface WrapGroupRecord {
  group: HTMLElement;
  items: HTMLElement[];
  kind: WrapAxis;
  columns: number;
}

const ROW_CLASS = new Set([
  'rail__track',
  'ribbon__list',
  'service-nav__tabs',
  'service-hero__actions',
  'channel-chips',
  'hero__actions',
  'stream-chrome',
]);

const GRID_CLASS = new Set(['channel-grid', 'app-grid', 'plan-grid', 'profile-grid', 'poster-grid']);

interface CachedWrap {
  tree: number;
  view: number;
  items: HTMLElement[];
  kind: WrapAxis;
  columns: number;
}

const wrapCache = new WeakMap<HTMLElement, CachedWrap>();
let viewGen = 0;
let viewWatching = false;

function watchViewport(): void {
  if (viewWatching || typeof window === 'undefined') return;
  viewWatching = true;
  window.addEventListener(
    'resize',
    () => {
      viewGen += 1;
    },
    { passive: true },
  );
}

function itemsLive(items: readonly HTMLElement[]): boolean {
  if (items.length === 0) return false;
  for (const item of items) {
    if (!item.isConnected) return false;
  }
  return true;
}

/**
 * Axis from markup only. `app-card--grid` is a tile, not a host, so `--` modifiers
 * never count as a grid.
 */
export function inferWrapKind(className: string, dataWrap: string | null): WrapAxis | null {
  if (dataWrap === 'row' || dataWrap === 'x') return 'x';
  if (dataWrap === 'col' || dataWrap === 'column' || dataWrap === 'y') return 'y';
  if (dataWrap === 'grid') return 'grid';
  for (const token of className.split(/\s+/)) {
    if (token === '') continue;
    if (GRID_CLASS.has(token)) return 'grid';
    if (ROW_CLASS.has(token)) return 'x';
    if (token === 'settings-list') return 'y';
    if (token.includes('--')) continue;
    if (token.endsWith('-grid')) return 'grid';
    if (
      token.endsWith('__tabs') ||
      token.endsWith('__actions') ||
      token.endsWith('-chips') ||
      token.endsWith('-brands')
    ) {
      return 'x';
    }
  }
  return null;
}

export function wrapFocusId(
  direction: string,
  index: number,
  total: number,
  firstId: string,
  lastId: string,
): string | null {
  if (total < 2) return null;
  if (direction === 'right' && index === total - 1) return firstId;
  if (direction === 'left' && index === 0) return lastId;
  return null;
}

export function countColumns(tops: readonly number[], threshold = 8): number {
  if (tops.length === 0) return 0;
  const first = tops[0] ?? 0;
  let columns = 0;
  for (const top of tops) {
    if (Math.abs(top - first) > threshold) break;
    columns += 1;
  }
  return Math.max(1, columns);
}

export function wrapGroupKind(columns: number, count: number): WrapAxis {
  if (count < 2) return 'x';
  if (columns <= 1) return 'y';
  if (columns >= count) return 'x';
  return 'grid';
}

/**
 * Loop inside a grid. Left/right stay on the current row.
 * Down from the last row wraps to the first. Up from the first row
 * returns null so the page can emerge the top nav pill.
 */
export function wrapGridIndex(
  direction: string,
  index: number,
  total: number,
  columns: number,
): number | null {
  if (total < 2 || columns < 1 || index < 0 || index >= total) return null;
  const row = Math.floor(index / columns);
  const col = index % columns;
  const rowStart = row * columns;
  const rowEnd = Math.min(rowStart + columns, total) - 1;

  if (direction === 'right') return index >= rowEnd ? rowStart : index + 1;
  if (direction === 'left') return index <= rowStart ? rowEnd : index - 1;
  if (direction === 'down') {
    const next = index + columns;
    if (next < total) return next;
    return col < total ? col : 0;
  }
  if (direction === 'up') {
    if (row === 0) return null;
    return index - columns;
  }
  return null;
}

export function wrapIndexInGroup(
  direction: string,
  index: number,
  total: number,
  kind: WrapAxis,
  columns: number,
): number | null {
  if (total < 2 || index < 0 || index >= total) return null;
  if (kind === 'grid') return wrapGridIndex(direction, index, total, columns);
  if (kind === 'y') {
    if (direction !== 'up' && direction !== 'down') return null;
    if (direction === 'down') return index === total - 1 ? 0 : index + 1;
    if (index === 0) return null;
    return index - 1;
  }
  if (direction !== 'left' && direction !== 'right') return null;
  if (direction === 'right') return index === total - 1 ? 0 : index + 1;
  return index === 0 ? total - 1 : index - 1;
}

/**
 * Conveyor seam only: last→first / first→last. Mid-rail hops stay on wrapHop
 * so the camera can keep riding the middle copy.
 */
export function conveyorWrapIndex(direction: string, index: number, count: number): number | null {
  if (direction !== 'left' && direction !== 'right') return null;
  if (!isWrapAcross(index, direction, count)) return null;
  return wrapIndex(index, direction, count);
}

function conveyorTrackOf(element: HTMLElement, card: HTMLElement): HTMLElement | null {
  return loopingTrackOf(card) ?? loopingTrackOf(element);
}

export function shouldConsumeAxis(kind: WrapAxis, direction: string): boolean {
  if (kind === 'y') return direction === 'up' || direction === 'down';
  return direction === 'left' || direction === 'right';
}

/** Eat the key only when there is a real next card. Consume-with-null kills the remote. */
export function hopOrPass(next: HTMLElement | null): WrapHop {
  return next !== null ? { next, consume: true } : { next: null, consume: false };
}

export function wrapGroupOf(element: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = logicalCard(element);
  if (node.hasAttribute('data-focus-id')) node = node.parentElement;
  while (node !== null) {
    const match = node.closest<HTMLElement>(WRAP_GROUP_SELECTOR);
    if (match === null) return null;
    // Tiles like `.app-card--grid` match the wildcard; they are not hosts.
    if (!match.hasAttribute('data-focus-id')) return match;
    node = match.parentElement;
  }
  return null;
}

function measureColumns(items: readonly HTMLElement[]): number {
  if (items.length === 0) return 0;
  const first = items[0]?.getBoundingClientRect().top ?? 0;
  let columns = 0;
  for (const item of items) {
    if (Math.abs(item.getBoundingClientRect().top - first) > 8) break;
    columns += 1;
  }
  return Math.max(1, columns);
}

export function wrapGroupRecord(group: HTMLElement): WrapGroupRecord {
  watchViewport();
  const tree = focusTreeGeneration();
  const view = viewGen;
  const hit = wrapCache.get(group);
  if (hit !== undefined && hit.tree === tree && hit.view === view && itemsLive(hit.items)) {
    return { group, items: hit.items, kind: hit.kind, columns: hit.columns };
  }

  const items = focusablesIn(group);
  const inferred = inferWrapKind(group.className, group.getAttribute('data-wrap'));
  let kind: WrapAxis;
  let columns: number;
  if (inferred === 'x') {
    kind = 'x';
    columns = items.length;
  } else if (inferred === 'y') {
    kind = 'y';
    columns = 1;
  } else {
    columns = measureColumns(items);
    kind = inferred ?? wrapGroupKind(columns, items.length);
  }

  wrapCache.set(group, { tree, view, items, kind, columns });
  return { group, items, kind, columns };
}

export function wrapGroupAxis(group: HTMLElement): WrapAxis {
  return wrapGroupRecord(group).kind;
}

/** Next focusable in a wrap group, or null if this direction should leave the group. */
export function wrapFocusElement(element: HTMLElement, direction: string): HTMLElement | null {
  return wrapHop(element, direction).next;
}

export function wrapHop(element: HTMLElement, direction: string): WrapHop {
  const card = logicalCard(element);
  const group = wrapGroupOf(card);
  if (group === null) return { next: null, consume: false };

  const record = wrapGroupRecord(group);
  const index = indexOfFocusable(record.items, card);
  if (index < 0 || record.items.length === 0) {
    return hopOrPass(null);
  }

  // Rails stay one title per hop even if this group was inferred as a grid.
  if (direction === 'left' || direction === 'right') {
    const track = conveyorTrackOf(element, card) ?? (group.classList.contains('rail__track') ? group : null);
    if (track !== null) {
      const seam = conveyorWrapIndex(direction, index, record.items.length);
      if (seam !== null) return hopOrPass(record.items[seam] ?? null);
      const next = wrapIndex(index, direction, record.items.length);
      return hopOrPass(next === null ? null : (record.items[next] ?? null));
    }
  }

  const nextIndex = wrapIndexInGroup(direction, index, record.items.length, record.kind, record.columns);
  if (nextIndex === null) return { next: null, consume: false };
  return hopOrPass(record.items[nextIndex] ?? null);
}

export function shouldConsumeWrap(group: HTMLElement, direction: string): boolean {
  return shouldConsumeAxis(wrapGroupRecord(group).kind, direction);
}

/** Last→first (or first→last) hop on a 3-copy conveyor rail. */
export function conveyorHop(
  element: HTMLElement,
  direction: 'left' | 'right',
): { track: HTMLElement; next: HTMLElement } | null {
  const card = logicalCard(element);
  const track = conveyorTrackOf(element, card);
  if (track === null) return null;
  const items = focusablesIn(track);
  const index = indexOfFocusable(items, card);
  const nextIndex = conveyorWrapIndex(direction, index, items.length);
  if (nextIndex === null) return null;
  const next = items[nextIndex];
  if (next === undefined) return null;
  return { track, next };
}
