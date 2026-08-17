/**
 * The focus engine, wrapped once.
 *
 * Norigin owns the geometry: given a direction and the current element, it
 * decides what is spatially next. It does not own the keyboard. Its own key
 * listener is neutralised here so that every button on the remote is
 * interpreted in exactly one place, `@tvm/nav`'s intents module, which is the
 * only code allowed to know what a key code means.
 *
 * Nothing outside this file imports the library.
 */
import {
  GetBoundingClientRectAdapter,
  doesFocusableExist,
  getCurrentFocusKey,
  init,
  navigateByDirection,
  setFocus,
  setKeyMap,
} from '@noriginmedia/norigin-spatial-navigation';
import type { Intent } from '@tvm/nav';

let started = false;

export function startFocusEngine(): void {
  if (started) return;
  started = true;

  init({
    // Real DOM focus follows virtual focus. That keeps :focus styling, screen
    // readers and document.activeElement all telling the same story.
    shouldFocusDOMNode: true,
    domNodeFocusOptions: { preventScroll: true },
    // Viewport-relative measurement. The offsetParent default mismeasures
    // anything inside a fixed-position modal.
    layoutAdapter: GetBoundingClientRectAdapter,
    debug: false,
    visualDebug: false,
  });

  // setKeyMap merges, so an empty list per direction is how the library's own
  // listener is silenced without unbinding it.
  setKeyMap({ left: [], right: [], up: [], down: [], enter: [] });
}

export type FocusDirection = Extract<Intent, 'up' | 'down' | 'left' | 'right'>;

export function moveFocus(direction: FocusDirection): void {
  void navigateByDirection(direction);
}

/**
 * Activates whatever currently holds focus. Remote OK arrives as an intent,
 * and the intent handler suppresses the browser's own Enter-to-click, so this
 * is the single activation path rather than a second one.
 */
export function activateFocused(): void {
  const element = document.activeElement;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.dispatchEvent(new CustomEvent('tvm:field-confirm', { bubbles: true }));
    return;
  }
  if (element instanceof HTMLElement) element.click();
}

export function focusExists(focusKey: string): boolean {
  return doesFocusableExist(focusKey);
}

export function currentFocusKey(): string | null {
  // Typed as string, but empty before anything has been focused.
  return getCurrentFocusKey() || null;
}

export function requestFocus(focusKey: string): void {
  void setFocus(focusKey);
}
