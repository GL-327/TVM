import { rowCameraTop } from '../nav/revealFocused';

const ROW_SLOP = 8;
const CAMERA_PAD = 16;

/** Closest tile on the next (or previous) visual row, or null at the edge. */
export function pickGridNeighborIndex(
  tops: readonly number[],
  centers: readonly number[],
  index: number,
  direction: 'up' | 'down',
  slop = ROW_SLOP,
): number | null {
  const currentTop = tops[index];
  const currentCenter = centers[index];
  if (currentTop === undefined || currentCenter === undefined) return null;

  let rowTop: number | null = null;
  for (const top of tops) {
    if (direction === 'down' && top > currentTop + slop) {
      if (rowTop === null || top < rowTop) rowTop = top;
    } else if (direction === 'up' && top < currentTop - slop) {
      if (rowTop === null || top > rowTop) rowTop = top;
    }
  }
  if (rowTop === null) return null;

  let best = -1;
  let bestDx = Number.POSITIVE_INFINITY;
  for (let i = 0; i < tops.length; i += 1) {
    if (Math.abs((tops[i] ?? 0) - rowTop) > slop) continue;
    const dx = Math.abs((centers[i] ?? 0) - currentCenter);
    if (dx < bestDx) {
      bestDx = dx;
      best = i;
    }
  }
  return best < 0 ? null : best;
}

/** First row stays at the page top; later rows lock just under the chrome. */
export function appGridCameraY(
  scrollTop: number,
  viewTop: number,
  cardTop: number,
  firstRowTop: number,
  pad = CAMERA_PAD,
): number {
  if (Math.abs(cardTop - firstRowTop) <= ROW_SLOP) return 0;
  return Math.max(0, rowCameraTop(scrollTop, cardTop, viewTop, pad));
}
