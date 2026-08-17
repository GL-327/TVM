/**
 * Enough semver to decide whether a GitHub tag is newer than the running app.
 * Pre-release suffixes are ignored: v1.2.3-beta compares as 1.2.3.
 */
export function parseSemver(raw: string): [number, number, number] | null {
  const match = raw.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (match === null) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isInteger)) return null;
  return [major, minor, patch];
}

export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (left === null || right === null) return 0;
  for (let i = 0; i < 3; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

export function isNewer(candidate: string, current: string): boolean {
  return compareSemver(candidate, current) > 0;
}
