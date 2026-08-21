import { describe, expect, it } from 'vitest';
import {
  chromeReserve,
  HOME_ROW_CAMERA_PAD,
  pagePanTarget,
  rowCameraTop,
  shouldNudgePageY,
} from './revealFocused';

describe('home camera', () => {
  it('locks a row just below the top chrome', () => {
    expect(HOME_ROW_CAMERA_PAD).toBe(72);
    expect(rowCameraTop(0, 640, 0, HOME_ROW_CAMERA_PAD)).toBe(568);
    expect(rowCameraTop(200, 120, 0, HOME_ROW_CAMERA_PAD)).toBe(248);
  });

  it('ignores a tall sidebar when reserving scroll padding', () => {
    expect(chromeReserve(1080, 102, 1080, 1920)).toBe(0);
    expect(chromeReserve(72, 1920, 1080, 1920)).toBe(72);
    expect(chromeReserve(0, 1920, 1080, 1920)).toBe(0);
  });

  it('ignores tiny page-camera drift from focus scale', () => {
    expect(shouldNudgePageY(400, 404)).toBe(false);
    expect(shouldNudgePageY(400, 420)).toBe(true);
  });

  it('pans Down to the focused rail without snapping the page to origin', () => {
    expect(pagePanTarget(0, 640, 0, 72)).toBe(568);
    expect(pagePanTarget(0, 640, 0, 72)).not.toBe(0);
    expect(pagePanTarget(200, 400, 0, 72)).toBe(528);
    expect(pagePanTarget(80, 40, 0, 72)).toBe(48);
    expect(pagePanTarget(0, 40, 0, 72)).toBe(0);
  });
});
