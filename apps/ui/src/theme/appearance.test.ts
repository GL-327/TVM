import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAccent,
  applyFont,
  applyTransparency,
  readAccent,
  readFont,
  readTransparency,
} from './appearance';

describe('appearance preferences (spec 2, 3.1, 3.2)', () => {
  const store = new Map<string, string>();
  const originalStorage = globalThis.localStorage;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });
    const dataset: Record<string, string | undefined> = {};
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        documentElement: {
          dataset,
          style: { setProperty: vi.fn(), removeProperty: vi.fn() },
        },
        body: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  it('defaults to Geist font, default accent, and clear transparency', () => {
    expect(readFont()).toBe('geist');
    expect(readAccent()).toBe('default');
    expect(readTransparency()).toBe(false);
  });

  it('applies and persists font and accent choices', () => {
    applyFont('inter');
    expect(document.documentElement.dataset.font).toBe('inter');
    expect(readFont()).toBe('inter');

    applyAccent('emerald');
    expect(document.documentElement.dataset.accent).toBe('emerald');
    expect(readAccent()).toBe('emerald');

    applyAccent('default');
    expect(document.documentElement.dataset.accent).toBeUndefined();
  });

  it('toggles Reduce Transparency and silently removes legacy tvm.glass preference', () => {
    store.set('tvm.glass', 'tinted');
    applyTransparency(true);
    expect(document.documentElement.dataset.transparency).toBe('reduced');
    expect(readTransparency()).toBe(true);
    expect(store.has('tvm.glass')).toBe(false);

    applyTransparency(false);
    expect(document.documentElement.dataset.transparency).toBe('clear');
    expect(readTransparency()).toBe(false);
  });
});
