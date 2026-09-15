import { describe, expect, it } from 'vitest';
import {
  asMaxHeight,
  extrasForFamily,
  fallbackInsets,
  inferDeviceFamily,
  inferMaxHeight,
  parseDeviceChrome,
  playbackMaxHeight,
} from './deviceChrome';

describe('device chrome classification', () => {
  it('treats Dynamic Island insets as island and notch insets as notch', () => {
    expect(inferDeviceFamily({ insetTop: 59, shortSide: 393, longSide: 852 })).toBe('island');
    expect(inferDeviceFamily({ insetTop: 47, shortSide: 390, longSide: 844 })).toBe('notch');
    expect(inferDeviceFamily({ insetTop: 20, shortSide: 375, longSide: 667 })).toBe('home-button');
  });

  it('falls back to logical size when env(safe-area) is still 0', () => {
    expect(inferDeviceFamily({ insetTop: 0, shortSide: 393, longSide: 852 })).toBe('island');
    expect(inferDeviceFamily({ insetTop: 0, shortSide: 390, longSide: 844 })).toBe('notch');
    expect(inferDeviceFamily({ insetTop: 0, shortSide: 375, longSide: 667 })).toBe('home-button');
    expect(inferDeviceFamily({ insetTop: 0, shortSide: 834, longSide: 1194, tablet: true })).toBe('ipad');
  });

  it('lets newer island / Pro phones take 4K and older bezels stay HD', () => {
    expect(inferMaxHeight('island', 393, 3)).toBe(2160);
    expect(inferMaxHeight('ipad', 834, 2)).toBe(2160);
    expect(inferMaxHeight('notch', 393, 3)).toBe(2160);
    expect(inferMaxHeight('notch', 375, 3)).toBe(1080);
    expect(inferMaxHeight('home-button', 375, 2)).toBe(1080);
    expect(inferMaxHeight('home-button', 320, 2)).toBe(720);
  });

  it('caps plan quality to what the glass can show', () => {
    expect(playbackMaxHeight(2160, 1080)).toBe(1080);
    expect(playbackMaxHeight(720, 2160)).toBe(720);
    expect(playbackMaxHeight(2160, 2160)).toBe(2160);
    expect(asMaxHeight(1440)).toBe(1080);
  });

  it('gives the island extra top inset so the bar sits below the cutout', () => {
    expect(fallbackInsets('island')).toEqual({ top: 59, bottom: 34 });
    expect(extrasForFamily('island').extraTop).toBe(10);
    expect(extrasForFamily('home-button').extraX).toBe(8);
  });

  it('prefers a native payload over the web probe', () => {
    const parsed = parseDeviceChrome(
      { family: 'island', model: 'iPhone 16 Pro', maxHeight: 2160, insetTop: 62, extraTop: 10 },
      {
        identifier: 'web',
        model: 'notch',
        family: 'notch',
        maxHeight: 1080,
        insetTop: 47,
        insetRight: 0,
        insetBottom: 34,
        insetLeft: 0,
        extraTop: 6,
        extraBottom: 0,
        extraX: 0,
      },
    );
    expect(parsed.family).toBe('island');
    expect(parsed.model).toBe('iPhone 16 Pro');
    expect(parsed.insetTop).toBe(62);
    expect(parsed.maxHeight).toBe(2160);
  });
});
