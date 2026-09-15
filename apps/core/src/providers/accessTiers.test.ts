import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCESS_TIERS, accessTier, entitlementForTier, ACCESS_ROUTE } from './accessTiers.ts';
import { createPlanService } from './plans.ts';

const dirs: string[] = [];
async function plans() {
  const dir = await mkdtemp(join(tmpdir(), 'tvm-tiers-'));
  dirs.push(dir);
  return createPlanService({ dataDir: dir });
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('what TVM offers', () => {
  it('is two tiers, separated only by Live TV', () => {
    expect(ACCESS_TIERS).toHaveLength(2);
    expect(ACCESS_TIERS.map((tier) => tier.id)).toEqual(['stream', 'stream-live']);
    expect(ACCESS_TIERS[0]!.liveTv).toBe(false);
    expect(ACCESS_TIERS[1]!.liveTv).toBe(true);
    // Both grant the same capabilities; Live TV is the only difference, which
    // is the only difference anyone is choosing between.
    expect(ACCESS_TIERS[0]!.planId).toBe(ACCESS_TIERS[1]!.planId);
  });

  it('offers no free tier and no advertising anywhere', () => {
    expect(ACCESS_TIERS.some((tier) => tier.monthlyPence === 0)).toBe(false);
    expect(JSON.stringify(ACCESS_TIERS)).not.toMatch(/\bads?\b/i);
  });

  it('carries the Live TV terms on the tier that includes it', () => {
    expect(accessTier('stream').liveTvTerms).toHaveLength(0);
    expect(accessTier('stream-live').liveTvTerms.map((term) => term.id)).toEqual(['quarter', 'year', 'lifetime']);
  });

  it('points at the owner rather than a checkout', () => {
    expect(ACCESS_ROUTE.detail).toMatch(/no checkout/i);
    expect(ACCESS_ROUTE.action).toMatch(/owner/i);
  });
});

describe('activating an account grants what the tier promises', () => {
  /**
   * The regression this file exists for.
   *
   * setLiveTv() deliberately throws when asked to switch Live TV on, because a
   * buyer is supposed to pick a term at checkout. There is no checkout any
   * more, so activation went through it and every request afterwards returned
   * a 500 — an account could be activated and then could not be read.
   */
  it('grants Live TV without going through a checkout that no longer exists', async () => {
    const service = await plans();
    const wanted = entitlementForTier('stream-live');
    expect(wanted.liveTv).toBe(true);

    // The path activation must not take.
    expect(() => service.setLiveTv(true)).toThrow();

    // The path it does take.
    service.set(wanted.planId, 'checkout');
    const status = service.grantLiveTv(true);
    expect(status.liveTv).toBe(true);
    expect(status.id).toBe('max');
  });

  it('gives the plain tier everything except Live TV', async () => {
    const service = await plans();
    const wanted = entitlementForTier('stream');
    service.set(wanted.planId, 'checkout');
    const status = service.grantLiveTv(false);
    expect(status.liveTv).toBe(false);
    expect(status.id).toBe('max');
    expect(status.maxHeight).toBe(2160);
    expect(status.ads).toBe(false);
  });

  it('takes Live TV back when the tier is downgraded', async () => {
    const service = await plans();
    service.set('max', 'checkout');
    expect(service.grantLiveTv(true).liveTv).toBe(true);
    expect(service.grantLiveTv(false).liveTv).toBe(false);
  });

  it('leaves nothing on the free entitlement, which is what no access means now', async () => {
    const service = await plans();
    const status = service.set('free', 'free');
    expect(status.liveTv).toBe(false);
    expect(status.ads).toBe(false);
  });
});
