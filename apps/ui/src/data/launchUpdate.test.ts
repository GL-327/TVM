import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyGithubUpdateOnLaunch, LAUNCH_APPLY_KEY, shouldReloadAfterApply } from './launchUpdate';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

/*
 * The iPhone reload loop, reproduced.
 *
 * The on-device core compared its bundle with the tip of GitHub main, which
 * is often a commit that produced no new bundle. So every check said
 * "available", every apply fetched the same bundle, and the interface reloaded
 * the moment anyone got past the sign-in — then did it again, forever. This is
 * that core, exactly as it answers, and the interface must stop after one go.
 */
describe('applying an update at launch', () => {
  let reloads = 0;
  let applies = 0;
  let session: MemoryStorage;

  beforeEach(() => {
    reloads = 0;
    applies = 0;
    session = new MemoryStorage();
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('window', {
      location: { reload: () => { reloads += 1; } },
      setTimeout: (callback: () => void) => { callback(); return 0; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubbornCore(apply: Record<string, unknown>): void {
    vi.stubGlobal('fetch', async (input: string) => {
      if (input === '/api/update/check') {
        return Response.json({
          available: { version: '90a7563', notes: 'Run TVM on Linux', changelog: [{ title: 'Run TVM on Linux' }] },
          applyAllowed: true,
        });
      }
      if (input === '/api/update/apply') {
        applies += 1;
        return Response.json(apply);
      }
      return new Response('not found', { status: 404 });
    });
  }

  it('reloads once for an old core that always says an update is waiting', async () => {
    stubbornCore({ version: '913873f', commit: '913873f' });
    await expect(applyGithubUpdateOnLaunch()).resolves.toBe(true);
    // The page reloads into the same session and the same answers.
    await expect(applyGithubUpdateOnLaunch()).resolves.toBe(false);
    await expect(applyGithubUpdateOnLaunch()).resolves.toBe(false);
    expect(applies).toBe(1);
    expect(reloads).toBe(1);
    expect(session.getItem(LAUNCH_APPLY_KEY)).toBe('90a7563');
  });

  it('does not reload when the core says nothing changed', async () => {
    stubbornCore({ version: '913873f', changed: false, restart: 'reload' });
    await expect(applyGithubUpdateOnLaunch()).resolves.toBe(false);
    expect(reloads).toBe(0);
  });

  it('does not apply at all when automatic updates are off', async () => {
    stubbornCore({ version: '913873f', changed: true, restart: 'reload' });
    (globalThis.localStorage as unknown as MemoryStorage).setItem('tvm.autoUpdate', 'off');
    await expect(applyGithubUpdateOnLaunch()).resolves.toBe(false);
    expect(applies).toBe(0);
  });

  it('retries later in the same session if apply fails', async () => {
    let applyStatus = 500;
    vi.stubGlobal('fetch', async (input: string) => {
      if (input === '/api/update/check') {
        return Response.json({
          available: { version: '90a7563', notes: 'Retry me' },
          applyAllowed: true,
        });
      }
      if (input === '/api/update/apply') {
        applies += 1;
        return new Response('no', { status: applyStatus });
      }
      return new Response('not found', { status: 404 });
    });
    await expect(applyGithubUpdateOnLaunch()).resolves.toBe(false);
    expect(session.getItem(LAUNCH_APPLY_KEY)).toBeNull();
    applyStatus = 200;
    vi.stubGlobal('fetch', async (input: string) => {
      if (input === '/api/update/check') {
        return Response.json({
          available: { version: '90a7563', notes: 'Retry me' },
          applyAllowed: true,
        });
      }
      if (input === '/api/update/apply') {
        applies += 1;
        return Response.json({ version: '90a7563', changed: true, restart: 'reload' });
      }
      return new Response('not found', { status: 404 });
    });
    await expect(applyGithubUpdateOnLaunch()).resolves.toBe(true);
    expect(applies).toBe(2);
    expect(reloads).toBe(1);
  });

  it('leaves a manual restart to the person rather than reloading into a stopped core', () => {
    expect(shouldReloadAfterApply({ changed: true, restart: 'manual' }, null)).toBe(false);
    expect(shouldReloadAfterApply({ changed: true, restart: 'self' }, null)).toBe(true);
    expect(shouldReloadAfterApply({ changed: true, restart: 'reload' }, null)).toBe(true);
    expect(shouldReloadAfterApply({ changed: true, restart: 'reload' }, 'abc1234')).toBe(false);
  });
});
