/** Fade the Home hero out as the page camera pans to the rails. */

export function heroScrollFade(scrollTop: number, stageHeight: number): number {
  if (stageHeight <= 0) return 1;
  const span = stageHeight * 0.92;
  return Math.max(0, Math.min(1, 1 - scrollTop / span));
}
