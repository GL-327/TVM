import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const featuresDir = dirname(fileURLToPath(import.meta.url));

function featureSource(name: string): string | null {
  const path = join(featuresDir, `${name}.tsx`);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

describe('TransportBar focus ids', () => {
  const src = featureSource('TransportBar');

  it.skipIf(src === null)('declares stable transport focus ids', () => {
    expect(src).toContain('player-play');
    expect(src).toContain('player-seek-back');
    expect(src).toContain('player-seek-fwd');
    expect(src).toContain('player-back');
  });
});

describe('SkipRecap focus ids', () => {
  const src = featureSource('SkipRecap');

  it.skipIf(src === null)('declares the skip-recap focus id', () => {
    expect(src).toContain('player-skip-recap');
  });
});
