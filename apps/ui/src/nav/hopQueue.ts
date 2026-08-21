/** One D-pad hop per frame. A lagged frame used to apply every queued key at
 * once, so the camera skipped titles (and whole category rows on Up/Down).
 * Default pending is 1 so a key burst / remote double-fire cannot jump ahead. */

export type AxisHop = 'left' | 'right' | 'up' | 'down';

export const AXIS_HOP_MAX_PENDING = 1;

export function createAxisHopQueue(
  hop: (direction: AxisHop) => void,
  maxPending = AXIS_HOP_MAX_PENDING,
): { push: (direction: AxisHop) => void; reset: () => void } {
  let raf = 0;
  let direction: AxisHop | null = null;
  let pending = 0;

  const flush = (): void => {
    raf = 0;
    if (direction === null || pending < 1) {
      pending = 0;
      direction = null;
      return;
    }
    const dir = direction;
    hop(dir);
    pending -= 1;
    if (pending > 0) raf = requestAnimationFrame(flush);
    else direction = null;
  };

  return {
    push(next: AxisHop) {
      if (direction !== null && direction !== next) {
        pending = 0;
      }
      direction = next;
      pending = Math.min(pending + 1, maxPending);
      if (raf === 0) raf = requestAnimationFrame(flush);
    },
    reset() {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      pending = 0;
      direction = null;
    },
  };
}
