import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

describe('player buffering indicator', () => {
  it('uses the TVM mark once and never a circular spinner', () => {
    const buffering = readFileSync(join(dir, 'Buffering.tsx'), 'utf8');
    const player = readFileSync(join(dir, '../../screens/Player.tsx'), 'utf8');
    expect(buffering).toContain('TvmMark');
    expect(buffering).toContain('animated');
    expect(buffering).toContain('loop');
    expect(buffering).not.toContain('tvm-buffering__arc');
    expect(buffering).not.toContain('tvm-buffering-spin');
    expect(player).not.toContain('player__loader');
    expect(player).not.toContain('BUFFER_STALLED_ERROR');
  });
});
