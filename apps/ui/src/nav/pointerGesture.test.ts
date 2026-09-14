import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPointerInput } from './pointerInput';
import { requestFocus } from './focusEngine';
import { cancelPendingReveal } from './revealFocused';
import { cancelScrollAnim } from './scrollAnim';

vi.mock('./focusEngine', () => ({ requestFocus: vi.fn() }));
vi.mock('./railNav', () => ({ focusKeyFor: () => 'rail/card' }));
vi.mock('./revealFocused', () => ({ cancelPendingReveal: vi.fn(), suppressNextReveal: vi.fn() }));
vi.mock('./scrollAnim', () => ({ cancelScrollAnim: vi.fn(), animate: vi.fn(), scrollTarget: vi.fn() }));

class Surface extends EventTarget {
  parentElement: Surface | null = null;
  isConnected = true;
  classList = { contains: () => false, add: vi.fn(), remove: vi.fn() };
  closest(selector: string): Surface | null { return selector === '[data-focus-id]' ? this : null; }
}

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); vi.clearAllMocks(); });

function setup() {
  const doc = new Surface();
  const host = new Surface();
  Object.assign(doc, { documentElement: new Surface(), body: new Surface(), activeElement: null });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', new Surface());
  vi.stubGlobal('Element', Surface);
  vi.stubGlobal('HTMLElement', Surface);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  cleanup = startPointerInput();
  const pointer = (type: string, x = 20, overrides = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: 10, isPrimary: true, ...overrides });
    Object.defineProperty(event, 'target', { get: () => host });
    doc.dispatchEvent(event);
    return event;
  };
  return { host, pointer };
}

describe('native touch navigation', () => {
  it('stops later capture listeners so a finger-down does not D-pad-focus mid-swipe', () => {
    const { pointer } = setup();
    const extra = vi.fn();
    document.addEventListener('pointerdown', extra, true);
    pointer('pointerdown');
    expect(extra).not.toHaveBeenCalled();
    expect(requestFocus).not.toHaveBeenCalled();
  });

  it('releases pending camera movement and leaves a swipe to the browser', () => {
    const { host, pointer } = setup();
    expect(pointer('pointerdown').defaultPrevented).toBe(false);
    expect(requestFocus).not.toHaveBeenCalled();
    expect(cancelPendingReveal).toHaveBeenCalledOnce();
    expect(cancelScrollAnim).toHaveBeenCalledWith(host);
    expect(pointer('pointermove', 80).defaultPrevented).toBe(false);
    pointer('pointerup', 80);
    expect(requestFocus).not.toHaveBeenCalled();
  });

  it('focuses a completed tap once without suppressing its native click', () => {
    const { pointer } = setup();
    pointer('pointerdown');
    expect(pointer('pointerup', 23).defaultPrevented).toBe(false);
    expect(requestFocus).toHaveBeenCalledExactlyOnceWith('rail/card');
  });

  it('does not focus after the browser claims a pan or after a second touch begins', () => {
    const { pointer } = setup();
    pointer('pointerdown');
    pointer('pointercancel');
    pointer('pointerup');
    pointer('pointerdown');
    pointer('pointerdown', 80, { pointerId: 2, isPrimary: false });
    pointer('pointerup');
    expect(requestFocus).not.toHaveBeenCalled();
  });
});
