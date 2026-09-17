import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { onIntent, type IntentEvent } from '@tvm/nav';
import { activateFocused, currentFocusKey, focusExists, moveFocus, requestFocus } from '../nav/focusEngine';
import { isPhoneNavShell, isTextEntryTarget } from '../nav/pointerInput';

/**
 * Remote and keyboard control for the door.
 *
 * The view stack is the only thing subscribed to remote input, and the gate is
 * rendered *instead of* the view stack — so on the sign-in form nothing moved
 * focus, nothing had focus to begin with, and Enter in a field did nothing at
 * all. On a laptop that read as a broken login (type your password, press
 * Enter, nothing). On the appliance, which has a remote and no mouse, there
 * was no way to sign in whatsoever.
 *
 * This is the same contract the view stack applies, cut down to what a single
 * panel needs: arrows move focus, OK activates, Enter in a field confirms it,
 * Back steps back. The gate never renders alongside the view stack, so the two
 * handlers can never both see one key press.
 *
 * Enter inside a field is taken earlier, on the form (confirmFieldOnEnter),
 * because phones never let text-field keys reach this handler — pointerInput
 * stops keys that belong to the system keyboard. The forms are real <form>s
 * as well, so a keyboard whose Go key sends no usable key event still submits.
 */

/** The gate has no view-stack entry, so its focus keys live in the root scope. */
export function gateFocusKey(id: string): string {
  return `root/${id}`;
}

export interface GateRemoteOptions {
  /** Control to focus when the panel appears, on anything but a phone. */
  first: string | null;
  /** Changes whenever the panel changes shape, so focus is placed again. */
  panel: string;
  /** Back / Escape. */
  onBack?: () => void;
}

export function handleGateIntent({ intent, source }: IntentEvent, focusFirst: () => void, onBack?: () => void): void {
  const target = source.target;
  if (isTextEntryTarget(target)) {
    const field = target as HTMLElement;
    // Keep the engine's idea of focus in step with a field that was clicked.
    const own = field.dataset.focusId;
    if (own !== undefined && focusExists(gateFocusKey(own))) requestFocus(gateFocusKey(own));
    if (intent === 'select' && (source.key === 'Enter' || source.key === 'NumpadEnter')) {
      source.preventDefault();
      field.dispatchEvent(new CustomEvent('tvm:field-confirm', { bubbles: true }));
      return;
    }
    // Left and right belong to the caret; up and down leave the field.
    if (intent === 'up' || intent === 'down') {
      source.preventDefault();
      moveFocus(intent);
      return;
    }
    if (intent === 'back' && source.key === 'Escape') {
      source.preventDefault();
      onBack?.();
    }
    return;
  }

  if (intent === 'up' || intent === 'down' || intent === 'left' || intent === 'right') {
    source.preventDefault();
    if (currentFocusKey() === null || document.activeElement === document.body) focusFirst();
    else moveFocus(intent);
    return;
  }
  if (intent === 'select') {
    source.preventDefault();
    if (document.activeElement === null || document.activeElement === document.body) focusFirst();
    else activateFocused();
    return;
  }
  if (intent === 'back') {
    source.preventDefault();
    onBack?.();
  }
}

export function useGateRemote({ first, panel, onBack }: GateRemoteOptions): void {
  const backRef = useRef(onBack);
  backRef.current = onBack;
  const firstRef = useRef(first);
  firstRef.current = first;

  useEffect(() => {
    const focusFirst = (): void => {
      const id = firstRef.current;
      if (id !== null && focusExists(gateFocusKey(id))) requestFocus(gateFocusKey(id));
    };
    return onIntent(window, (event) => handleGateIntent(event, focusFirst, backRef.current), { preventDefault: false });
  }, []);

  useEffect(() => {
    // A phone opens its keyboard the moment a field takes focus, which would
    // cover half the panel before anyone has read it. Touch needs no initial
    // focus anyway.
    if (first === null || isPhoneNavShell()) return;
    const timer = window.setTimeout(() => {
      if (focusExists(gateFocusKey(first))) requestFocus(gateFocusKey(first));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [first, panel]);
}

/**
 * Enter inside a gate form confirms the field it was pressed in.
 *
 * Handled on the form, before either the phone keyboard guard or the intent
 * handler sees it, so every platform takes the same path: Enter in the email
 * field moves to the password, and only Enter in the last field submits. Left
 * to the browser, a phone's Return in the email field would submit a form with
 * no password and answer with "those do not match".
 */
export function confirmFieldOnEnter(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Enter' && event.key !== 'NumpadEnter') return;
  if (event.nativeEvent.isComposing) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  event.preventDefault();
  event.stopPropagation();
  target.dispatchEvent(new CustomEvent('tvm:field-confirm', { bubbles: true }));
}
