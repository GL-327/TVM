import { describe, expect, it } from 'vitest';
import {
  conveyorWrapIndex,
  countColumns,
  hopOrPass,
  inferWrapKind,
  shouldConsumeAxis,
  wrapFocusId,
  wrapGridIndex,
  wrapGroupKind,
  wrapIndexInGroup,
} from './wrapFocus';
import { railHopDistance, wrapIndex } from './railNav';

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

  it('loops a title rail at both ends', () => {
    expect(wrapFocusId('right', 7, 8, 'films-a', 'films-h')).toBe('films-a');
    expect(wrapFocusId('left', 0, 8, 'films-a', 'films-h')).toBe('films-h');
    expect(wrapFocusId('right', 3, 8, 'films-a', 'films-h')).toBeNull();
  });

  it('loops category tabs at both ends', () => {
    expect(wrapFocusId('right', 4, 5, 'service-tab-home', 'service-tab-list')).toBe('service-tab-home');
    expect(wrapFocusId('left', 0, 5, 'service-tab-home', 'service-tab-list')).toBe('service-tab-list');
    expect(wrapFocusId('right', 1, 5, 'service-tab-home', 'service-tab-list')).toBeNull();
  });
});

describe('wrapGridIndex', () => {
  it('loops a row of a channel / apps / plan grid', () => {
    expect(wrapGridIndex('right', 2, 6, 3)).toBe(0);
    expect(wrapGridIndex('left', 0, 6, 3)).toBe(2);
    expect(wrapGridIndex('right', 1, 6, 3)).toBe(2);
    expect(wrapGridIndex('left', 3, 6, 3)).toBe(5);
  });

  it('wraps down from the last row and leaves the first row on up', () => {
    expect(wrapGridIndex('down', 4, 6, 3)).toBe(1);
    expect(wrapGridIndex('down', 1, 6, 3)).toBe(4);
    expect(wrapGridIndex('up', 4, 6, 3)).toBe(1);
    expect(wrapGridIndex('up', 1, 6, 3)).toBeNull();
  });
});

describe('wrap group kind', () => {
  it('treats a single row of tops as a rail and stacked tops as a column', () => {
    expect(countColumns([10, 10, 10, 80])).toBe(3);
    expect(wrapGroupKind(3, 3)).toBe('x');
    expect(wrapGroupKind(1, 5)).toBe('y');
    expect(wrapGroupKind(3, 6)).toBe('grid');
  });
});

describe('inferWrapKind', () => {
  it('reads data-wrap and known hosts without measuring tiles', () => {
    expect(inferWrapKind('rail__track', null)).toBe('x');
    expect(inferWrapKind('ribbon__list', 'row')).toBe('x');
    expect(inferWrapKind('service-nav__tabs', null)).toBe('x');
    expect(inferWrapKind('channel-chips', 'row')).toBe('x');
    expect(inferWrapKind('nf-hub__tabs extra', null)).toBe('x');
    expect(inferWrapKind('dplus-brands', null)).toBe('x');
    expect(inferWrapKind('stream-chrome', 'row')).toBe('x');
    expect(inferWrapKind('channel-grid', 'grid')).toBe('grid');
    expect(inferWrapKind('app-grid', null)).toBe('grid');
    expect(inferWrapKind('poster-grid', null)).toBe('grid');
    expect(inferWrapKind('settings-list', 'y')).toBe('y');
    expect(inferWrapKind('mystery', null)).toBeNull();
  });

  it('does not treat a tile modifier as a wrap host', () => {
    expect(inferWrapKind('app-card app-card--grid', null)).toBeNull();
  });
});

