/**
 * Remote input is normalised into intents before it reaches any screen.
 *
 * Screens must never read raw key codes: a TV remote, an HDMI-CEC bridge and a
 * dev keyboard all produce different codes for the same physical button, and
 * only this module is allowed to know about that.
 */

export const INTENTS = [
  'up',
  'down',
  'left',
  'right',
  'select',
  'back',
  'home',
  'playPause',
  'play',
  'pause',
  'stop',
  'rewind',
  'fastForward',
  'next',
  'previous',
  'volumeUp',
  'volumeDown',
  'mute',
  'info',
] as const;

export type Intent = (typeof INTENTS)[number];

export interface IntentEvent {
  intent: Intent;
  /** The originating key event, so a handler can suppress the browser default. */
  source: KeyboardEvent;
  /** True while the button is being held down. */
  repeat: boolean;
}

const DIRECTIONAL: ReadonlySet<Intent> = new Set<Intent>(['up', 'down', 'left', 'right']);

/**
 * KeyboardEvent.key values, in the shape browsers, Electron and USB HID
 * remotes actually emit. Media keys follow the Multimedia Keys spec that
 * cheap remotes and the CEC bridge both target.
 */
const KEY_MAP: Readonly<Record<string, Intent>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',

  Enter: 'select',
  NumpadEnter: 'select',
  ' ': 'select',
  Spacebar: 'select',

  Escape: 'back',
  Backspace: 'back',
  BrowserBack: 'back',
  GoBack: 'back',

  Home: 'home',
  BrowserHome: 'home',
  GoHome: 'home',

  MediaPlayPause: 'playPause',
  MediaPlay: 'play',
  MediaPause: 'pause',
  MediaStop: 'stop',
  MediaRewind: 'rewind',
  MediaFastForward: 'fastForward',
  MediaTrackNext: 'next',
  MediaTrackPrevious: 'previous',

  AudioVolumeUp: 'volumeUp',
  AudioVolumeDown: 'volumeDown',
  AudioVolumeMute: 'mute',

  Info: 'info',
  ContextMenu: 'info',
};

export function isDirectional(intent: Intent): boolean {
  return DIRECTIONAL.has(intent);
}

/**
 * Returns the intent for a key event, or null when the key is not part of the
 * remote vocabulary. Modifier combinations are ignored so browser and shell
 * shortcuts (Ctrl+R, Alt+F4) keep working during development.
 */
export function intentFromKey(event: KeyboardEvent): Intent | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  return KEY_MAP[event.key] ?? null;
}

export interface OnIntentOptions {
  /** Ignore auto-repeat from a held button. Default false. */
  ignoreRepeat?: boolean;
  /** Call preventDefault when an intent matches. Default true. */
  preventDefault?: boolean;
}

/**
 * Subscribes to remote intents on a target. Returns the unsubscribe function.
 */
export function onIntent(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  handler: (event: IntentEvent) => void,
  options: OnIntentOptions = {},
): () => void {
  const { ignoreRepeat = false, preventDefault = true } = options;

  const listener = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    if (ignoreRepeat && event.repeat) return;

    const intent = intentFromKey(event);
    if (intent === null) return;

    if (preventDefault) event.preventDefault();
    handler({ intent, source: event, repeat: event.repeat });
  };

  target.addEventListener('keydown', listener);
  return () => target.removeEventListener('keydown', listener);
}
