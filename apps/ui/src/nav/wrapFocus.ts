export function wrapFocusId(
  direction: string,
  index: number,
  total: number,
  firstId: string,
  lastId: string,
): string | null {
  if (total < 2) return null;
  if (direction === 'right' && index === total - 1) return firstId;
  if (direction === 'left' && index === 0) return lastId;
  return null;
}
