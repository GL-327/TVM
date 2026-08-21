import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import {
  activeEntry,
  createViewStack,
  onIntent,
  openModals,
  viewStack,
  viewStackReducer,
  visibleScreen,
} from '@tvm/nav';
import type { PushOptions, ViewEntry, ViewStackAction } from '@tvm/nav';
import {
  activateFocused,
  currentFocusKey,
  focusExists,
  moveFocus,
  requestFocus,
  startFocusEngine,
} from './focusEngine';
import { createAxisHopQueue } from './hopQueue';
import { isWrappingTrack, settleWrappingTrack, wrapLoopingTrack } from './loopingRail';
import { focusKeyFor, isVerticalNavContext, neighborFocusTarget, ribbonFocusTarget } from './railNav';
import { conveyorHop, wrapHop } from './wrapFocus';
import { FocusScopeProvider, ViewStackContextProvider } from './ViewStackContext';
import type { Navigate } from './ViewStackContext';
import { screenDefinition } from './registry';
import { setActiveProfileId } from '../data/media';
import { LoadingScreen } from '../components/LoadingScreen';
import { introPlayedThisSession, shouldSkipIntro, TvmIntro } from '../brand/TvmIntro';
import { installEasterEggs } from '../brand/easterEggs';

startFocusEngine();

async function resolveRoot(): Promise<string> {
  if (new URLSearchParams(window.location.search).get('recovery') === '1') return 'recovery';
  try {
    const response = await fetch('/api/profiles', { signal: AbortSignal.timeout(2500) });
    if (response.ok) {
      const body = (await response.json()) as { activeId?: string };
      if (typeof body.activeId === 'string' && body.activeId !== '') setActiveProfileId(body.activeId);
    }
  } catch {
    // Home still opens if core is down. TVM Stream asks for a token later.
  }
  return 'home';
}

