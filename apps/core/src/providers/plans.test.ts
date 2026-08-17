import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { cvcOk, expiryOk, lastFour, luhnOk } from './card.ts';
import { verifyDeveloperPassword } from './devUnlock.ts';
import { createPlanService, isPlanId, migratePlanId } from './plans.ts';
import { openJson, sealJson } from './vault.ts';
import { billingPath } from '../update/paths.ts';

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
    expect(existsSync(join(dir, 'plan.json'))).toBe(false);
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

  it('does not put the developer password in this module', () => {
    expect(verifyDeveloperPassword('wrong')).toBe(false);
    expect(verifyDeveloperPassword('')).toBe(false);
  });
});
