import { describe, expect, it } from 'vitest';
import {
  activeEntry,
  canGoBack,
  createViewStack,
  focusToRestore,
  isModalOpen,
  openModals,
  viewStack,
  viewStackReducer,
  visibleScreen,
  type ViewStackAction,
  type ViewStackState,
} from './viewStack';

function run(state: ViewStackState, ...actions: readonly ViewStackAction[]): ViewStackState {
  return actions.reduce(viewStackReducer, state);
}

const home = () => createViewStack('home');
const names = (state: ViewStackState) => state.entries.map((entry) => entry.name);

describe('the root is permanent', () => {
  it('starts at the root', () => {
    const state = home();
    expect(names(state)).toEqual(['home']);
    expect(canGoBack(state)).toBe(false);
  });

  it('refuses to pop the last entry, however hard Back is pressed', () => {
    const state = run(home(), viewStack.pop(), viewStack.pop(), viewStack.pop());
    expect(names(state)).toEqual(['home']);
    expect(activeEntry(state).name).toBe('home');
  });

  it('keeps the root when replace is called at the root', () => {
    const state = run(home(), viewStack.replace('setup'));
    expect(names(state)).toEqual(['setup']);
    expect(state.entries).toHaveLength(1);
  });

  it('never produces an empty stack from any sequence', () => {
    const state = run(
      home(),
      viewStack.push('library'),
      viewStack.pushModal('confirm'),
      viewStack.pop(),
      viewStack.pop(),
      viewStack.pop(),
      viewStack.home(),
      viewStack.pop(),
    );
    expect(state.entries.length).toBeGreaterThanOrEqual(1);
  });
});

describe('navigating screens', () => {
  it('pushes and pops in order', () => {
    let state = run(home(), viewStack.push('library'), viewStack.push('details'));
    expect(names(state)).toEqual(['home', 'library', 'details']);

    state = run(state, viewStack.pop());
    expect(names(state)).toEqual(['home', 'library']);
    expect(canGoBack(state)).toBe(true);
  });

  it('gives every push a distinct key so the same screen can stack', () => {
    const state = run(home(), viewStack.push('details'), viewStack.push('details'));
    const [, first, second] = state.entries;
    expect(first?.key).not.toBe(second?.key);
  });

  it('carries params and freezes them', () => {
    const state = run(home(), viewStack.push('details', { params: { id: 'local:42' } }));
    expect(activeEntry(state).params).toEqual({ id: 'local:42' });
    expect(Object.isFrozen(activeEntry(state).params)).toBe(true);
  });

  it('replace swaps the top without growing the stack', () => {
    const state = run(home(), viewStack.push('library'), viewStack.replace('search'));
    expect(names(state)).toEqual(['home', 'search']);
  });

  it('home wipes back to the root', () => {
    const state = run(
      home(),
      viewStack.push('library'),
      viewStack.push('details'),
      viewStack.pushModal('confirm'),
      viewStack.home(),
    );
    expect(names(state)).toEqual(['home']);
    expect(isModalOpen(state)).toBe(false);
  });

  it('reset replaces everything, for recovery and safe mode', () => {
    const state = run(home(), viewStack.push('library'), viewStack.reset('recovery'));
    expect(names(state)).toEqual(['recovery']);
    expect(canGoBack(state)).toBe(false);
  });
});

