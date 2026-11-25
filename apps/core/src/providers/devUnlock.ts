/** Legacy in-process switch for injected fixtures. Production uses the request's admin role. */
export function createDevUnlockService(_options: { dataDir: string }) {
  let enabled = false;
  return {
    unlocked: (): boolean => enabled,
    unlock: (_password: string): boolean => false,
    grant: (): void => { enabled = true; },
    lock: (): void => { enabled = false; },
  };
}
export type DevUnlockService = ReturnType<typeof createDevUnlockService>;
