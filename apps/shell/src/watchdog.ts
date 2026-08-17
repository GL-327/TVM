const CRASH_WINDOW_MS = 60_000;
const CRASH_LIMIT = 3;

/**
 * Counts renderer deaths. Three inside a minute is a loop, not a fluke, and
 * the next load must be the recovery screen rather than the same crash again.
 */
export function createCrashWatch(now: () => number = Date.now): {
  noteCrash: () => 'reload' | 'recovery';
} {
  const times: number[] = [];

  return {
    noteCrash(): 'reload' | 'recovery' {
      const at = now();
      times.push(at);
      while (times[0] !== undefined && times[0] < at - CRASH_WINDOW_MS) times.shift();
      return times.length >= CRASH_LIMIT ? 'recovery' : 'reload';
    },
  };
}

export function urlForLoad(origin: string, mode: 'reload' | 'recovery'): string {
  const url = new URL(origin);
  if (mode === 'recovery') url.searchParams.set('recovery', '1');
  else url.searchParams.delete('recovery');
  return url.toString();
}