describe('conveyor wrap', () => {
  it('loops last→first and first→last instantly like Netflix', () => {
    expect(conveyorWrapIndex('right', 7, 8)).toBe(0);
    expect(conveyorWrapIndex('left', 0, 8)).toBe(7);
    expect(wrapIndexInGroup('right', 7, 8, 'x', 8)).toBe(0);
    expect(wrapIndexInGroup('left', 0, 8, 'x', 8)).toBe(7);
  });

  it('does not steal a mid-rail hop or a vertical move', () => {
    expect(conveyorWrapIndex('right', 3, 8)).toBeNull();
    expect(conveyorWrapIndex('left', 3, 8)).toBeNull();
    expect(conveyorWrapIndex('down', 7, 8)).toBeNull();
    expect(conveyorWrapIndex('right', 0, 1)).toBeNull();
  });

  it('visits every looping title exactly once per lap', () => {
    const count = 8;
    const seen: number[] = [];
    let index = 0;
    for (let step = 0; step < count; step += 1) {
      seen.push(index);
      const next = wrapIndexInGroup('right', index, count, 'x', count);
      expect(next).not.toBeNull();
      expect(railHopDistance(index, next ?? -1, count)).toBe(1);
      expect(wrapIndex(index, 'right', count)).toBe(next);
      expect(conveyorWrapIndex('right', index, count)).toBe(index === count - 1 ? 0 : null);
      index = next ?? index;
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(index).toBe(0);
  });
});

describe('wrapIndexInGroup', () => {
  it('loops a title rail at both ends and hops inside', () => {
    expect(wrapIndexInGroup('right', 7, 8, 'x', 8)).toBe(0);
    expect(wrapIndexInGroup('left', 0, 8, 'x', 8)).toBe(7);
    expect(wrapIndexInGroup('right', 3, 8, 'x', 8)).toBe(4);
    expect(wrapIndexInGroup('right', 0, 8, 'x', 8)).toBe(1);
    expect(wrapIndexInGroup('up', 3, 8, 'x', 8)).toBeNull();
  });

  it('loops category tabs at both ends', () => {
    expect(wrapIndexInGroup('right', 4, 5, 'x', 5)).toBe(0);
    expect(wrapIndexInGroup('left', 0, 5, 'x', 5)).toBe(4);
    expect(wrapIndexInGroup('right', 1, 5, 'x', 5)).toBe(2);
  });

  it('loops a grid row and wraps down from the last row', () => {
    expect(wrapIndexInGroup('right', 2, 6, 'grid', 3)).toBe(0);
    expect(wrapIndexInGroup('left', 0, 6, 'grid', 3)).toBe(2);
    expect(wrapIndexInGroup('down', 4, 6, 'grid', 3)).toBe(1);
    expect(wrapIndexInGroup('up', 1, 6, 'grid', 3)).toBeNull();
  });

  it('moves a settings column one row at a time and leaves the top for the ribbon', () => {
    expect(wrapIndexInGroup('down', 0, 8, 'y', 1)).toBe(1);
    expect(wrapIndexInGroup('down', 6, 8, 'y', 1)).toBe(7);
    expect(wrapIndexInGroup('down', 7, 8, 'y', 1)).toBe(0);
    expect(wrapIndexInGroup('up', 3, 8, 'y', 1)).toBe(2);
    expect(wrapIndexInGroup('up', 0, 8, 'y', 1)).toBeNull();
    expect(wrapIndexInGroup('left', 3, 8, 'y', 1)).toBeNull();
  });
});

describe('shouldConsumeAxis', () => {
  it('keeps left/right inside rails and grids, and up/down inside columns', () => {
    expect(shouldConsumeAxis('x', 'left')).toBe(true);
    expect(shouldConsumeAxis('x', 'up')).toBe(false);
    expect(shouldConsumeAxis('y', 'down')).toBe(true);
    expect(shouldConsumeAxis('y', 'right')).toBe(false);
    expect(shouldConsumeAxis('grid', 'right')).toBe(true);
    expect(shouldConsumeAxis('grid', 'up')).toBe(false);
  });
});

describe('hopOrPass', () => {
  it('never consumes a missing target', () => {
    expect(hopOrPass(null)).toEqual({ next: null, consume: false });
    const node = { id: 'card' } as unknown as HTMLElement;
    expect(hopOrPass(node)).toEqual({ next: node, consume: true });
  });
});
