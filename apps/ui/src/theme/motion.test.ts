import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

describe('motion preference', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('keeps Auto and Full animating even when the OS prefers reduced motion', async () => {
    const query = { matches: true, addEventListener: vi.fn() };
    const dataset: Record<string, string> = {};
    const storage = { getItem: () => null, setItem: vi.fn() };
    vi.stubGlobal('window', { matchMedia: () => query });
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('localStorage', storage);
    const motion = await import('./motion');
    motion.applyStoredMotionPreference();
    expect(motion.readMotionPreference()).toBe('auto');
    expect(motion.prefersReducedMotion()).toBe(false);
    expect(dataset.motion).toBe('full');
    expect(dataset.motionPreference).toBe('auto');
    expect(dataset.perf).toBe('off');
    motion.applyMotionPreference('full');
    expect(motion.prefersReducedMotion()).toBe(false);
    expect(dataset.motion).toBe('full');
    expect(dataset.motionPreference).toBe('full');
    expect(dataset.perf).toBe('off');
    motion.applyMotionPreference('reduced');
    expect(motion.prefersReducedMotion()).toBe(true);
    expect(dataset.motion).toBe('reduced');
    expect(dataset.motionPreference).toBe('reduced');
    expect(storage.setItem).toHaveBeenLastCalledWith('tvm.motion', 'reduced');
    motion.applyMotionPreference('auto');
    expect(motion.prefersReducedMotion()).toBe(false);
    expect(dataset.motion).toBe('full');
    expect(dataset.motionPreference).toBe('auto');
    expect(dataset.perf).toBe('off');
  });

  it('keeps session preferences when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    const motion = await import('./motion');
    expect(motion.readMotionPreference()).toBe('auto');
    expect(motion.prefersReducedMotion()).toBe(false);
    motion.applyMotionPreference('reduced');
    expect(motion.prefersReducedMotion()).toBe(true);
  });
});

describe('performance mode', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('implies prefersReducedMotion even when motion is Full and the OS allows it', async () => {
    const dataset: Record<string, string> = {};
    const storage = { getItem: () => null, setItem: vi.fn() };
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: vi.fn() }) });
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('localStorage', storage);
    const motion = await import('./motion');
    motion.applyMotionPreference('full');
    expect(motion.prefersReducedMotion()).toBe(false);
    motion.applyPerformanceMode(true);
    expect(motion.prefersReducedMotion()).toBe(true);
    expect(dataset.motion).toBe('reduced');
    expect(dataset.perf).toBe('on');
    motion.applyPerformanceMode(false);
    expect(motion.prefersReducedMotion()).toBe(false);
    expect(dataset.motion).toBe('full');
    expect(dataset.perf).toBe('off');
  });

  it('is the only Auto kill switch when the OS prefers reduced motion', async () => {
    const dataset: Record<string, string> = {};
    const storage = { getItem: () => null, setItem: vi.fn() };
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener: vi.fn() }) });
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('localStorage', storage);
    const motion = await import('./motion');
    motion.applyMotionPreference('auto');
    expect(motion.prefersReducedMotion()).toBe(false);
    expect(dataset.motion).toBe('full');
    expect(dataset.perf).toBe('off');
    motion.applyPerformanceMode(true);
    expect(motion.prefersReducedMotion()).toBe(true);
    expect(dataset.motion).toBe('reduced');
    expect(dataset.perf).toBe('on');
    motion.applyPerformanceMode(false);
    expect(motion.prefersReducedMotion()).toBe(false);
    expect(dataset.motion).toBe('full');
    expect(dataset.perf).toBe('off');
  });

  it('applyPerformanceMode persists and applyStoredPerformanceMode restores it', async () => {
    const dataset: Record<string, string> = {};
    const store = new Map<string, string>();
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: vi.fn() }) });
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    });
    const motion = await import('./motion');
    expect(motion.applyPerformanceMode(true)).toBe(true);
    expect(store.get('tvm.performance')).toBe('on');
    expect(dataset.perf).toBe('on');
    expect(motion.applyPerformanceMode(false)).toBe(false);
    expect(store.get('tvm.performance')).toBe('off');
    expect(dataset.perf).toBe('off');
    store.set('tvm.performance', 'on');
    vi.resetModules();
    const restored = await import('./motion');
    expect(restored.applyStoredPerformanceMode()).toBe(true);
    expect(restored.prefersReducedMotion()).toBe(true);
    expect(dataset.perf).toBe('on');
    expect(dataset.motion).toBe('reduced');
  });

  it('boots the stored flag before React mounts', () => {
    const main = readFileSync(join(dir, '../main.tsx'), 'utf8');
    expect(main).toContain('applyStoredPerformanceMode()');
  });

  it('keeps reduced-motion and performance CSS kill switches', () => {
    const css = readFileSync(join(dir, 'motion.css'), 'utf8');
    expect(css).toContain(":root[data-motion='reduced']");
    expect(css).toContain(":root[data-perf='on']");
    expect(css).toContain(':root[data-perf=\'on\'] .rt-set');
    expect(css).toContain('.home__scene');
    expect(css).toContain('.stage__vignette');
    expect(css).toContain('.glass-scene');
    expect(css).toContain('.skeleton');
    expect(css).toContain('animation-duration: 0.01ms !important');
    expect(css).toContain('transition-duration: 0.01ms !important');
    expect(css).toContain('--tvm-focus-scale: 1');
    expect(css).toContain('animation-play-state: paused !important');
    expect(css.indexOf(":root[data-motion='reduced'] *")).toBeLessThan(css.indexOf('animation-duration: 0.01ms !important'));
    const app = readFileSync(join(dir, '../app.css'), 'utf8');
    expect(app).toContain('scale(var(--tvm-focus-scale))');
    expect(app).toContain('transition: transform var(--tvm-motion-base) var(--tvm-motion-ease)');
    expect(app).toContain('will-change: transform');
    expect(app).toContain('scale(calc(1.4 / 1.95))');
    expect(css).not.toContain('@media (prefers-reduced-motion');
    const tokens = readFileSync(join(dir, '../../../../packages/design/src/tokens.css'), 'utf8');
    expect(tokens).not.toContain('@media (prefers-reduced-motion');
    const hits: string[] = [];
    const walk = (folder: string): void => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const next = join(folder, entry.name);
        if (entry.isDirectory()) {
          walk(next);
          continue;
        }
        if (entry.name.endsWith('.test.ts')) continue;
        if (/\.(css|tsx|ts)$/.test(entry.name) && readFileSync(next, 'utf8').includes('@media (prefers-reduced-motion')) {
          hits.push(next);
        }
      }
    };
    walk(join(dir, '..'));
    walk(join(dir, '../../../../packages/design/src'));
    expect(hits).toEqual([]);
  });
});
