import { useEffect, type ReactNode, type RefObject } from 'react';
import {
  DEFAULT_SEEK_STEP_SECONDS,
  DEFAULT_VOLUME_STEP,
  bindPlayerKeyboard,
  readPlayerKeyboardContext,
  type PlayerKeyboardHandlers,
} from './KeyboardMap';

export {
  DEFAULT_SEEK_STEP_SECONDS,
  DEFAULT_VOLUME_STEP,
  PLAYER_KEYBOARD_FOCUS_IDS,
  PLAYER_KEY_MAP,
  applySeekBy,
  bindPlayerKeyboard,
  handlePlayerKeyDown,
  playerActionFromKey,
  playerBindingFromKey,
  readPlayerKeyboardContext,
  shouldYieldToRemote,
  toggleFullscreen,
} from './KeyboardMap';
export type { PlayerKeyBinding, PlayerKeyboardAction, PlayerKeyboardContext, PlayerKeyboardHandlers } from './KeyboardMap';

export interface KeyboardLayerProps extends PlayerKeyboardHandlers {
  children?: ReactNode;
  rootRef?: RefObject<HTMLElement | null>;
  chromeVisible?: boolean;
  skipRecapVisible?: boolean;
  seekStepSeconds?: number;
  volumeStep?: number;
}

/**
 * Desktop keyboard on the player. Mount only on the stream screen.
 *
 * Listens in capture so claimed keys never reach `@tvm/nav` / norigin. Keys
 * the map yields (D-pad on visible chrome, Space on a focused control) pass
 * through unchanged.
 */
export function KeyboardLayer({
  children,
  rootRef,
  chromeVisible,
  skipRecapVisible,
  seekBy,
  playPause,
  fullscreen,
  back,
  skipRecap,
  showChrome,
  volumeBy,
  seekStepSeconds = DEFAULT_SEEK_STEP_SECONDS,
  volumeStep = DEFAULT_VOLUME_STEP,
}: KeyboardLayerProps): React.JSX.Element | null {
  useEffect(() => {
    return bindPlayerKeyboard(
      window,
      { playPause, seekBy, fullscreen, back, skipRecap, showChrome, volumeBy },
      {
        capture: true,
        seekStepSeconds,
        volumeStep,
        getContext: () =>
          readPlayerKeyboardContext(rootRef?.current, {
            chromeVisible,
            skipRecapVisible,
          }),
      },
    );
  }, [
    back,
    chromeVisible,
    fullscreen,
    playPause,
    rootRef,
    seekBy,
    seekStepSeconds,
    showChrome,
    skipRecap,
    skipRecapVisible,
    volumeBy,
    volumeStep,
  ]);

  if (children === undefined) return null;
  return <>{children}</>;
}
