/**
 * Desktop keyboard helpers for the player.
 *
 * Norigin / `@tvm/nav` still owns the remote. This map is secondary: it only
 * claims a key when doing so cannot steal D-pad focus, OK/Space-as-select, or
 * Left from an open picker.
 */

export const DEFAULT_SEEK_STEP_SECONDS = 10;
export const DEFAULT_VOLUME_STEP = 0.1;

export type PlayerKeyboardAction =
  | 'playPause'
  | 'seekBack'
  | 'seekForward'
  | 'fullscreen'
  | 'back'
  | 'skipRecap'
  | 'showChrome'
  | 'volumeUp'
  | 'volumeDown';

/** Raw lookup before chrome / focus / menu rules resolve Up/Down. */
export type PlayerKeyBinding =
  | PlayerKeyboardAction
  | 'showChromeOrVolumeUp'
  | 'showChromeOrVolumeDown';

/**
 * Desktop key map.
 *
 * Space / arrows / Esc are also remote keys. `playerActionFromKey` yields those
 * to norigin unless the action is safe. F and S are desktop-only.
 */
export const PLAYER_KEY_MAP: Readonly<Record<string, PlayerKeyBinding>> = {
  ' ': 'playPause',
  Spacebar: 'playPause',
  ArrowLeft: 'seekBack',
  ArrowRight: 'seekForward',
  f: 'fullscreen',
  F: 'fullscreen',
  Escape: 'back',
  s: 'skipRecap',
  S: 'skipRecap',
  ArrowUp: 'showChromeOrVolumeUp',
  ArrowDown: 'showChromeOrVolumeDown',
};

export const PLAYER_KEYBOARD_FOCUS_IDS = {
  skipRecap: ['player-skip-recap', 'skip-recap'],
  back: ['player-back', 'close'],
  volume: ['player-mute', 'mute', 'player-volume', 'volume'],
} as const;

const REPEATABLE_ACTIONS: ReadonlySet<PlayerKeyboardAction> = new Set([
  'seekBack',
  'seekForward',
  'volumeUp',
  'volumeDown',
]);

const PLAYER_HOST_SELECTOR = '.player, [data-player], [data-player-root], [data-player-shell], .player-root';
const CHROME_HOST_SELECTOR = '.player__chrome, [data-player-chrome], .player-chrome';
const CHROME_HIDDEN_SELECTOR = '.player__chrome--hidden, [data-chrome="hidden"], .player-chrome--hidden';
const MENU_SELECTOR = '[data-player-menu], [role="listbox"], [role="menu"]';
const SKIP_RECAP_SELECTOR = '[data-focus-id="player-skip-recap"], [data-focus-id="skip-recap"], [data-player-skip-recap]';

export interface PlayerKeyboardContext {
  root?: ParentNode;
  chromeVisible?: boolean;
  skipRecapVisible?: boolean;
  fullscreenAvailable?: boolean;
  focusedFocusId?: string | null;
  menuOpen?: boolean;
  /** Override. When omitted, volume is safe only if a volume control is focused. */
  volumeSafe?: boolean;
  /** Override. When omitted, skip is safe if chrome is hidden or nothing is focused. The bar scrubs itself. */
  seekSafe?: boolean;
}

export interface PlayerKeyboardHandlers {
  playPause?: () => void;
  seekBy?: (deltaSeconds: number) => void;
  fullscreen?: () => void | Promise<void>;
  back?: () => void;
  skipRecap?: () => void;
  showChrome?: () => void;
  volumeBy?: (delta: number) => void;
}

export function isRepeatablePlayerAction(action: PlayerKeyboardAction): boolean {
  return REPEATABLE_ACTIONS.has(action);
}

export function isVolumeFocusId(id: string | null | undefined): boolean {
  return id !== null && id !== undefined && (PLAYER_KEYBOARD_FOCUS_IDS.volume as readonly string[]).includes(id);
}

export function isSeekFocusId(_id: string | null | undefined): boolean {
  return false;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}

export function fullscreenAvailable(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true;
}

