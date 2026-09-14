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
    videoAlign: 'top';
    letterbox: true;
    chrome: 'remaining-band-or-overlay';
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
    videoAlign: 'top',
    letterbox: true,
    chrome: 'remaining-band-or-overlay',
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
 * 16:9 stage box. Portrait phones pin it to the top (letterbox inside).
 * Landscape mobile and cinema fill the viewport; the picture uses contain.
 */
export function playerStageBox(
  viewport: { width: number; height: number },
  mode: PlayerLayoutMode,
  safeTop = 0,
): PlayerBox {
  const width = finiteSize(viewport.width);
  const height = finiteSize(viewport.height);
  const insetTop = Number.isFinite(safeTop) && safeTop > 0 ? safeTop : 0;
  if (mode === 'mobile-portrait') {
    const available = Math.max(0, height - insetTop);
    const stageHeight = Math.min(width / PLAYER_ASPECT_RATIO, available);
    return { top: insetTop, left: 0, width, height: stageHeight };
  }
  return { top: 0, left: 0, width, height };
}

/** Remaining band under a portrait 16:9 stage; full overlay in landscape/cinema. */
export function playerChromeBand(
  viewport: { width: number; height: number },
  mode: PlayerLayoutMode,
  safeTop = 0,
): PlayerBox {
  if (mode !== 'mobile-portrait') {
    return { top: 0, left: 0, width: finiteSize(viewport.width), height: finiteSize(viewport.height) };
  }
  const stage = playerStageBox(viewport, mode, safeTop);
  const top = stage.top + stage.height;
  return {
    top,
    left: 0,
    width: finiteSize(viewport.width),
    height: Math.max(0, finiteSize(viewport.height) - top),
  };
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
