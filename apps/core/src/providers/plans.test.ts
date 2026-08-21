import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { cvcOk, expiryOk, lastFour, luhnOk } from './card.ts';
import { createDevUnlockService, verifyDeveloperPassword } from './devUnlock.ts';
import { createPlanService, formatGbp, isPlanId, migratePlanId } from './plans.ts';
import { openJson, sealJson, writeSealed } from './vault.ts';
import { billingPath, devUnlockFlagPath, devUnlockPath } from '../update/paths.ts';

describe('card checks', () => {
  it('accepts a Luhn-valid number and rejects junk', () => {
    expect(luhnOk('4242424242424242')).toBe(true);
    expect(luhnOk('4242 4242 4242 4242')).toBe(true);
    expect(luhnOk('1234567890123456')).toBe(false);
    expect(luhnOk('abc')).toBe(false);
    expect(lastFour('4242 4242 4242 4242')).toBe('4242');
  });

  it('checks expiry and CVC', () => {
    expect(expiryOk('12/99', new Date('2026-08-17'))).toBe(true);
    expect(expiryOk('01/20', new Date('2026-08-17'))).toBe(false);
    expect(cvcOk('123')).toBe(true);
    expect(cvcOk('12')).toBe(false);
  });
});

describe('vault', () => {
  it('round-trips JSON and refuses tampering', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-vault-'));
    try {
      const blob = sealJson(dir, { secret: 'no-log' });
      expect(blob).not.toContain('no-log');
      expect(openJson<{ secret: string }>(dir, blob)).toEqual({ secret: 'no-log' });
      expect(openJson(dir, 'not-base64')).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('plans', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('formats sterling list prices', () => {
    expect(formatGbp(0)).toBe('Free');
    expect(formatGbp(300)).toBe('£3.00');
    expect(formatGbp(799)).toBe('£7.99');
  });

  it('defaults to Free and migrates tvm-max', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-plan-'));
    dirs.push(dir);
    const plans = createPlanService({ dataDir: dir });
    expect(plans.status().id).toBe('free');
    expect(plans.status().mocks).toBe(false);
    expect(plans.status().weeklySeconds).toBe(12 * 60 * 60);
    expect(migratePlanId('tvm-max')).toBe('max');
    expect(isPlanId('gold')).toBe(false);

    await writeFile(join(dir, 'plan.json'), '{"id":"tvm-max"}');
    const migrated = createPlanService({ dataDir: dir });
    expect(migrated.status().id).toBe('max');
    expect(migrated.status().liveTv).toBe(true);
    expect(migrated.status().pricePence).toBe(1899);
    expect(existsSync(join(dir, 'plan.json'))).toBe(true);
  });

  it('keeps a checked-out plan across a new service instance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-plan-persist-'));
    dirs.push(dir);
    const first = createPlanService({ dataDir: dir });
    const status = first.checkout({
      planId: 'ultra',
      name: 'Arthur Foxall',
      number: '4242424242424242',
      expiry: '12/99',
      cvc: '123',
      liveTv: true,
    });
    expect(status.id).toBe('ultra');
    expect(status.maxHeight).toBe(2160);

    const second = createPlanService({ dataDir: dir });
    expect(second.status().id).toBe('ultra');
    expect(second.status().liveTv).toBe(true);
    expect(second.status().maxHeight).toBe(2160);
    expect(second.status().pricePence).toBe(1599);
  });

  it('restores the plan from the snapshot if the vault cannot be opened', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-plan-snap-'));
    dirs.push(dir);
    const first = createPlanService({ dataDir: dir });
    first.checkout({
      planId: 'premium',
      name: 'Arthur Foxall',
      number: '4242424242424242',
      expiry: '12/99',
      cvc: '123',
      liveTv: false,
    });
    const { unlinkSync } = await import('node:fs');
    try {
      unlinkSync(join(dir, 'secrets', 'entitlement.enc'));
    } catch {
      // Snapshot must still be enough.
    }
    const second = createPlanService({ dataDir: dir });
    expect(second.status().id).toBe('premium');
    expect(second.status().liveTv).toBe(false);
  });

  it('checks out Basic without storing the card number', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-bill-'));
    dirs.push(dir);
    const plans = createPlanService({ dataDir: dir });
    const status = plans.checkout({
      planId: 'basic',
      name: 'Arthur Foxall',
      number: '4242424242424242',
      expiry: '12/99',
      cvc: '123',
    });
    expect(status.id).toBe('basic');
    expect(status.queueSkipToTop).toBe(true);
    expect(status.liveTv).toBe(true);
    expect(status.pricePence).toBe(799);
    expect(status.price).toBe('£7.99');
    const blob = readFileSync(billingPath(dir), 'utf8');
    expect(blob).not.toContain('4242424242424242');
    expect(JSON.stringify(plans.receipt())).not.toContain('4242424242424242');
    expect(plans.receipt()?.last4).toBe('4242');
    expect(plans.receipt()?.mock).toBe(true);
  });

  it('rejects a bad card and does not change plan', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-bill-bad-'));
    dirs.push(dir);
    const plans = createPlanService({ dataDir: dir });
    expect(() =>
      plans.checkout({ planId: 'premium', name: 'A', number: '1111', expiry: '12/99', cvc: '123' }),
    ).toThrow(/name on the card/);
    expect(() =>
      plans.checkout({
        planId: 'premium',
        name: 'Arthur',
        number: '1111111111111111',
        expiry: '12/99',
        cvc: '123',
      }),
    ).toThrow(/card number/);
    expect(plans.status().id).toBe('free');
  });

  it('counts billable watch time and ignores ads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-hours-'));
    dirs.push(dir);
    const plans = createPlanService({ dataDir: dir });
    plans.tickUsage(60, false);
    expect(plans.status().weeklyUsedSeconds).toBe(0);
    plans.tickUsage(90, true);
    expect(plans.status().weeklyUsedSeconds).toBe(90);
    expect(plans.hoursBlocked()).toBe(false);
    plans.tickUsage(12 * 60 * 60, true);
    expect(plans.hoursBlocked()).toBe(true);
  });

  it('includes Live TV on paid plans and drops the old price when it is removed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-addon-'));
    dirs.push(dir);
    const plans = createPlanService({ dataDir: dir });
    expect(plans.status().liveTv).toBe(false);
    expect(plans.status().pricePence).toBe(0);

    const withLive = plans.checkout({
      planId: 'premium',
      name: 'Arthur Foxall',
      number: '4242424242424242',
      expiry: '12/99',
      cvc: '123',
    });
    expect(withLive.liveTv).toBe(true);
    expect(withLive.pricePence).toBe(1199);
    expect(withLive.price).toBe('£11.99');
    expect(withLive.basePricePence).toBe(899);
    expect(withLive.extras[0]).toMatch(/Live TV/);

    const without = plans.checkout({
      planId: 'premium',
      name: 'Arthur Foxall',
      number: '4242424242424242',
      expiry: '12/99',
      cvc: '123',
      liveTv: false,
    });
    expect(without.liveTv).toBe(false);
    expect(without.pricePence).toBe(899);
    expect(without.price).toBe('£8.99');
    expect(without.extras.some((line) => line.startsWith('Live TV'))).toBe(false);

    const restored = plans.setLiveTv(true);
    expect(restored.liveTv).toBe(true);
    expect(restored.pricePence).toBe(1199);

    plans.set('free', 'free');
    expect(() => plans.setLiveTv(true)).toThrow(/paid add-on/);
  });

  it('does not put the developer password in this module', () => {
    expect(verifyDeveloperPassword('wrong')).toBe(false);
    expect(verifyDeveloperPassword('')).toBe(false);
  });

  it('keeps developer unlock across a new service instance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-dev-persist-'));
    dirs.push(dir);
    writeSealed(dir, devUnlockPath(dir), { unlocked: true, at: '2026-08-17T00:00:00.000Z' });
    await writeFile(devUnlockFlagPath(dir), JSON.stringify({ unlocked: true, at: '2026-08-17T00:00:00.000Z' }));

    const first = createDevUnlockService({ dataDir: dir });
    expect(first.unlocked()).toBe(true);
    const plans = createPlanService({ dataDir: dir, developer: () => first.unlocked() });
    expect(plans.status().developer).toBe(true);

    const second = createDevUnlockService({ dataDir: dir });
    const again = createPlanService({ dataDir: dir, developer: () => second.unlocked() });
    expect(second.unlocked()).toBe(true);
    expect(again.status().developer).toBe(true);

    second.lock();
    const locked = createDevUnlockService({ dataDir: dir });
    expect(locked.unlocked()).toBe(false);
  });

  it('sells Synthwave as its own pack on any plan, and unlocks it in developer mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-synth-'));
    dirs.push(dir);
    const plans = createPlanService({ dataDir: dir, developer: () => false });
    expect(plans.status().synthwave).toBe(false);
    expect(plans.status().synthwaveAddonPence).toBe(499);
    expect(() => plans.setSynthwave(true)).toThrow(/paid pack/);

    const paid = plans.checkout({
      planId: 'basic',
      name: 'Arthur Foxall',
      number: '4242424242424242',
      expiry: '12/99',
      cvc: '123',
      liveTv: false,
      synthwave: true,
    });
    expect(paid.synthwave).toBe(true);
    expect(paid.pricePence).toBe(998);
    expect(paid.extras.some((line) => line.includes('Colourcast'))).toBe(true);

    const off = plans.setSynthwave(false);
    expect(off.synthwave).toBe(false);
    expect(off.pricePence).toBe(499);

    const freeDir = await mkdtemp(join(tmpdir(), 'tvm-synth-dev-'));
    dirs.push(freeDir);
    const unlocked = createPlanService({ dataDir: freeDir, developer: () => true });
    expect(unlocked.status().synthwave).toBe(true);
    expect(unlocked.status().pricePence).toBe(0);
    unlocked.setSynthwave(true);
    expect(unlocked.status().pricePence).toBe(499);
  });
});
