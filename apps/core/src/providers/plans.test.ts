import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPlanService, isPlanId } from './plans.ts';

describe('plans', () => {
  it('defaults to premium so mock apps are reachable', () => {
    const dir = join(tmpdir(), `tvm-plan-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const plans = createPlanService({ dataDir: dir });
    expect(plans.status()).toEqual({ id: 'premium', name: 'Premium', mocks: true, stream: 'premium' });
  });

  it('persists basic and TVM MAX', () => {
    const dir = join(tmpdir(), `tvm-plan-set-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const plans = createPlanService({ dataDir: dir });
    expect(plans.set('basic').mocks).toBe(false);
    expect(plans.status().stream).toBe('basic');
    expect(plans.set('tvm-max').stream).toBe('luxury');
    expect(isPlanId('tvm-max')).toBe(true);
    expect(isPlanId('gold')).toBe(false);
    writeFileSync(join(dir, 'plan.json'), '{"id":"premium"}');
  });
});
