import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Retro mosaic gating', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('converts posters only for Retro, and never while Performance mode is on', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
    const motion = await import('./motion');
    const { artStyleFor } = await import('./usePhosphorSrc');
    expect(artStyleFor('synthwave', 'poster')).toBe('mosaic');
    expect(artStyleFor('synthwave', 'backdrop')).toBeNull();
    motion.applyPerformanceMode(true);
    expect(artStyleFor('synthwave', 'poster')).toBeNull();
    expect(artStyleFor('synthwave', 'logo')).toBeNull();
    motion.applyPerformanceMode(false);
    expect(artStyleFor('synthwave', 'poster')).toBe('mosaic');
  });
});
