import { describe, expect, it } from 'vitest';
import {
  armBitmap,
  bitmapOverscanX,
  cardInCamera,
  nearScroller,
  shouldArmBitmap,
  wakeBitmaps,
  watchRailBitmaps,
} from './railBitmaps';

function mockImg(left: number, right: number, extra?: Record<string, unknown>) {
  return {
    loading: 'lazy',
    fetchPriority: 'auto',
    dataset: {} as Record<string, string>,
    complete: false,
    closest: (selector: string) =>
      selector.includes('loop-clone') ? null : { getBoundingClientRect: () => ({ left, right }) },
    getBoundingClientRect: () => ({ left, right }),
    getAttribute: () => 'https://img/p.jpg',
    src: 'https://img/p.jpg',
    currentSrc: '',
    ...extra,
  };
}

describe('railBitmaps', () => {
  it('wakes lazy images once without restarting a finished bitmap', () => {
    const img = {
      loading: 'lazy',
      fetchPriority: 'auto',
      dataset: {} as Record<string, string>,
      complete: false,
      closest: () => null,
      getAttribute: () => 'https://img/p.jpg',
      src: 'https://img/p.jpg',
    };
    const root = {
      querySelectorAll: () => [img],
    } as unknown as HTMLElement;

    wakeBitmaps(root);
    expect(img.loading).toBe('eager');
    expect(img.fetchPriority).toBe('high');
    expect(img.dataset.bitmapWoke).toBe('true');
    expect(img.src).toBe('https://img/p.jpg');

    img.complete = true;
    img.loading = 'lazy';
    wakeBitmaps(root);
    expect(img.loading).toBe('lazy');
  });

  it('keeps clone fetches at low priority', () => {
    const img = {
      loading: 'lazy',
      fetchPriority: 'auto',
      dataset: {} as Record<string, string>,
      complete: true,
      closest: (selector: string) => (selector.includes('loop-clone') ? {} : null),
      getAttribute: () => 'https://img/p.jpg',
      src: 'https://img/p.jpg',
    };
    wakeBitmaps({ querySelectorAll: () => [img] } as unknown as HTMLElement);
    expect(img.fetchPriority).toBe('auto');
    expect(img.loading).toBe('eager');
  });

  it('does not reassign src when the bitmap is already in flight', () => {
    const img = mockImg(0, 120, { src: 'https://img/p.jpg', currentSrc: 'https://img/p.jpg' });
    let assigned = 0;
    Object.defineProperty(img, 'src', {
      get: () => 'https://img/p.jpg',
      set: () => {
        assigned += 1;
      },
    });
    armBitmap(img as unknown as HTMLImageElement);
    expect(assigned).toBe(0);
    expect(img.dataset.bitmapWoke).toBe('true');
  });

  it('reassigns src when native lazy never started', () => {
    const img = mockImg(0, 120, { src: 'https://img/p.jpg', currentSrc: '' });
    let assigned = 0;
    Object.defineProperty(img, 'src', {
      get: () => 'https://img/p.jpg',
      set: () => {
        assigned += 1;
      },
    });
    armBitmap(img as unknown as HTMLImageElement);
    expect(assigned).toBe(1);
    expect(img.loading).toBe('eager');
  });

  it('treats a rail on screen as near the camera', () => {
    const el = {
      closest: () => ({ getBoundingClientRect: () => ({ top: 0, bottom: 720 }) }),
      getBoundingClientRect: () => ({ top: 80, bottom: 240 }),
    } as unknown as HTMLElement;
    expect(nearScroller(el)).toBe(true);
  });

  it('keeps a generous horizontal overscan so neighbors decode before they enter', () => {
    expect(bitmapOverscanX(0)).toBe(640);
    expect(bitmapOverscanX(800)).toBe(640);
    expect(bitmapOverscanX(1920)).toBe(1152);
    expect(cardInCamera({ getBoundingClientRect: () => ({ left: 0, right: 140 }) }, { getBoundingClientRect: () => ({ left: 0, right: 800 }) }, 640)).toBe(
      true,
    );
    expect(
      cardInCamera({ getBoundingClientRect: () => ({ left: 8000, right: 8140 }) }, { getBoundingClientRect: () => ({ left: 0, right: 800 }) }, 640),
    ).toBe(false);
  });

  it('eager-wakes on-camera posters and leaves far conveyor copies lazy', () => {
    const near = mockImg(0, 140);
    const far = mockImg(8000, 8140);
    const track = {
      clientWidth: 800,
      getBoundingClientRect: () => ({ left: 0, right: 800 }),
    };
    const root = {
      querySelector: (selector: string) => (selector.includes('rail__track') ? track : null),
      querySelectorAll: () => [near, far],
    } as unknown as HTMLElement;

    wakeBitmaps(root);
    expect(near.dataset.bitmapWoke).toBe('true');
    expect(near.loading).toBe('eager');
    expect(far.dataset.bitmapWoke).toBeUndefined();
    expect(far.loading).toBe('lazy');
    expect(far.src).toBe('https://img/p.jpg');
  });

  it('reassigns src when complete but currentSrc is empty', () => {
    const img = mockImg(0, 120, { complete: true, currentSrc: '' });
    let assigned = 0;
    Object.defineProperty(img, 'src', {
      get: () => 'https://img/p.jpg',
      set: () => {
        assigned += 1;
      },
    });
    armBitmap(img as unknown as HTMLImageElement);
    expect(assigned).toBe(1);
  });

  it('eager-decodes a focused row of real posters, not far clones', () => {
    expect(shouldArmBitmap({ inCamera: true, clone: false, focusedRow: false })).toBe(true);
    expect(shouldArmBitmap({ inCamera: true, clone: true, focusedRow: false })).toBe(true);
    expect(shouldArmBitmap({ inCamera: false, clone: false, focusedRow: true })).toBe(true);
    expect(shouldArmBitmap({ inCamera: false, clone: true, focusedRow: true })).toBe(false);
    expect(shouldArmBitmap({ inCamera: false, clone: false, focusedRow: false })).toBe(false);
  });

  it('eager-arms a visible-ish rail when IntersectionObserver is missing', () => {
    const original = globalThis.IntersectionObserver;
    Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: undefined, writable: true });
    try {
      const far = mockImg(8000, 8140);
      const root = {
        querySelector: () => null,
        querySelectorAll: () => [far],
        getBoundingClientRect: () => ({ top: 80, bottom: 240 }),
        closest: () => ({
          getBoundingClientRect: () => ({ top: 0, bottom: 720 }),
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      } as unknown as HTMLElement;
      const stop = watchRailBitmaps(root);
      expect(far.loading).toBe('eager');
      expect(far.dataset.bitmapWoke).toBe('true');
      stop();
    } finally {
      Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: original, writable: true });
    }
  });
});
