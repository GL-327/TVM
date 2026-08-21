import { useEffect } from 'react';
import { currentFocusKey, focusExists, requestFocus } from '../../nav/focusEngine';
import { useFocusScope } from '../../nav/ViewStackContext';
import { usePlayerSession, type PlayerSession } from '../PlayerRoot';

/**
 * Spatial map for the stream player.
 *
 * PlayerRoot already sets `data-wrap="x"` on the overlay. That host does not
 * contain the legacy chrome (Back, Skip Recap, Pause), so wrapFocus would
 * trap the D-pad inside the overlay — the "cannot select anything" bug.
 * This layer lifts wrap onto `.player` and stamps row groups so every
 * control shares one map. wrapFocus.ts is left alone.
 */

export const PLAYER_FOCUS_GRAPH = {
  default: ['player-play', 'pause'] as const,
  back: ['player-back', 'close', 'player-error-back'] as const,
  recap: ['player-skip-recap', 'skip-recap'] as const,
  top: ['player-back', 'close', 'player-watchlist'] as const,
  progress: ['player-progress', 'seek'] as const,
  volume: ['player-mute', 'mute', 'player-volume', 'volume'] as const,
  transport: [
    'player-seek-back',
    'back-10',
    'player-play',
    'pause',
    'player-seek-fwd',
    'fwd-10',
    'player-skip-recap',
    'skip-recap',
    'player-next',
    'player-next-up',
  ] as const,
  extras: [
    'player-cc',
    'player-audio',
    'player-quality',
    'player-watchlist',
    'retry',
    'player-retry',
    'hours-plans',
    'player-error-plans',
    'player-next-up-dismiss',
    'skip-credits',
    'watch-credits',
  ] as const,
} as const;

export type PlayerFocusRow = keyof typeof PLAYER_FOCUS_GRAPH;

const PLAYER_HOST = '.player, [data-player], [data-player-shell]';
const PLAYER_OVERLAY = '[data-player-root], .player-root';
const STREAM_PAGE = '.stream-page';
const STREAM_CHROME = '.stream-chrome';
const PARK_FLAG = 'tvmFocusPark';

const RECAP_IDS = new Set<string>(PLAYER_FOCUS_GRAPH.recap);
const MENU_WRAP = '[data-player-menu], [role="listbox"], [role="menu"]';

const TRANSPORT_HOSTS = [
  '[data-player-transport]',
  '.player-transport',
  '.player__tools',
  '.player-dock__tools',
] as const;

const ROW_HOSTS: ReadonlyArray<{ selector: string; wrap: 'row' }> = [
  { selector: '.player__top, [data-player-top], .chrome-frame__top, .player-chrome-head', wrap: 'row' },
  { selector: '.player__seek-row, [data-player-progress-row], .tvm-progress', wrap: 'row' },
  { selector: '.player__vol, [data-player-volume], .player-dock__tools', wrap: 'row' },
  { selector: '.player-error .hero__actions, [data-player-overlay="error"] .hero__actions', wrap: 'row' },
];

const videoDisarmed = new WeakSet<HTMLVideoElement>();

