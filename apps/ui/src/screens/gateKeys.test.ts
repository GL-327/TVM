import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntentEvent } from '@tvm/nav';
import { activateFocused, currentFocusKey, moveFocus, requestFocus } from '../nav/focusEngine';
import { confirmFieldOnEnter, gateFocusKey, handleGateIntent } from './gateKeys';

vi.mock('../nav/focusEngine', () => ({
  activateFocused: vi.fn(),
  currentFocusKey: vi.fn(() => 'root/gate-submit'),
  focusExists: vi.fn(() => true),
  moveFocus: vi.fn(),
  requestFocus: vi.fn(),
}));

class FakeElement {
  dispatched: string[] = [];
  constructor(readonly field: boolean, readonly dataset: Record<string, string> = {}) {}
  closest(): unknown { return this.field ? this : null; }
  dispatchEvent(event: { type: string }): boolean { this.dispatched.push(event.type); return true; }
}
class FakeInput extends FakeElement {}

const body = new FakeElement(false);
let active: unknown = new FakeElement(false);

function press(key: string, intent: IntentEvent['intent'], target: FakeElement): IntentEvent & { prevented: () => boolean } {
  let prevented = false;
  const source = { key, target, preventDefault: () => { prevented = true; } } as unknown as KeyboardEvent;
  return { intent, source, repeat: false, prevented: () => prevented };
}

/*
 * The door had no remote control at all.
 *
 * The view stack owns remote input and the gate renders instead of it, so on
 * the sign-in form arrows did nothing, OK did nothing, and Enter in the
 * password field did nothing — on the appliance, with a remote and no mouse,
 * nobody could sign in. These are the rules the gate now applies itself.
 */
describe('remote control on the gate', () => {
  beforeEach(() => {
    vi.stubGlobal('Element', FakeElement);
    vi.stubGlobal('HTMLInputElement', FakeInput);
    vi.stubGlobal('document', { body, get activeElement() { return active; } });
    vi.stubGlobal('CustomEvent', class { constructor(readonly type: string) {} });
    active = new FakeElement(false);
    vi.mocked(currentFocusKey).mockReturnValue('root/gate-submit');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('confirms a field on Enter, which moves on or signs in', () => {
    const field = new FakeElement(true, { focusId: 'gate-email' });
    const event = press('Enter', 'select', field);
    handleGateIntent(event, vi.fn());
    expect(event.prevented()).toBe(true);
    expect(field.dispatched).toEqual(['tvm:field-confirm']);
    // A field the mouse clicked into becomes the engine's focus too.
    expect(requestFocus).toHaveBeenCalledWith(gateFocusKey('gate-email'));
  });

  it('leaves a field with up and down, but keeps left, right, Space and Backspace for typing', () => {
    const field = new FakeElement(true, { focusId: 'gate-password' });
    const down = press('ArrowDown', 'down', field);
    handleGateIntent(down, vi.fn());
    expect(moveFocus).toHaveBeenCalledWith('down');
    expect(down.prevented()).toBe(true);

    for (const [key, intent] of [['ArrowLeft', 'left'], [' ', 'select'], ['Backspace', 'back']] as const) {
      const typing = press(key, intent, field);
      const onBack = vi.fn();
      handleGateIntent(typing, vi.fn(), onBack);
      expect(typing.prevented()).toBe(false);
      expect(onBack).not.toHaveBeenCalled();
    }
    expect(moveFocus).toHaveBeenCalledTimes(1);
  });

  it('moves between buttons with arrows and presses them with OK', () => {
    const button = new FakeElement(false);
    active = button;
    handleGateIntent(press('ArrowRight', 'right', button), vi.fn());
    expect(moveFocus).toHaveBeenCalledWith('right');
    handleGateIntent(press('Enter', 'select', button), vi.fn());
    expect(activateFocused).toHaveBeenCalledTimes(1);
  });

  it('puts focus somewhere first when nothing has it yet', () => {
    active = body;
    vi.mocked(currentFocusKey).mockReturnValue(null);
    const focusFirst = vi.fn();
    handleGateIntent(press('ArrowDown', 'down', body), focusFirst);
    handleGateIntent(press('Enter', 'select', body), focusFirst);
    expect(focusFirst).toHaveBeenCalledTimes(2);
    expect(moveFocus).not.toHaveBeenCalled();
    expect(activateFocused).not.toHaveBeenCalled();
  });

  it('steps back with Back, and from a field only with Escape', () => {
    const onBack = vi.fn();
    handleGateIntent(press('Backspace', 'back', new FakeElement(false)), vi.fn(), onBack);
    handleGateIntent(press('Escape', 'back', new FakeElement(true)), vi.fn(), onBack);
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});

/*
 * On a phone, keys typed into a field never reach the intent handler, so the
 * form confirms fields itself. Without this the Return key in the email field
 * would submit the form with no password.
 */
describe('Enter inside a gate form', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLInputElement', FakeInput);
    vi.stubGlobal('CustomEvent', class { constructor(readonly type: string) {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function keyEvent(key: string, target: unknown, isComposing = false) {
    const calls: string[] = [];
    return {
      calls,
      event: {
        key,
        target,
        nativeEvent: { isComposing },
        preventDefault: () => calls.push('preventDefault'),
        stopPropagation: () => calls.push('stopPropagation'),
      } as unknown as Parameters<typeof confirmFieldOnEnter>[0],
    };
  }

  it('confirms the field instead of letting the browser submit', () => {
    const input = new FakeInput(true);
    const { event, calls } = keyEvent('Enter', input);
    confirmFieldOnEnter(event);
    expect(calls).toEqual(['preventDefault', 'stopPropagation']);
    expect(input.dispatched).toEqual(['tvm:field-confirm']);
  });

  it('leaves other keys, IME composition and non-fields alone', () => {
    for (const [key, target, composing] of [
      ['a', new FakeInput(true), false],
      ['Enter', new FakeInput(true), true],
      ['Enter', new FakeElement(false), false],
    ] as const) {
      const { event, calls } = keyEvent(key, target, composing);
      confirmFieldOnEnter(event);
      expect(calls).toEqual([]);
      expect(target.dispatched).toEqual([]);
    }
  });
});
