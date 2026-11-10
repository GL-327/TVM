import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { desktopRuntime } from './desktopRuntime.ts';

describe('native Core identity', () => {
  it('returns only a valid non-secret identity, never filesystem contents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tvm-runtime-'));
    try {
      expect(desktopRuntime(dir)).toEqual({ protocol: 1, instanceId: '' });
      writeFileSync(join(dir, 'native-runtime-id'), 'A'.repeat(32));
      expect(desktopRuntime(dir)).toEqual({ protocol: 1, instanceId: 'A'.repeat(32) });
      writeFileSync(join(dir, 'native-runtime-id'), '/private/path\ncredentials');
      expect(desktopRuntime(dir)).toEqual({ protocol: 1, instanceId: '' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
