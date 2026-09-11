import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('motion preference', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('follows OS changes in Auto and persists an explicit reduced preference', async () => {
    const query = { matches: false, addEventListener: vi.fn() };
    const dataset: Record<string, string> = {};
    const storage = { getItem: () => null, setItem: vi.fn() };
    vi.stubGlobal('window', { matchMedia: () => query });
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('localStorage', storage);
    const motion = await import('./motion');
    motion.applyStoredMotionPreference();
    expect(dataset.motion).toBe('full');
    query.matches = true;
    const change = query.addEventListener.mock.calls[0]?.[1] as () => void;
    change();
    expect(dataset.motion).toBe('reduced');
    motion.applyMotionPreference('reduced');
    query.matches = false;
    change();
    expect(dataset.motion).toBe('reduced');
    expect(storage.setItem).toHaveBeenLastCalledWith('tvm.motion', 'reduced');
    expect(query.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('keeps session preferences when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    const motion = await import('./motion');
    expect(motion.readMotionPreference()).toBe('auto');
    motion.applyMotionPreference('reduced');
    expect(motion.prefersReducedMotion()).toBe(true);
  });
});
