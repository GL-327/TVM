import { describe, expect, it } from 'vitest';
import { desktopNativePlayback, shellWindowChrome } from './windowChrome';

describe('desktop window chrome', () => {
  it('keeps Linux opaque so the window is actually visible', () => {
    expect(shellWindowChrome('linux')).toEqual({ transparent: false, backgroundColor: '#071033' });
    expect(desktopNativePlayback('linux')).toBe(false);
  });

  it('keeps Windows and macOS transparent so mpv can show through', () => {
    expect(shellWindowChrome('win32').transparent).toBe(true);
    expect(shellWindowChrome('darwin').transparent).toBe(true);
    expect(desktopNativePlayback('win32')).toBe(true);
    expect(desktopNativePlayback('darwin')).toBe(true);
  });
});