function isEditable(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function runHorizontalHop(active: HTMLElement, intent: 'left' | 'right'): void {
  const wrapping = active.closest<HTMLElement>('.rail__track');
  if (wrapping !== null && isWrappingTrack(wrapping)) settleWrappingTrack(wrapping);

  const conveyor = conveyorHop(active, intent);
  if (conveyor !== null) {
    const key = focusKeyFor(conveyor.next);
    if (key !== null) {
      wrapLoopingTrack(conveyor.track, intent, () => requestFocus(key));
      return;
    }
  }
  const hop = wrapHop(active, intent);
  if (hop.next !== null) {
    const key = focusKeyFor(hop.next);
    if (key !== null) {
      requestFocus(key);
      return;
    }
  }
  if (hop.consume) return;
  moveFocus(intent);
}

function runVerticalHop(active: HTMLElement, intent: 'up' | 'down'): void {
  const hop = wrapHop(active, intent);
  if (hop.next !== null) {
    const key = focusKeyFor(hop.next);
    if (key !== null) {
      requestFocus(key);
      return;
    }
  }
  if (hop.consume) return;

  const next = neighborFocusTarget(active, intent);
  if (next !== null) {
    requestFocus(next);
    return;
  }
  if (intent === 'up') {
    const ribbon = ribbonFocusTarget(active);
    if (ribbon !== null) {
      requestFocus(ribbon);
      return;
    }
  }
  if (isVerticalNavContext(active)) return;
  moveFocus(intent);
}

/**
 * Holds the view stack, turns remote intents into stack actions, and keeps
 * something focused at all times.
 *
 * The reducer in `@tvm/nav` owns the navigation rules. This component owns
 * only the bridge to React and to the focus engine, and it is the sole place
 * subscribed to remote input.
 */
export function ViewStackProvider(): React.JSX.Element {
  const [root, setRoot] = useState<string | null>(null);
  const [introDone, setIntroDone] = useState(() => shouldSkipIntro() || introPlayedThisSession());

  useEffect(() => {
    void resolveRoot().then(setRoot);
  }, []);

  useEffect(() => installEasterEggs(), []);

  useEffect(() => {
    if (root === 'recovery') return;
    void fetch('/api/update/check', { method: 'POST' });
  }, [root]);

  if (root === 'recovery') {
    return <ViewStack root={root} />;
  }

  if (!introDone) {
    return (
      <div className="app" data-screen="boot">
        <TvmIntro variant="tvm" pending={root === null} onDone={() => setIntroDone(true)} />
      </div>
    );
  }

  if (root === null) {
    return (
      <div className="app" data-screen="boot">
        <LoadingScreen
          variant="tvm"
          holdIfRecent
          eyebrow="TVM"
          title="Starting…"
          body="Loading your home screen. The remote is ready as soon as Home appears."
        />
      </div>
    );
  }

  return <ViewStack root={root} />;
}

function ViewStack({ root }: { root: string }): React.JSX.Element {
  const [state, dispatch] = useReducer(viewStackReducer, root, createViewStack);

  // Leaving a screen records where focus was, so returning restores it. Doing
  // this inside navigate means no screen has to remember to do it.
  const rememberThenDispatch = useCallback((action: ViewStackAction) => {
    dispatch(viewStack.rememberFocus(currentFocusKey()));
    dispatch(action);
  }, []);

  const navigate = useMemo<Navigate>(
    () => ({
      push: (name: string, options?: PushOptions) => rememberThenDispatch(viewStack.push(name, options)),
      pushModal: (name: string, options?: PushOptions) =>
        rememberThenDispatch(viewStack.pushModal(name, options)),
      replace: (name: string, options?: PushOptions) =>
        rememberThenDispatch(viewStack.replace(name, options)),
      pop: () => dispatch(viewStack.pop()),
      home: () => dispatch(viewStack.home()),
      reset: (name: string, options?: PushOptions) => dispatch(viewStack.reset(name, options)),
    }),
    [rememberThenDispatch],
  );

  const active = activeEntry(state);
  const activeKeyRef = useRef(active.key);
  activeKeyRef.current = active.key;

  useEffect(() => {
    const dpad = createAxisHopQueue((direction) => {
      const node = document.activeElement;
      if (!(node instanceof HTMLElement)) {
        moveFocus(direction);
        return;
      }
      if (direction === 'left' || direction === 'right') runHorizontalHop(node, direction);
      else runVerticalHop(node, direction);
    });
    const stop = onIntent(
      window,
      ({ intent, source }) => {
        window.dispatchEvent(new CustomEvent('tvm:user-activity'));
        if (
          intent === 'playPause' ||
          intent === 'play' ||
          intent === 'pause' ||
          intent === 'stop' ||
          intent === 'rewind' ||
          intent === 'fastForward' ||
          intent === 'next' ||
          intent === 'previous' ||
          intent === 'volumeUp' ||
          intent === 'volumeDown' ||
          intent === 'mute' ||
          intent === 'info'
        ) {
          source.preventDefault();
          window.dispatchEvent(new CustomEvent('tvm:media-intent', { detail: intent }));
          return;
        }

        // A focused text field owns typing, Space, and Backspace. OK/Enter
        // confirms so a remote can continue after a paste. The D-pad leaves
        // the field so Continue stays reachable.
        if (isEditable(source.target)) {
          if (intent === 'select' && (source.key === 'Enter' || source.key === 'NumpadEnter')) {
            source.preventDefault();
            source.target.dispatchEvent(new CustomEvent('tvm:field-confirm', { bubbles: true }));
            return;
          }
          if (intent === 'select') {
            return;
          }
          if (intent === 'up' || intent === 'down' || intent === 'left' || intent === 'right') {
            source.preventDefault();
            moveFocus(intent);
            return;
          }
          if (intent === 'back' && source.key === 'Escape') {
            source.preventDefault();
            dispatch(viewStack.pop());
          }
          if (intent === 'home') {
            source.preventDefault();
            dispatch(viewStack.home());
          }
          return;
        }

        source.preventDefault();
        if (intent === 'left' || intent === 'right' || intent === 'up' || intent === 'down') {
          dpad.push(intent);
          return;
        }
        if (intent === 'select') {
          activateFocused();
          return;
        }
        if (intent === 'back') dispatch(viewStack.pop());
        if (intent === 'home') dispatch(viewStack.home());
      },
      { preventDefault: false },
    );
    return () => {
      dpad.reset();
      stop();
    };
  }, []);

  // Focus follows the top of the stack: the key remembered on the way out if
  // it still exists, otherwise the entry itself, which resolves to the
  // screen's first or last-focused child. Poster rails mount after chrome, so
  // a remembered card may not be registered on the first paint.
  const appliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (appliedRef.current === active.key) return;
    appliedRef.current = active.key;

    const remembered = active.focusKey;
    const apply = (): boolean => {
      if (remembered !== null && focusExists(remembered)) {
        requestFocus(remembered);
        return true;
      }
      requestFocus(active.key);
      return remembered === null;
    };

    if (apply()) return undefined;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (apply() || attempts > 12) window.clearInterval(timer);
    }, 16);
    return () => window.clearInterval(timer);
  }, [active.key, active.focusKey]);

  // The safety net behind "focus can never be lost". An element that unmounts
  // while focused leaves the document focused on nothing, and on a television
  // that is a dead remote.
  useEffect(() => {
    const repair = (): void => {
      const parked = document.activeElement;
      if (parked !== null && parked !== document.body) return;
      requestFocus(activeKeyRef.current);
    };

    const onFocusOut = (): void => {
      // Let the browser settle on the next element before judging it lost.
      window.setTimeout(repair, 0);
    };

    document.addEventListener('focusout', onFocusOut);
    return () => document.removeEventListener('focusout', onFocusOut);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const node = event.target;
      if (!(node instanceof Element)) return;
      const host = node.closest<HTMLElement>('[data-focus-id]');
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
        document.documentElement.classList.add('desktop-shell');
      }
      if (host === null) return;
      const key = focusKeyFor(host);
      if (key !== null) requestFocus(key);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const screen = visibleScreen(state);
  const modals = openModals(state);
  const modalOpen = modals.length > 0;

  const contextValue = useMemo(() => ({ state, navigate }), [state, navigate]);

  return (
    <ViewStackContextProvider value={contextValue}>
      <div className="app">
        {/* inert keeps the screen beneath a modal out of reach of the pointer,
            the tab order and assistive technology; isFocusBoundary on the
            modal keeps the D-pad out. */}
        <div className="app__screen" inert={modalOpen}>
          <EntryHost key={screen.key} entry={screen} isModal={false} />
        </div>

        {modals.map((modal) => (
          <EntryHost key={modal.key} entry={modal} isModal />
        ))}
      </div>
    </ViewStackContextProvider>
  );
}

interface EntryHostProps {
  entry: ViewEntry;
  isModal: boolean;
}

function EntryHost({ entry, isModal }: EntryHostProps): React.JSX.Element {
  const definition = screenDefinition(entry.name);
  const focusId =
    typeof definition.defaultFocus === 'function' ? definition.defaultFocus(entry.params) : definition.defaultFocus;
  const preferredChildFocusKey = focusId === undefined ? undefined : `${entry.key}/${focusId}`;

  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: entry.key,
    focusable: false,
    saveLastFocusedChild: true,
    trackChildren: true,
    autoRestoreFocus: true,
    isFocusBoundary: isModal,
    preferredChildFocusKey,
  });

  const Screen = definition.component;

  return (
    <FocusContext.Provider value={focusKey}>
      <FocusScopeProvider value={entry.key}>
        <div
          ref={ref}
          className={isModal ? 'modal-layer' : 'screen-layer'}
          data-screen={entry.name}
          data-focus-scope={entry.key}
        >
          <Screen params={entry.params} />
        </div>
      </FocusScopeProvider>
    </FocusContext.Provider>
  );
}
