import { defineConfig } from 'vitest/config';

/**
 * Timeouts, set once rather than passed as a flag.
 *
 * Vitest defaults to five seconds, which is not enough for this suite on
 * anything but a fast, idle machine. Several tests start a real HTTP server,
 * and every test that touches the vault derives a fresh master key — on
 * Windows that means spawning PowerShell for DPAPI. Under parallel load a
 * different handful of tests would time out on each run, which reads as a
 * flaky product rather than a slow one, and it eventually failed CI.
 *
 * Thirty seconds is far longer than any of these tests needs when the machine
 * is free, so a genuine hang still fails rather than hanging the run.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