export function allPlayerFocusIds(): readonly string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of Object.values(PLAYER_FOCUS_GRAPH)) {
    for (const id of row) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function findPlayerHost(from?: ParentNode | null): HTMLElement | null {
  if (from instanceof Element) {
    const host = from.closest<HTMLElement>(PLAYER_HOST);
    if (host !== null) return host;
  }
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(PLAYER_HOST);
}

function isSelectable(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  if (el.closest('[inert]')) return false;
  if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
  if (el.closest('[hidden], [aria-hidden="true"]')) return false;
  if (el instanceof HTMLButtonElement && el.disabled) return false;
  if (el.closest('.player__chrome--hidden, .player-chrome--hidden, [data-chrome="hidden"]')) return false;
  if (el.closest('.player-transport[data-visible="false"]')) return false;
  return true;
}

function firstControl(root: ParentNode, ids: readonly string[]): HTMLElement | null {
  for (const id of ids) {
    const node = root.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]`);
    if (node !== null && isSelectable(node)) return node;
  }
  return null;
}

function setWrap(el: HTMLElement, kind: 'row' | 'x' | 'y' | 'grid'): void {
  if (el.matches(MENU_WRAP)) return;
  if (el.getAttribute('data-wrap') === kind) return;
  el.setAttribute('data-wrap', kind);
}

function clearOverlayWrap(overlay: HTMLElement): void {
  // PlayerRoot re-applies data-wrap="x" on render. An overlay wrap excludes
  // legacy chrome and is the trap. Lift happens on `.player` instead.
  if (overlay.hasAttribute('data-wrap')) overlay.removeAttribute('data-wrap');
}

function recapInside(host: HTMLElement): boolean {
  for (const id of RECAP_IDS) {
    if (host.querySelector(`[data-focus-id="${CSS.escape(id)}"]`) !== null) return true;
  }
  return false;
}

function recapElsewhere(player: HTMLElement, host: HTMLElement): boolean {
  const recap = firstControl(player, PLAYER_FOCUS_GRAPH.recap);
  return recap !== null && !host.contains(recap);
}

function stampTransportRows(player: HTMLElement): void {
  for (const selector of TRANSPORT_HOSTS) {
    for (const host of player.querySelectorAll<HTMLElement>(selector)) {
      if (host.closest(MENU_WRAP) !== null) continue;
      if (recapElsewhere(player, host) && !recapInside(host)) {
        if (host.hasAttribute('data-wrap')) host.removeAttribute('data-wrap');
        continue;
      }
      setWrap(host, 'row');
    }
  }
}

function stampFixedRows(player: HTMLElement): void {
  for (const { selector, wrap } of ROW_HOSTS) {
    for (const host of player.querySelectorAll<HTMLElement>(selector)) {
      if (host.closest(MENU_WRAP) !== null) continue;
      const count = host.querySelectorAll('[data-focus-id]').length;
      if (count === 0) continue;
      setWrap(host, wrap);
    }
  }
  isolateAxisControls(player);
}

/** Progress / volume keep Left-Right for seek and gain, not wrap hops. */
function isolateAxisControls(player: HTMLElement): void {
  const ids = [...PLAYER_FOCUS_GRAPH.progress, ...PLAYER_FOCUS_GRAPH.volume];
  for (const id of ids) {
    const el = player.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]`);
    const parent = el?.parentElement;
    if (parent === null || parent === undefined) continue;
    if (parent.matches(PLAYER_HOST) || parent.matches(PLAYER_OVERLAY)) continue;
    if (parent.closest(MENU_WRAP) !== null) continue;
    setWrap(parent, 'row');
  }
}

function parkDeadControls(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-focus-id]')) {
    if (el.closest('.rail__track') !== null) continue;
    const live = isSelectable(el);
    if (live) {
      if (el.dataset[PARK_FLAG] === '1') {
        el.removeAttribute('data-loop-clone');
        delete el.dataset[PARK_FLAG];
      }
      continue;
    }
    if (el.getAttribute('data-loop-clone') === 'true' && el.dataset[PARK_FLAG] !== '1') continue;
    el.setAttribute('data-loop-clone', 'true');
    el.dataset[PARK_FLAG] = '1';
  }
}

function disarmVideo(player: HTMLElement, videoRef?: PlayerSession['videoRef']): void {
  const nodes = new Set<HTMLVideoElement>();
  const fromRef = videoRef?.current;
  if (fromRef !== null && fromRef !== undefined) nodes.add(fromRef);
  for (const node of player.querySelectorAll('video')) nodes.add(node);

  for (const video of nodes) {
    video.tabIndex = -1;
    video.setAttribute('data-player-video', '');
    if (videoDisarmed.has(video)) continue;
    videoDisarmed.add(video);
    const bounce = (): void => {
      if (document.activeElement === video) video.blur();
    };
    video.addEventListener('focus', bounce);
    video.addEventListener('play', bounce);
  }
}

