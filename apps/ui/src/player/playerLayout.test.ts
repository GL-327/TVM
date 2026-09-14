import { describe, expect, it } from 'vitest';
import {
  isCoarsePointer,
  isMobilePlayerViewport,
  PLAYER_ASPECT_CSS,
  PLAYER_ASPECT_RATIO,
  PLAYER_HIT_TARGET_PX,
  PLAYER_LAYOUT_RULES,
  PLAYER_OBJECT_FIT,
  playerChromeBand,
  playerLayoutMode,
  playerOrientation,
  playerShellClass,
  playerStageBox,
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
    expect(playerLayoutMode(true, 'portrait')).toBe('mobile-portrait');
    expect(playerLayoutMode(true, 'landscape')).toBe('mobile-landscape');
    expect(playerLayoutMode(false, 'portrait')).toBe('cinema');
  });

  it('keeps 16:9 contain letterbox rules for both orientations', () => {
    expect(PLAYER_LAYOUT_RULES.aspect).toBe(PLAYER_ASPECT_RATIO);
    expect(PLAYER_LAYOUT_RULES.aspectCss).toBe(PLAYER_ASPECT_CSS);
    expect(PLAYER_LAYOUT_RULES.fit).toBe(PLAYER_OBJECT_FIT);
    expect(PLAYER_LAYOUT_RULES.fit).toBe('contain');
    expect(PLAYER_LAYOUT_RULES.hitTargetPx).toBe(PLAYER_HIT_TARGET_PX);
    expect(PLAYER_LAYOUT_RULES.hitTargetPx).toBe(44);
    expect(PLAYER_LAYOUT_RULES.portrait.videoAlign).toBe('top');
    expect(PLAYER_LAYOUT_RULES.portrait.letterbox).toBe(true);
    expect(PLAYER_LAYOUT_RULES.portrait.chrome).toBe('remaining-band-or-overlay');
    expect(PLAYER_LAYOUT_RULES.landscape.stage).toBe('full-bleed');
    expect(PLAYER_LAYOUT_RULES.landscape.stretch).toBe(false);
  });

  it('pins a 16:9 stage to the top on a portrait phone and leaves a chrome band', () => {
    const viewport = { width: 390, height: 844 };
    const stage = playerStageBox(viewport, 'mobile-portrait');
    expect(stage.top).toBe(0);
    expect(stage.left).toBe(0);
    expect(stage.width).toBe(390);
    expect(stage.height).toBeCloseTo(390 * 9 / 16, 5);
    expect(stage.width / stage.height).toBeCloseTo(16 / 9, 5);
    const band = playerChromeBand(viewport, 'mobile-portrait');
    expect(band.top).toBeCloseTo(stage.height, 5);
    expect(band.height).toBeCloseTo(844 - stage.height, 5);
    expect(band.height).toBeGreaterThan(PLAYER_HIT_TARGET_PX);
  });

  it('fills the viewport in landscape without stretching past contain', () => {
    const viewport = { width: 844, height: 390 };
    const stage = playerStageBox(viewport, 'mobile-landscape');
    expect(stage).toEqual({ top: 0, left: 0, width: 844, height: 390 });
    expect(playerChromeBand(viewport, 'mobile-landscape')).toEqual(stage);
    expect(playerStageBox(viewport, 'cinema')).toEqual(stage);
  });
});
