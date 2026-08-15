import { describe, expect, it, vi } from 'vitest';
import { intentFromKey, isDirectional, onIntent } from './intents';

function keyEvent(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    preventDefault: vi.fn(),
    ...init,
  } as unknown as KeyboardEvent;
}

describe('intentFromKey', () => {
  it('maps the D-pad', () => {
    expect(intentFromKey(keyEvent({ key: 'ArrowUp' }))).toBe('up');
    expect(intentFromKey(keyEvent({ key: 'ArrowDown' }))).toBe('down');
    expect(intentFromKey(keyEvent({ key: 'ArrowLeft' }))).toBe('left');
    expect(intentFromKey(keyEvent({ key: 'ArrowRight' }))).toBe('right');
  });

  it('treats Enter and Space as select', () => {
    expect(intentFromKey(keyEvent({ key: 'Enter' }))).toBe('select');
    expect(intentFromKey(keyEvent({ key: ' ' }))).toBe('select');
  });

  it('accepts every spelling of back a remote might send', () => {
    for (const key of ['Escape', 'Backspace', 'BrowserBack', 'GoBack']) {
      expect(intentFromKey(keyEvent({ key }))).toBe('back');
    }
  });

  it('maps media keys', () => {
    expect(intentFromKey(keyEvent({ key: 'MediaPlayPause' }))).toBe('playPause');
    expect(intentFromKey(keyEvent({ key: 'MediaTrackNext' }))).toBe('next');
    expect(intentFromKey(keyEvent({ key: 'AudioVolumeMute' }))).toBe('mute');
  });

  it('ignores unknown keys', () => {
    expect(intentFromKey(keyEvent({ key: 'q' }))).toBeNull();
    expect(intentFromKey(keyEvent({ key: 'F5' }))).toBeNull();
  });

  it('ignores modified keys so dev shortcuts still work', () => {
    expect(intentFromKey(keyEvent({ key: 'ArrowUp', ctrlKey: true }))).toBeNull();
    expect(intentFromKey(keyEvent({ key: 'Enter', altKey: true }))).toBeNull();
  });
});

describe('isDirectional', () => {
  it('is true only for the D-pad', () => {
    expect(isDirectional('left')).toBe(true);
    expect(isDirectional('select')).toBe(false);
    expect(isDirectional('playPause')).toBe(false);
  });
});

describe('onIntent', () => {
  function fakeTarget() {
    const listeners: Array<(event: Event) => void> = [];
    return {
      listeners,
      addEventListener: (_type: string, fn: EventListenerOrEventListenerObject) => {
        listeners.push(fn as (event: Event) => void);
      },
      removeEventListener: (_type: string, fn: EventListenerOrEventListenerObject) => {
        const index = listeners.indexOf(fn as (event: Event) => void);
        if (index >= 0) listeners.splice(index, 1);
      },
    };
  }

  it('delivers mapped intents and prevents the default', () => {
    const target = fakeTarget();
    const handler = vi.fn();
    onIntent(target, handler);

    const event = keyEvent({ key: 'ArrowRight' });
    target.listeners[0]?.(event as unknown as Event);

    expect(handler).toHaveBeenCalledWith({ intent: 'right', source: event, repeat: false });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('does not swallow keys it cannot map', () => {
    const target = fakeTarget();
    const handler = vi.fn();
    onIntent(target, handler);

    const event = keyEvent({ key: 'k' });
    target.listeners[0]?.(event as unknown as Event);

    expect(handler).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('can drop auto-repeat from a held button', () => {
    const target = fakeTarget();
    const handler = vi.fn();
    onIntent(target, handler, { ignoreRepeat: true });

    target.listeners[0]?.(keyEvent({ key: 'ArrowDown', repeat: true }) as unknown as Event);
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribes', () => {
    const target = fakeTarget();
    const off = onIntent(target, vi.fn());
    expect(target.listeners).toHaveLength(1);
    off();
    expect(target.listeners).toHaveLength(0);
  });
});