export function playerRootOf(node?: ParentNode | null): ParentNode {
  if (node instanceof Element) {
    const player = node.closest(PLAYER_HOST_SELECTOR);
    if (player !== null) return player;
  }
  if (node !== undefined && node !== null) return node;
  if (typeof document === 'undefined') {
    throw new Error('playerRootOf needs a document');
  }
  return document.querySelector(PLAYER_HOST_SELECTOR) ?? document;
}

export function findPlayerVideo(root: ParentNode = document): HTMLVideoElement | null {
  const scoped = root.querySelector('video.player__video, .player video, video');
  return scoped instanceof HTMLVideoElement ? scoped : null;
}

export function findControlByFocusIds(ids: readonly string[], root: ParentNode = document): HTMLElement | null {
  for (const id of ids) {
    const node = root.querySelector(`[data-focus-id="${CSS.escape(id)}"]`);
    if (node instanceof HTMLElement) return node;
  }
  return null;
}

export function isFocusControlVisible(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
  if (el instanceof HTMLButtonElement && el.disabled) return false;
  if (el.closest(CHROME_HIDDEN_SELECTOR) !== null) return false;
  const rect = el.getClientRects()[0];
  return rect !== undefined && rect.width > 0 && rect.height > 0;
}

export function focusedPlayerFocusId(root: ParentNode = document): string | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && (!(root instanceof Element) || root === active || root.contains(active))) {
    const fromActive = active.closest('[data-focus-id]');
    const id = fromActive?.getAttribute('data-focus-id');
    if (id !== null && id !== undefined && id !== '') return id;
  }
  const marked = root.querySelector('[data-focused="true"][data-focus-id]');
  return marked?.getAttribute('data-focus-id') ?? null;
}

export function isPlayerChromeVisible(root: ParentNode = document): boolean {
  const chrome = root.querySelector(CHROME_HOST_SELECTOR);
  if (chrome === null) return true;
  return !chrome.matches(CHROME_HIDDEN_SELECTOR) && chrome.closest(CHROME_HIDDEN_SELECTOR) === null;
}

export function findSkipRecapControl(root: ParentNode = document): HTMLElement | null {
  const node = root.querySelector(SKIP_RECAP_SELECTOR);
  return node instanceof HTMLElement ? node : null;
}

export function isSkipRecapVisible(root: ParentNode = document): boolean {
  return isFocusControlVisible(findSkipRecapControl(root));
}

export function isPlayerMenuOpen(root: ParentNode = document): boolean {
  return root.querySelector(MENU_SELECTOR) !== null;
}

export function isSeekSafe(context: PlayerKeyboardContext): boolean {
  if (context.menuOpen === true) return false;
  if (context.seekSafe !== undefined) return context.seekSafe;
  if (context.chromeVisible === false) return true;
  const id = context.focusedFocusId;
  if (id === null || id === undefined || id === '') return true;
  return isSeekFocusId(id);
}

export function isVolumeSafe(context: PlayerKeyboardContext): boolean {
  if (context.menuOpen === true) return false;
  if (context.volumeSafe !== undefined) return context.volumeSafe;
  return isVolumeFocusId(context.focusedFocusId);
}

/**
 * True when the remote / norigin must keep the key (D-pad, OK/Space-as-select).
 */
export function shouldYieldToRemote(binding: PlayerKeyBinding, context: PlayerKeyboardContext): boolean {
  if (binding === 'playPause') {
    return context.chromeVisible !== false && Boolean(context.focusedFocusId);
  }
  if (binding === 'seekBack' || binding === 'seekForward') {
    return !isSeekSafe(context);
  }
  if (binding === 'showChromeOrVolumeUp' || binding === 'showChromeOrVolumeDown') {
    if (context.chromeVisible === false) return false;
    return !isVolumeSafe(context);
  }
  return false;
}

