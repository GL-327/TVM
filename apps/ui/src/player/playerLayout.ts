/** Phone / coarse watching layout vs 10-foot cinema chrome. */

export const MOBILE_PLAYER_MAX_WIDTH = '(max-width: 47.99rem)';
export const COARSE_POINTER = '(pointer: coarse)';

/** Watching picture is always 16:9 contained — never stretched. */
export const PLAYER_ASPECT_W = 16;
export const PLAYER_ASPECT_H = 9;
export const PLAYER_ASPECT_RATIO = PLAYER_ASPECT_W / PLAYER_ASPECT_H;
export const PLAYER_ASPECT_CSS = '16 / 9';
export const PLAYER_OBJECT_FIT = 'contain' as const;
/** Thumb-sized hit target (iOS HIG / WCAG). */
export const PLAYER_HIT_TARGET_PX = 44;

export type PlayerOrientation = 'portrait' | 'landscape';
export type PlayerLayoutMode = 'cinema' | 'mobile-portrait' | 'mobile-landscape';

export interface PlayerLayoutRules {
  aspect: typeof PLAYER_ASPECT_RATIO;
  aspectCss: typeof PLAYER_ASPECT_CSS;
  fit: typeof PLAYER_OBJECT_FIT;
  hitTargetPx: typeof PLAYER_HIT_TARGET_PX;
  portrait: {
    videoAlign: 'center';
    letterbox: true;
    chrome: 'overlay';
  };
  landscape: {
    stage: 'full-bleed';
    letterbox: true;
    stretch: false;
  };
}

/** Canonical watching geometry. CSS classes follow these; never `@media (orientation)`. */
export const PLAYER_LAYOUT_RULES: PlayerLayoutRules = {
  aspect: PLAYER_ASPECT_RATIO,
  aspectCss: PLAYER_ASPECT_CSS,
  fit: PLAYER_OBJECT_FIT,
  hitTargetPx: PLAYER_HIT_TARGET_PX,
  portrait: {
    videoAlign: 'center',
    letterbox: true,
    chrome: 'overlay',
  },
  landscape: {
    stage: 'full-bleed',
    letterbox: true,
    stretch: false,
  },
};

export function isCoarsePointer(media: Pick<MediaQueryList, 'matches'> | null | undefined): boolean {
  return media?.matches === true;
}

export function isMobilePlayerViewport(input: {
  phoneShell?: boolean;
  coarse?: boolean;
  narrow?: boolean;
}): boolean {
  if (input.phoneShell === true) return true;
  return input.coarse === true && input.narrow === true;
}

export function playerOrientation(width: number, height: number): PlayerOrientation {
  if (![width, height].every(Number.isFinite)) return 'landscape';
  return height >= width ? 'portrait' : 'landscape';
}

export function playerLayoutMode(mobile: boolean, orientation: PlayerOrientation): PlayerLayoutMode {
  if (!mobile) return 'cinema';
  return orientation === 'portrait' ? 'mobile-portrait' : 'mobile-landscape';
}

export interface PlayerBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

function finiteSize(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Full-viewport stage. The picture is 16:9 contained and centered (letterbox).
 * Chrome overlays the picture — it is never a leftover band under a top-pinned strip.
 */
export function playerStageBox(
  viewport: { width: number; height: number },
  _mode: PlayerLayoutMode,
  _safeTop = 0,
): PlayerBox {
  return { top: 0, left: 0, width: finiteSize(viewport.width), height: finiteSize(viewport.height) };
}

/** Overlay chrome covers the full viewport in every layout mode. */
export function playerChromeBand(
  viewport: { width: number; height: number },
  mode: PlayerLayoutMode,
  safeTop = 0,
): PlayerBox {
  return playerStageBox(viewport, mode, safeTop);
}

export function readPlayerViewportSize(win: Window & typeof globalThis = window): { width: number; height: number } {
  const host = win.document.querySelector<HTMLElement>('.player, [data-player]');
  if (host !== null && host.clientWidth > 0 && host.clientHeight > 0) {
    return { width: host.clientWidth, height: host.clientHeight };
  }
  const visual = win.visualViewport;
  const width = visual?.width || win.innerWidth;
  const height = visual?.height || win.innerHeight;
  return { width, height };
}

export function readPlayerOrientation(win: Window & typeof globalThis = window): PlayerOrientation {
  const root = win.document.documentElement;
  const marked = root.dataset.orientation;
  if (marked === 'portrait' || marked === 'landscape') return marked;
  if (root.classList.contains('tvm-portrait')) return 'portrait';
  if (root.classList.contains('tvm-landscape')) return 'landscape';
  const size = readPlayerViewportSize(win);
  return playerOrientation(size.width, size.height);
}

export function readPlayerLayout(win: Window & typeof globalThis = window): {
  mobile: boolean;
  coarse: boolean;
  orientation: PlayerOrientation;
  mode: PlayerLayoutMode;
} {
  const coarse = win.matchMedia(COARSE_POINTER).matches;
  const narrow = win.matchMedia(MOBILE_PLAYER_MAX_WIDTH).matches;
  const phoneShell = win.document.documentElement.classList.contains('phone-shell');
  const mobile = isMobilePlayerViewport({ phoneShell, coarse, narrow });
  const orientation = readPlayerOrientation(win);
  return {
    coarse,
    mobile,
    orientation,
    mode: playerLayoutMode(mobile, orientation),
  };
}

export function playerShellClass(mobile: boolean, orientation: PlayerOrientation): string {
  return `player--${mobile ? 'mobile' : 'cinema'} player--${orientation}`;
}
