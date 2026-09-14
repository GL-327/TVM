import { describe, expect, it } from 'vitest';
import {
  isCoarsePointer,
  isMobilePlayerViewport,
  playerOrientation,
  playerShellClass,
} from './playerLayout';

describe('player layout', () => {
  it('treats a phone shell or a coarse narrow window as the mobile player', () => {
    expect(isMobilePlayerViewport({ phoneShell: true, coarse: false, narrow: false })).toBe(true);
    expect(isMobilePlayerViewport({ phoneShell: false, coarse: true, narrow: true })).toBe(true);
    expect(isMobilePlayerViewport({ phoneShell: false, coarse: false, narrow: true })).toBe(false);
    expect(isCoarsePointer({ matches: true })).toBe(true);
  });

  it('uses portrait when height is at least width', () => {
    expect(playerOrientation(390, 844)).toBe('portrait');
    expect(playerOrientation(844, 390)).toBe('landscape');
    expect(playerShellClass(true, 'portrait')).toContain('player--mobile');
    expect(playerShellClass(true, 'portrait')).toContain('player--portrait');
    expect(playerShellClass(false, 'landscape')).toContain('player--cinema');
  });
});
