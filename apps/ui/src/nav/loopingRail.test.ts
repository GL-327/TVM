import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cameraXForCard,
  canonicalFocusId,
  conveyorWrapDelta,
  isLoopSeamJump,
  isWrapAcross,
  loopPitch,
  loopSetWidth,
  measureLoopSetWidth,
  normalizeLoopScroll,
  oneSetFitsCamera,
  readLoopSetWidth,
  shouldLoopRail,
  settleWrappingTrack,
  WRAP_UNLOCK_MS,
} from './loopingRail';

const dir = dirname(fileURLToPath(import.meta.url));

describe('looping rail', () => {
  it('loops only when there is more than one card', () => {
    expect(shouldLoopRail(0)).toBe(false);
    expect(shouldLoopRail(1)).toBe(false);
    expect(shouldLoopRail(2)).toBe(true);
  });

  it('treats the track as three equal copies', () => {
    expect(loopSetWidth(900, 3)).toBe(300);
    expect(loopPitch(300, 6)).toBe(50);
  });

  it('measures one set from copy 0 to copy 1', () => {
    const copies: Record<string, { offsetLeft: number; offsetParent: object }> = {};
    const track = {
      scrollWidth: 960,
      clientWidth: 800,
      querySelector(selector: string) {
        const copy = selector.match(/loop-copy="(\d)"/)?.[1];
        return copy === undefined ? null : (copies[copy] ?? null);
      },
    };
    copies['0'] = { offsetLeft: 12, offsetParent: track };
    copies['1'] = { offsetLeft: 412, offsetParent: track };
    expect(measureLoopSetWidth(track as unknown as HTMLElement)).toBe(400);
    expect(oneSetFitsCamera(track as unknown as HTMLElement, 400)).toBe(true);
    expect(oneSetFitsCamera(track as unknown as HTMLElement, 1200)).toBe(false);
  });

  it('reuses a measured set width on the hot scroll path', () => {
    const track = {
      dataset: { loopSet: '412' },
      scrollWidth: 0,
      querySelector: () => null,
    } as unknown as HTMLElement;
    expect(readLoopSetWidth(track)).toBe(412);
  });

  it('teleports scroll back into the middle copy', () => {
    expect(normalizeLoopScroll(40, 300, 300)).toBe(340);
    expect(normalizeLoopScroll(620, 300, 300)).toBe(320);
    expect(normalizeLoopScroll(300, 300, 300)).toBe(300);
  });

  it('keeps a long rail on real cards instead of copy-0 clones', () => {
    // Viewport 120, set 300 → legal camera is [240, 540). A late title at 500
    // must stay put; the old [150, 450) window would jump to 200 (clones).
    expect(normalizeLoopScroll(500, 300, 120)).toBe(500);
    expect(normalizeLoopScroll(200, 300, 120)).toBe(500);
    expect(normalizeLoopScroll(80, 300, 120)).toBe(380);
    expect(normalizeLoopScroll(560, 300, 120)).toBe(260);
  });

  it('lets the first and last cards sit centered when the row is wider than the screen', () => {
    const setWidth = 1000;
    const viewWidth = 400;
    const firstCentered = setWidth - viewWidth / 2;
    const lastCentered = setWidth * 2 - viewWidth / 2 - 1;
    expect(normalizeLoopScroll(firstCentered, setWidth, viewWidth)).toBe(firstCentered);
    expect(normalizeLoopScroll(lastCentered, setWidth, viewWidth)).toBe(lastCentered);
  });

  it('only teleports the camera across a whole catalog set', () => {
    expect(isLoopSeamJump(400, 410, 300)).toBe(false);
    expect(isLoopSeamJump(400, 700, 300)).toBe(true);
    expect(isLoopSeamJump(40, 40, 0)).toBe(false);
  });

  it('does not teleport a one-title hop onto another set', () => {
    const track = {
      dataset: { looping: 'true' },
      scrollLeft: 400,
      clientWidth: 400,
      scrollWidth: 1200,
      querySelector: () => null,
    } as unknown as HTMLElement;
    expect(cameraXForCard(track, 430)).toBe(430);
    expect(cameraXForCard(track, 40)).toBe(440);
  });

  it('does not park a one-title hop at the conveyor window edge', () => {
    const track = {
      dataset: { looping: 'true' },
      scrollLeft: 500,
      clientWidth: 120,
      scrollWidth: 900,
      querySelector: () => null,
    } as unknown as HTMLElement;
    // Window is [240, 540). Old code parked 550 → 250 (a whole set onto clones).
    expect(cameraXForCard(track, 550)).toBe(550);
    expect(isLoopSeamJump(500, 550, 300)).toBe(false);
  });

  it('does not park the camera with a viewport-blind 0.5 / 1.5 window', () => {
    const looping = readFileSync(join(dir, 'loopingRail.ts'), 'utf8');
    const reveal = readFileSync(join(dir, 'revealFocused.ts'), 'utf8');
    expect(looping).not.toContain('setWidth * 0.5');
    expect(looping).not.toContain('setWidth * 1.5');
    expect(reveal).not.toContain('setWidth * 0.5');
    expect(reveal).not.toContain('setWidth * 1.5');
    expect(reveal).toContain('cameraXForCard');
    expect(looping).toContain('return cameraXForCard(track, target)');
  });

  it('keeps wrap motion in the same direction', () => {
    expect(conveyorWrapDelta('right', 48)).toBe(48);
    expect(conveyorWrapDelta('left', 48)).toBe(-48);
    expect(isWrapAcross(4, 'right', 5)).toBe(true);
    expect(isWrapAcross(0, 'left', 5)).toBe(true);
    expect(isWrapAcross(1, 'right', 5)).toBe(false);
  });

  it('maps conveyor clones back to the focusable copy', () => {
    expect(canonicalFocusId('home-tt123')).toBe('home-tt123');
    expect(canonicalFocusId('home-tt123--0')).toBe('home-tt123');
    expect(canonicalFocusId('home-tt123--2')).toBe('home-tt123');
    expect(canonicalFocusId('home-tt123--1')).toBe('home-tt123--1');
  });

  it('exposes wrap settle so a held D-pad can release the conveyor lock', () => {
    expect(typeof settleWrappingTrack).toBe('function');
    expect(WRAP_UNLOCK_MS).toBeGreaterThan(400);
    const looping = readFileSync(join(dir, 'loopingRail.ts'), 'utf8');
    expect(looping).toContain('finally');
    expect(looping).toContain('settleWrappingTrack(track)');
  });

  it('lets layout own data-looping so Home re-renders cannot un-park clones', () => {
    const src = readFileSync(join(dir, '../components/Rail.tsx'), 'utf8');
    expect(src).not.toContain('data-looping={looping');
    expect(src).toContain("track.dataset.looping = 'true'");
    expect(src).toContain('isScrollAnimating');
    expect(src).toContain('cameraBusy');
    expect(src).toContain('trackHasFocus');
  });
});