export function readPlayerKeyboardContext(
  root?: ParentNode | null,
  overrides: PlayerKeyboardContext = {},
): PlayerKeyboardContext {
  const scope = playerRootOf(root ?? overrides.root);
  return {
    root: scope,
    chromeVisible: overrides.chromeVisible ?? isPlayerChromeVisible(scope),
    skipRecapVisible: overrides.skipRecapVisible ?? isSkipRecapVisible(scope),
    fullscreenAvailable: overrides.fullscreenAvailable ?? fullscreenAvailable(),
    focusedFocusId: overrides.focusedFocusId ?? focusedPlayerFocusId(scope),
    menuOpen: overrides.menuOpen ?? isPlayerMenuOpen(scope),
    volumeSafe: overrides.volumeSafe,
    seekSafe: overrides.seekSafe,
  };
}

export function playerBindingFromKey(event: KeyboardEvent): PlayerKeyBinding | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (isEditableTarget(event.target)) return null;
  return PLAYER_KEY_MAP[event.key] ?? null;
}

export function playerActionFromKey(
  event: KeyboardEvent,
  context: PlayerKeyboardContext = {},
): PlayerKeyboardAction | null {
  const binding = playerBindingFromKey(event);
  if (binding === null) return null;
  if (shouldYieldToRemote(binding, context)) return null;

  let action: PlayerKeyboardAction;
  if (binding === 'showChromeOrVolumeUp') {
    action = isVolumeSafe(context) ? 'volumeUp' : 'showChrome';
  } else if (binding === 'showChromeOrVolumeDown') {
    action = isVolumeSafe(context) ? 'volumeDown' : 'showChrome';
  } else {
    action = binding;
  }

  if (event.repeat && !isRepeatablePlayerAction(action)) return null;
  if (action === 'skipRecap' && context.skipRecapVisible === false) return null;
  if (action === 'fullscreen' && context.fullscreenAvailable === false) return null;
  return action;
}

export function dispatchPlayerMediaIntent(intent: string): void {
  window.dispatchEvent(new CustomEvent('tvm:media-intent', { detail: intent }));
}

export function dispatchPlayerActivity(): void {
  window.dispatchEvent(new CustomEvent('tvm:user-activity'));
}

export function clickFocusId(id: string, root: ParentNode = document): boolean {
  const el = findControlByFocusIds([id], root);
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLButtonElement && el.disabled) return false;
  el.click();
  return true;
}

export function activateFocusId(id: string, root: ParentNode = document): boolean {
  const el = findControlByFocusIds([id], root);
  if (el === null || !isFocusControlVisible(el)) return false;
  el.click();
  return true;
}

export function activateFirstVisibleFocusId(ids: readonly string[], root: ParentNode = document): boolean {
  for (const id of ids) {
    if (activateFocusId(id, root)) return true;
  }
  return false;
}

export function clickFirstFocusId(ids: readonly string[], root: ParentNode = document): boolean {
  for (const id of ids) {
    if (clickFocusId(id, root)) return true;
  }
  return false;
}

export function toggleHtml5Playback(root: ParentNode = document): boolean {
  const video = findPlayerVideo(root);
  if (video === null || video.currentSrc === '') return false;
  if (video.paused) void video.play();
  else video.pause();
  return true;
}

export function applySeekBy(deltaSeconds: number, root: ParentNode = document): void {
  const video = findPlayerVideo(root);
  if (video !== null && video.currentSrc !== '') {
    const duration = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + deltaSeconds));
    dispatchPlayerActivity();
    return;
  }
  dispatchPlayerMediaIntent(deltaSeconds < 0 ? 'rewind' : 'fastForward');
}

export function applyVolumeBy(delta: number, root: ParentNode = document): boolean {
  const video = findPlayerVideo(root);
  if (video === null) return false;
  video.volume = Math.max(0, Math.min(1, video.volume + delta));
  video.muted = false;
  dispatchPlayerActivity();
  return true;
}