describe('modals close before the page they sit on', () => {
  it('Back closes the modal and leaves the screen alone', () => {
    let state = run(home(), viewStack.push('details'), viewStack.pushModal('confirm'));
    expect(isModalOpen(state)).toBe(true);
    expect(visibleScreen(state).name).toBe('details');

    state = run(state, viewStack.pop());
    expect(isModalOpen(state)).toBe(false);
    expect(names(state)).toEqual(['home', 'details']);
  });

  it('unwinds nested modals one at a time', () => {
    let state = run(
      home(),
      viewStack.push('settings'),
      viewStack.pushModal('accounts'),
      viewStack.pushModal('confirmRemove'),
    );
    expect(openModals(state).map((entry) => entry.name)).toEqual(['accounts', 'confirmRemove']);

    state = run(state, viewStack.pop());
    expect(openModals(state).map((entry) => entry.name)).toEqual(['accounts']);

    state = run(state, viewStack.pop());
    expect(openModals(state)).toEqual([]);
    expect(activeEntry(state).name).toBe('settings');
  });

  it('renders the screen beneath an open modal', () => {
    const state = run(home(), viewStack.push('details'), viewStack.pushModal('confirm'));
    expect(visibleScreen(state).name).toBe('details');
    expect(activeEntry(state).name).toBe('confirm');
  });

  it('never strands a modal under a newly pushed screen', () => {
    const state = run(home(), viewStack.pushModal('confirm'), viewStack.push('library'));
    expect(names(state)).toEqual(['home', 'library']);
    expect(isModalOpen(state)).toBe(false);
  });

  it('drops the modal when replacing the screen under it', () => {
    const state = run(home(), viewStack.push('details'), viewStack.pushModal('confirm'), viewStack.replace('search'));
    expect(names(state)).toEqual(['home', 'search']);
  });
});

describe('transient entries', () => {
  it('drops the preview a player was launched from', () => {
    const state = run(
      home(),
      viewStack.push('preview', { transient: true }),
      viewStack.push('player'),
      viewStack.pop(),
    );
    expect(names(state)).toEqual(['home']);
  });

  it('keeps a deliberate screen underneath the player', () => {
    const state = run(home(), viewStack.push('details'), viewStack.push('player'), viewStack.pop());
    expect(names(state)).toEqual(['home', 'details']);
  });

  it('collapses a run of transient entries at once', () => {
    const state = run(
      home(),
      viewStack.push('rail', { transient: true }),
      viewStack.push('preview', { transient: true }),
      viewStack.push('player'),
      viewStack.pop(),
    );
    expect(names(state)).toEqual(['home']);
  });

  it('will not eat the root even if the root is transient', () => {
    const state = run(
      createViewStack('home', { transient: true }),
      viewStack.push('player'),
      viewStack.pop(),
    );
    expect(names(state)).toEqual(['home']);
  });
});

describe('focus memory', () => {
  it('restores focus to where the user left a screen', () => {
    let state = run(home(), viewStack.rememberFocus('rail-continue-3'));
    state = run(state, viewStack.push('details'));

    expect(focusToRestore(state)).toBeNull();

    state = run(state, viewStack.pop());
    expect(focusToRestore(state)).toBe('rail-continue-3');
  });

  it('remembers focus per entry, not globally', () => {
    let state = run(home(), viewStack.rememberFocus('home-hero'));
    state = run(state, viewStack.push('library'), viewStack.rememberFocus('library-item-9'));
    state = run(state, viewStack.push('details'));

    state = run(state, viewStack.pop());
    expect(focusToRestore(state)).toBe('library-item-9');

    state = run(state, viewStack.pop());
    expect(focusToRestore(state)).toBe('home-hero');
  });

  it('restores the screen focus after a modal closes', () => {
    let state = run(home(), viewStack.push('settings'), viewStack.rememberFocus('settings-audio'));
    state = run(state, viewStack.pushModal('confirm'), viewStack.pop());
    expect(focusToRestore(state)).toBe('settings-audio');
  });

  it('survives returning Home', () => {
    let state = run(home(), viewStack.rememberFocus('home-hero'), viewStack.push('library'));
    state = run(state, viewStack.home());
    expect(focusToRestore(state)).toBe('home-hero');
  });
});

describe('the reducer is pure', () => {
  it('does not mutate the state it is given', () => {
    const before = run(home(), viewStack.push('library'));
    const snapshot = JSON.stringify(before);

    run(before, viewStack.push('details'), viewStack.pop(), viewStack.rememberFocus('x'));

    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('returns the same state when Back does nothing', () => {
    const state = home();
    expect(viewStackReducer(state, viewStack.pop())).toBe(state);
  });
});
