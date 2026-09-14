import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCanvasDrag, CANVAS_DRAG_SEEK_PX, progressRatio } from './MouseLayer';

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, 'MouseLayer.tsx'), 'utf8');
const idle = readFileSync(join(dir, 'useIdleChrome.ts'), 'utf8');

describe('player mouse layer', () => {
  it('does not preventDefault on pointerdown (Chromium would cancel FocusButton click)', () => {
    const start = src.indexOf('const onPointerDown');
    const end = src.indexOf('const onClick');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const handler = src.slice(start, end);
    expect(handler).not.toContain('preventDefault');
    expect(handler).toContain('isInteractiveChrome');
  });

  it('toggles playback from a video-stage click, not from chrome buttons', () => {
    const start = src.indexOf('const onClick');
    const handler = src.slice(start, src.indexOf('host.addEventListener'));
    expect(handler).toContain('isVideoToggleTarget');
    expect(handler).toContain('togglePlayback');
    expect(handler).toContain('isInteractiveChrome');
    expect(handler).toContain('tvm:toggle-chrome');
  });

  it('drags on the canvas to seek and taps to toggle chrome', () => {
    expect(src).toContain('isCanvasDrag');
    expect(src).toContain('isStageTarget');
    expect(src).toContain('seekPlayerToRatio');
    expect(src).toContain('tvm:toggle-chrome');
    expect(src).toContain('CANVAS_DRAG_SEEK_PX');
    expect(idle).toContain('tvm:toggle-chrome');
    expect(isCanvasDrag(CANVAS_DRAG_SEEK_PX, 0)).toBe(true);
    expect(isCanvasDrag(4, 40)).toBe(false);
    expect(progressRatio(50, { left: 0, width: 100 })).toBe(0.5);
  });
});
