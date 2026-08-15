/**
 * The view stack: the single source of truth for where the user is.
 *
 * A television has one button that must always work, and it is Back. Every
 * rule here exists to protect two promises:
 *
 *   1. Back never dead-ends. There is always somewhere to go, and the stack
 *      can never empty itself into a blank screen.
 *   2. Focus is never lost. Every entry remembers where focus was, so
 *      returning to a screen puts the highlight back where the user left it.
 *
 * This module is deliberately free of React and of the DOM: the rules are
 * worth testing on their own, without rendering anything.
 */

export type ViewKind = 'screen' | 'modal';

export interface ViewEntry {
  /** Unique per push, so React keys and focus memory survive duplicates. */
  readonly key: string;
  readonly name: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly kind: ViewKind;
  /**
   * Transient entries exist only to support what sits above them, such as the
   * preview a player was launched from. They are dropped when the entry above
   * them pops, so Back does not walk the user backwards through scaffolding.
   */
  readonly transient: boolean;
  /** Focus to restore when this entry becomes the top again. */
  readonly focusKey: string | null;
}

export interface ViewStackState {
  readonly entries: readonly ViewEntry[];
  readonly nextKey: number;
}

export interface PushOptions {
  params?: Record<string, unknown>;
  transient?: boolean;
}

export type ViewStackAction =
  | { readonly type: 'push'; readonly name: string; readonly options?: PushOptions }
  | { readonly type: 'pushModal'; readonly name: string; readonly options?: PushOptions }
  | { readonly type: 'replace'; readonly name: string; readonly options?: PushOptions }
  | { readonly type: 'pop' }
  | { readonly type: 'home' }
  | { readonly type: 'reset'; readonly name: string; readonly options?: PushOptions }
  | { readonly type: 'rememberFocus'; readonly focusKey: string | null };

function makeEntry(
  key: number,
  name: string,
  kind: ViewKind,
  options: PushOptions | undefined,
): ViewEntry {
  return {
    key: `${name}#${key}`,
    name,
    params: Object.freeze({ ...options?.params }),
    kind,
    transient: options?.transient ?? false,
    focusKey: null,
  };
}

export function createViewStack(rootName: string, options?: PushOptions): ViewStackState {
  return { entries: [makeEntry(0, rootName, 'screen', options)], nextKey: 1 };
}

/** The entry the user is interacting with: a modal if one is open, else the screen. */
export function activeEntry(state: ViewStackState): ViewEntry {
  // The root guarantees this is never undefined.
  return state.entries[state.entries.length - 1] as ViewEntry;
}

/** The screen to render underneath any modals. */
export function visibleScreen(state: ViewStackState): ViewEntry {
  for (let i = state.entries.length - 1; i >= 0; i -= 1) {
    const entry = state.entries[i];
    if (entry !== undefined && entry.kind === 'screen') return entry;
  }
  return state.entries[0] as ViewEntry;
}

/** Modals stacked above the visible screen, in the order they were opened. */
export function openModals(state: ViewStackState): readonly ViewEntry[] {
  const screen = visibleScreen(state);
  const index = state.entries.indexOf(screen);
  return state.entries.slice(index + 1);
}

export function isModalOpen(state: ViewStackState): boolean {
  return activeEntry(state).kind === 'modal';
}

/**
 * False only at the root. The UI must still handle Back here: it should offer
 * something (an exit confirmation, or nothing at all) rather than appear dead.
 */
export function canGoBack(state: ViewStackState): boolean {
  return state.entries.length > 1;
}

/** Focus to apply after a transition, or null to use the screen's default. */
export function focusToRestore(state: ViewStackState): string | null {
  return activeEntry(state).focusKey;
}

function withFocus(
  entries: readonly ViewEntry[],
  focusKey: string | null,
): readonly ViewEntry[] {
  if (entries.length === 0) return entries;
  const last = entries[entries.length - 1] as ViewEntry;
  return [...entries.slice(0, -1), { ...last, focusKey }];
}

function dropTrailingModals(entries: readonly ViewEntry[]): readonly ViewEntry[] {
  let end = entries.length;
  while (end > 1 && (entries[end - 1] as ViewEntry).kind === 'modal') end -= 1;
  return entries.slice(0, end);
}

export function viewStackReducer(
  state: ViewStackState,
  action: ViewStackAction,
): ViewStackState {
  switch (action.type) {
    case 'rememberFocus': {
      return { ...state, entries: withFocus(state.entries, action.focusKey) };
    }

    case 'push': {
      // Navigating to a screen ends the modal conversation that was on top of
      // the old one; leaving a modal stranded underneath is never intended.
      const base = dropTrailingModals(state.entries);
      return {
        entries: [...base, makeEntry(state.nextKey, action.name, 'screen', action.options)],
        nextKey: state.nextKey + 1,
      };
    }

    case 'pushModal': {
      return {
        entries: [...state.entries, makeEntry(state.nextKey, action.name, 'modal', action.options)],
        nextKey: state.nextKey + 1,
      };
    }

    case 'replace': {
      const base = dropTrailingModals(state.entries);
      const withoutTop = base.length > 1 ? base.slice(0, -1) : [];
      return {
        entries: [...withoutTop, makeEntry(state.nextKey, action.name, 'screen', action.options)],
        nextKey: state.nextKey + 1,
      };
    }

    case 'pop': {
      // The root is permanent. Back at the root is the UI's problem to answer,
      // not an excuse to empty the stack.
      if (state.entries.length <= 1) return state;

      let entries = state.entries.slice(0, -1);
      // Scaffolding that only existed to support what just closed goes too.
      while (entries.length > 1 && (entries[entries.length - 1] as ViewEntry).transient) {
        entries = entries.slice(0, -1);
      }
      return { ...state, entries };
    }

    case 'home': {
      // Home keeps its remembered focus: returning to the row you were last on
      // is what a television is expected to do.
      return { ...state, entries: state.entries.slice(0, 1) };
    }

    case 'reset': {
      return {
        entries: [makeEntry(state.nextKey, action.name, 'screen', action.options)],
        nextKey: state.nextKey + 1,
      };
    }
  }
}

export const viewStack = {
  push: (name: string, options?: PushOptions): ViewStackAction => ({ type: 'push', name, options }),
  pushModal: (name: string, options?: PushOptions): ViewStackAction => ({ type: 'pushModal', name, options }),
  replace: (name: string, options?: PushOptions): ViewStackAction => ({ type: 'replace', name, options }),
  pop: (): ViewStackAction => ({ type: 'pop' }),
  home: (): ViewStackAction => ({ type: 'home' }),
  reset: (name: string, options?: PushOptions): ViewStackAction => ({ type: 'reset', name, options }),
  rememberFocus: (focusKey: string | null): ViewStackAction => ({ type: 'rememberFocus', focusKey }),
} as const;
