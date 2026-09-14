/** Phone / coarse watching layout vs 10-foot cinema chrome. */

export const MOBILE_PLAYER_MAX_WIDTH = '(max-width: 47.99rem)';
export const COARSE_POINTER = '(pointer: coarse)';

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

export function playerOrientation(width: number, height: number): 'portrait' | 'landscape' {
  if (![width, height].every(Number.isFinite)) return 'landscape';
  return height >= width ? 'portrait' : 'landscape';
}

export function readPlayerLayout(win: Window & typeof globalThis = window): {
  mobile: boolean;
  coarse: boolean;
  orientation: 'portrait' | 'landscape';
} {
  const coarse = win.matchMedia(COARSE_POINTER).matches;
  const narrow = win.matchMedia(MOBILE_PLAYER_MAX_WIDTH).matches;
  const phoneShell = win.document.documentElement.classList.contains('phone-shell');
  return {
    coarse,
    mobile: isMobilePlayerViewport({ phoneShell, coarse, narrow }),
    orientation: playerOrientation(win.innerWidth, win.innerHeight),
  };
}

export function playerShellClass(mobile: boolean, orientation: 'portrait' | 'landscape'): string {
  return `player--${mobile ? 'mobile' : 'cinema'} player--${orientation}`;
}
