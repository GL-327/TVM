import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, 'MouseLayer.tsx'), 'utf8');

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
  });
});