export async function toggleFullscreen(target?: Element | null): Promise<boolean> {
  if (!fullscreenAvailable()) return false;
  try {
    if (document.fullscreenElement !== null) {
      await document.exitFullscreen();
      return true;
    }
    const el = target ?? (document.querySelector(PLAYER_HOST_SELECTOR) as Element | null) ?? document.documentElement;
    if (typeof el.requestFullscreen !== 'function') return false;
    await el.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

export function performPlayerKeyboardAction(
  action: PlayerKeyboardAction,
  handlers: PlayerKeyboardHandlers = {},
  context: PlayerKeyboardContext = {},
  options: { seekStepSeconds?: number; volumeStep?: number } = {},
): void {
  const root = playerRootOf(context.root);
  const seekStep = options.seekStepSeconds ?? DEFAULT_SEEK_STEP_SECONDS;
  const volumeStep = options.volumeStep ?? DEFAULT_VOLUME_STEP;

  if (action === 'playPause') {
    if (handlers.playPause !== undefined) handlers.playPause();
    else if (!toggleHtml5Playback(root)) dispatchPlayerMediaIntent('playPause');
    dispatchPlayerActivity();
    return;
  }
  if (action === 'seekBack' || action === 'seekForward') {
    const delta = action === 'seekBack' ? -seekStep : seekStep;
    if (handlers.seekBy !== undefined) handlers.seekBy(delta);
    else applySeekBy(delta, root);
    return;
  }
  if (action === 'fullscreen') {
    if (handlers.fullscreen !== undefined) void handlers.fullscreen();
    else {
      const host = root instanceof Element ? root : document.querySelector(PLAYER_HOST_SELECTOR);
      void toggleFullscreen(host);
    }
    return;
  }
  if (action === 'back') {
    if (handlers.back !== undefined) handlers.back();
    else clickFirstFocusId(PLAYER_KEYBOARD_FOCUS_IDS.back, root);
    return;
  }
  if (action === 'skipRecap') {
    if (handlers.skipRecap !== undefined) handlers.skipRecap();
    else {
      const skip = findSkipRecapControl(root);
      if (skip !== null && isFocusControlVisible(skip)) skip.click();
    }
    return;
  }
  if (action === 'showChrome') {
    if (handlers.showChrome !== undefined) handlers.showChrome();
    else dispatchPlayerActivity();
    return;
  }
  if (action === 'volumeUp' || action === 'volumeDown') {
    const delta = action === 'volumeUp' ? volumeStep : -volumeStep;
    if (handlers.volumeBy !== undefined) handlers.volumeBy(delta);
    else if (!applyVolumeBy(delta, root)) {
      dispatchPlayerMediaIntent(action === 'volumeUp' ? 'volumeUp' : 'volumeDown');
    }
  }
}

/** Claims the event (preventDefault + stopImmediatePropagation) when handled. */
export function handlePlayerKeyDown(
  event: KeyboardEvent,
  handlers: PlayerKeyboardHandlers = {},
  context: PlayerKeyboardContext = {},
  options: { seekStepSeconds?: number; volumeStep?: number } = {},
): boolean {
  const action = playerActionFromKey(event, context);
  if (action === null) return false;
  if (action === 'back' && handlers.back === undefined && !hasBackControl(context)) {
    return false;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  performPlayerKeyboardAction(action, handlers, context, options);
  return true;
}

function hasBackControl(context: PlayerKeyboardContext): boolean {
  const el = findControlByFocusIds(PLAYER_KEYBOARD_FOCUS_IDS.back, playerRootOf(context.root));
  return el instanceof HTMLElement && !(el instanceof HTMLButtonElement && el.disabled);
}

export function bindPlayerKeyboard(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  handlers: PlayerKeyboardHandlers = {},
  options: {
    getContext?: () => PlayerKeyboardContext;
    seekStepSeconds?: number;
    volumeStep?: number;
    capture?: boolean;
  } = {},
): () => void {
  const capture = options.capture !== false;
  const listener = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    const context = options.getContext?.() ?? readPlayerKeyboardContext();
    handlePlayerKeyDown(event, handlers, context, {
      seekStepSeconds: options.seekStepSeconds,
      volumeStep: options.volumeStep,
    });
  };
  target.addEventListener('keydown', listener, capture);
  return () => target.removeEventListener('keydown', listener, capture);
}
