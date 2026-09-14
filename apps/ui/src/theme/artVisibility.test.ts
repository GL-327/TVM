import { describe, expect, it } from 'vitest';
import { ART_NEAR_MARGIN } from './artVisibility';

describe('artwork overscan', () => {
  it('does not convert a whole catalog of offscreen rails', () => {
    expect(ART_NEAR_MARGIN).toBe('25% 120px');
    expect(ART_NEAR_MARGIN).not.toMatch(/100%|640px/);
  });
});
