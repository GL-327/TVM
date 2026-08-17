import { describe, expect, it } from 'vitest';
import { isDesktopShell, isTvPreview, tvScale } from './tvStage';

describe('tv stage', () => {
  it('is opt-in via ?tv=1', () => {
    expect(isTvPreview('')).toBe(false);
    expect(isTvPreview('?recovery=1')).toBe(false);
    expect(isTvPreview('?tv=1')).toBe(true);
  });

  it('marks the windowed laptop shell via ?desktop=1', () => {
    expect(isDesktopShell('')).toBe(false);
    expect(isDesktopShell('?tv=1')).toBe(false);
    expect(isDesktopShell('?desktop=1')).toBe(true);
  });

  it('fits a 16:9 stage inside the window', () => {
    expect(tvScale(1920, 1080)).toBe(1);
    expect(tvScale(960, 540)).toBe(0.5);
    expect(tvScale(1920, 540)).toBe(0.5);
  });
});
