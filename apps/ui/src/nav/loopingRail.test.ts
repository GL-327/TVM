import { describe, expect, it } from 'vitest';
import {
  canonicalFocusId,
  contentOverflows,
  conveyorAfterWrap,
  conveyorWrapDelta,
  isWrapAcross,
  loopPitch,
  loopSetWidth,
  normalizeLoopScroll,
  shouldLoopRail,
} from './loopingRail';

describe('looping rail', () => {
  it('loops only when there is more than one card', () => {
    expect(shouldLoopRail(0)).toBe(false);
    expect(shouldLoopRail(1)).toBe(false);
    expect(shouldLoopRail(2)).toBe(true);
  });

  it('does not clone a row that already fits on screen', () => {
    expect(contentOverflows(900, 1920, 1)).toBe(false);
    expect(contentOverflows(2700, 1920, 3)).toBe(false);
    expect(contentOverflows(2400, 800, 1)).toBe(true);
    expect(contentOverflows(2700, 800, 3)).toBe(true);
    expect(contentOverflows(2400, 800, 3)).toBe(false);
  });

  it('treats the track as three equal copies', () => {
    expect(loopSetWidth(900, 3)).toBe(300);
    expect(loopPitch(300, 6)).toBe(50);
  });

  it('teleports only when a clone copy is actually on screen', () => {
    expect(normalizeLoopScroll(40, 300)).toBe(340);
    expect(normalizeLoopScroll(680, 300)).toBe(380);
    expect(normalizeLoopScroll(300, 300)).toBe(300);
    expect(normalizeLoopScroll(500, 300)).toBe(500);
  });

  it('keeps wrap motion in the same direction', () => {
    expect(conveyorWrapDelta('right', 48)).toBe(48);
    expect(conveyorWrapDelta('left', 48)).toBe(-48);
    expect(isWrapAcross(4, 'right', 5)).toBe(true);
    expect(isWrapAcross(0, 'left', 5)).toBe(true);
    expect(isWrapAcross(1, 'right', 5)).toBe(false);
  });

  it('lands wrap on the matching card in the middle copy', () => {
    expect(conveyorAfterWrap(250, 'left', 300)).toBe(550);
    expect(conveyorAfterWrap(610, 'right', 300)).toBe(310);
  });

  it('maps conveyor clones back to the focusable copy', () => {
    expect(canonicalFocusId('home-tt123')).toBe('home-tt123');
    expect(canonicalFocusId('home-tt123--0')).toBe('home-tt123');
    expect(canonicalFocusId('home-tt123--2')).toBe('home-tt123');
    expect(canonicalFocusId('home-tt123--1')).toBe('home-tt123--1');
  });
});
