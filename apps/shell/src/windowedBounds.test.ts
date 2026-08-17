import { describe, expect, it } from 'vitest';
import { isWindowedShell, uiLoadUrl, windowedBounds } from './windowedBounds';

describe('windowedBounds', () => {
  it('uses 1280x720 when the laptop has room', () => {
    expect(windowedBounds({ width: 1920, height: 1080 })).toEqual({ width: 1280, height: 720 });
  });

  it('shrinks to the work area so a small laptop is not covered', () => {
    expect(windowedBounds({ width: 1366, height: 728 })).toEqual({ width: 1280, height: 680 });
    expect(windowedBounds({ width: 1280, height: 720 })).toEqual({ width: 1232, height: 672 });
  });
});

describe('uiLoadUrl', () => {
  it('marks the windowed laptop shell so the UI can show a pointer', () => {
    expect(uiLoadUrl('http://127.0.0.1:5173', true)).toBe('http://127.0.0.1:5173/?desktop=1');
    expect(uiLoadUrl('http://127.0.0.1:5173', false)).toBe('http://127.0.0.1:5173/');
  });

  it('is windowed only when TVM_WINDOWED=1', () => {
    expect(isWindowedShell({ TVM_WINDOWED: '1' })).toBe(true);
    expect(isWindowedShell({})).toBe(false);
  });
});