function preferredFocusKey(scope: string, player: HTMLElement): string | null {
  const order = [
    ...PLAYER_FOCUS_GRAPH.default,
    ...PLAYER_FOCUS_GRAPH.transport,
    ...PLAYER_FOCUS_GRAPH.back,
    ...PLAYER_FOCUS_GRAPH.progress,
  ];
  const error = player.querySelector('[data-player-overlay="error"]');
  const ids = error !== null ? ['player-retry', 'retry', ...order] : order;
  for (const id of ids) {
    const el = firstControl(player, [id]);
    if (el === null) continue;
    const key = `${scope}/${id}`;
    if (focusExists(key)) return key;
  }
  return null;
}

function focusIsHealthy(player: HTMLElement): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return false;
  if (active instanceof HTMLVideoElement) return false;
  if (!player.contains(active) && active.closest(PLAYER_OVERLAY) === null) return false;
  const control = active.closest<HTMLElement>('[data-focus-id]');
  return control !== null && isSelectable(control);
}

function repairFocus(scope: string, player: HTMLElement, showControls?: () => void): void {
  if (focusIsHealthy(player)) return;
  const key = preferredFocusKey(scope, player);
  if (key === null || key === currentFocusKey()) return;
  requestFocus(key);
  showControls?.();
  window.dispatchEvent(new CustomEvent('tvm:user-activity'));
}

function stampStreamPage(): void {
  const page = document.querySelector<HTMLElement>(STREAM_PAGE);
  if (page === null || page.closest('[inert]') !== null) return;
  const chrome = page.querySelector<HTMLElement>(STREAM_CHROME);
  if (chrome !== null) setWrap(chrome, 'row');
  const hero = page.querySelector<HTMLElement>('.stage__copy');
  if (hero !== null && hero.querySelectorAll('[data-focus-id]').length > 1) {
    setWrap(hero, 'row');
  }
}

/**
 * Stamp wrap hosts and keep the D-pad map live. Safe to call on mutations.
 */
export function applyPlayerFocusMap(from?: ParentNode | null): typeof PLAYER_FOCUS_GRAPH {
  const player = findPlayerHost(from);
  if (player !== null) {
    setWrap(player, 'row');
    player.setAttribute('data-player-focus', 'map');
    for (const overlay of player.querySelectorAll<HTMLElement>(PLAYER_OVERLAY)) {
      clearOverlayWrap(overlay);
    }
    stampTransportRows(player);
    stampFixedRows(player);
    parkDeadControls(player);
    disarmVideo(player);
  }
  stampStreamPage();
  return PLAYER_FOCUS_GRAPH;
}

export function FocusLayer(props: Partial<PlayerSession> = {}): null {
  const session = usePlayerSession();
  const scope = useFocusScope();
  const videoRef = props.videoRef ?? session?.videoRef;
  const showControls = props.showControls ?? session?.showControls;

  useEffect(() => {
    const player = findPlayerHost();
    const roots: HTMLElement[] = [];
    if (player !== null) roots.push(player);
    const stream = document.querySelector<HTMLElement>(STREAM_PAGE);
    if (stream !== null) roots.push(stream);

    const sync = (): void => {
      applyPlayerFocusMap(player);
      if (player !== null) {
        disarmVideo(player, videoRef);
        repairFocus(scope, player, showControls);
      }
    };

    let scheduled = 0;
    const schedule = (): void => {
      if (scheduled !== 0) return;
      scheduled = window.requestAnimationFrame(() => {
        scheduled = 0;
        sync();
      });
    };

    sync();
    const raf = window.requestAnimationFrame(sync);
    const retries = [32, 80, 160, 320].map((ms) => window.setTimeout(sync, ms));

    const observer = new MutationObserver(schedule);
    for (const root of roots) {
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-wrap', 'data-focus-id', 'data-visible', 'disabled', 'hidden', 'class', 'inert'],
      });
    }

    const onFocusIn = (event: FocusEvent): void => {
      if (event.target instanceof HTMLVideoElement) {
        event.target.blur();
        if (player !== null) repairFocus(scope, player, showControls);
      }
    };
    document.addEventListener('focusin', onFocusIn);

    return () => {
      window.cancelAnimationFrame(raf);
      if (scheduled !== 0) window.cancelAnimationFrame(scheduled);
      for (const timer of retries) window.clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [scope, showControls, videoRef]);

  return null;
}

export default FocusLayer;
