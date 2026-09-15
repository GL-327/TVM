import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declineCharge } from './charges.ts';
import { tokenizeCard } from './cardVault.ts';
import { createPlanService } from './plans.ts';

describe('charges', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('declines a token as no_processor because nothing is linked', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-charge-'));
    dirs.push(dir);
    const minted = tokenizeCard(dir, {
      name: 'Ada Lovelace',
      number: '4242424242424242',
      expiry: '12/99',
      cvc: '123',
    });
    const result = declineCharge(minted.token);
    expect(result).toMatchObject({
      status: 'declined',
      reason: 'no_processor',
      code: 'not_configured',
      chargedPence: 0,
      last4: '4242',
      tokenId: minted.token.tokenId,
    });
    expect(JSON.stringify(result)).not.toContain('4242424242424242');
    expect(JSON.stringify(result)).not.toContain('123');
  });

  it('returns missing_token when no card was stored', () => {
    expect(declineCharge(null).reason).toBe('missing_token');
  });

  it('charges through the plan service without taking money', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-charge-plan-'));
    dirs.push(dir);
    const plans = createPlanService({ dataDir: dir });
    plans.checkout({
      planId: 'basic',
      consent: true,
      requestId: 'charge-order-1',
      name: 'Ada Lovelace',
      number: '4242424242424242',
      expiry: '12/99',
      cvc: '123',
    });
    const billed = plans.billing();
    expect(billed.processor).toMatchObject({ linked: false, mode: null, webhookConfigured: false });
    expect(billed.paymentMethod?.last4).toBe('4242');
    const charged = plans.charge({ tokenId: billed.paymentMethod?.tokenId });
    expect(charged.reason).toBe('no_processor');
    expect(charged.code).toBe('not_configured');
    expect(charged.chargedPence).toBe(0);
    expect(plans.status().id).toBe('basic');
  });
});
