import { describe, expect, it } from 'vitest';
import { wrapFocusId } from './wrapFocus';

describe('wrapFocusId', () => {
  it('loops right from the last poster back to the first', () => {
    expect(wrapFocusId('right', 4, 5, 'a-1', 'a-5')).toBe('a-1');
  });

  it('loops left from the first poster to the last', () => {
    expect(wrapFocusId('left', 0, 5, 'a-1', 'a-5')).toBe('a-5');
  });

  it('does not steal up/down or mid-rail hops', () => {
    expect(wrapFocusId('right', 1, 5, 'a-1', 'a-5')).toBeNull();
    expect(wrapFocusId('down', 4, 5, 'a-1', 'a-5')).toBeNull();
    expect(wrapFocusId('left', 0, 1, 'a-1', 'a-1')).toBeNull();
  });
});
