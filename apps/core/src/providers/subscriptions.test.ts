import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { subscriptionsPath } from '../update/paths.ts';
import {
  createSubscriptionService,
  grantsAccess,
  publicSubscription,
  stateFromStripe,
  type SubscriptionRecord,
} from './subscriptions.ts';
import { createBillingProbe, PROBE_MAX_CYCLES, PROBE_PENCE } from './billingProbe.ts';
import type { StripeClient } from './stripeClient.ts';

const dirs: string[] = [];
async function dataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tvm-subs-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function recordingPlans(monthlyPence = 1898) {
  const granted: Array<{ record: SubscriptionRecord; paid: number }> = [];
  const revoked: SubscriptionRecord[] = [];
  return {
    granted,
    revoked,
    port: {
      monthlyQuote: () => ({ planId: 'premium', liveTv: true, monthlyPence, description: 'TVM Premium with Live TV' }),
      grantMonthly: (record: SubscriptionRecord, paid: number) => { granted.push({ record, paid }); },
      revokeMonthly: (record: SubscriptionRecord) => { revoked.push(record); },
    },
  };
}

/** A Stripe stand-in. Nothing in this suite reaches the network. */
function fakeStripe(overrides: Partial<{ status: string; periodEnd: number; amount: number }> = {}) {
  const calls: Array<{ method: string; input: unknown }> = [];
  const state = {
    status: overrides.status ?? 'incomplete',
    periodEnd: overrides.periodEnd ?? Math.floor(Date.now() / 1000) + 2_592_000,
    amount: overrides.amount ?? 1898,
  };
  const sub = () => ({
    id: 'sub_test_1',
    status: state.status,
    currentPeriodEnd: state.periodEnd,
    cancelAtPeriodEnd: false,
    amountPence: state.amount,
    customerId: 'cus_test_1',
    latestInvoiceId: 'in_1',
    clientSecret: 'pi_1_secret_x',
    paymentIntentId: 'pi_1',
    metadata: {},
  });
  const client = {
    mode: 'test' as const,
    async createCustomer(input: unknown) { calls.push({ method: 'createCustomer', input }); return { id: 'cus_test_1' }; },
    async createSubscription(input: unknown) { calls.push({ method: 'createSubscription', input }); return sub(); },
    async retrieveSubscription(id: string) { calls.push({ method: 'retrieveSubscription', input: id }); return sub(); },
    async cancelSubscription(input: { atPeriodEnd: boolean }) {
      calls.push({ method: 'cancelSubscription', input });
      return { ...sub(), cancelAtPeriodEnd: input.atPeriodEnd, status: input.atPeriodEnd ? state.status : 'canceled' };
    },
    async createPaymentIntent(input: unknown) {
      calls.push({ method: 'createPaymentIntent', input });
      const amount = (input as { amountPence: number }).amountPence;
      return { id: 'pi_probe_1', clientSecret: null, status: 'succeeded', amount, currency: 'gbp', amountReceived: amount, metadata: {}, latestChargeId: 'ch', receiptUrl: null, livemode: false };
    },
    async refund(input: { amountPence?: number }) {
      calls.push({ method: 'refund', input });
      return { id: 're_1', status: 'succeeded', amount: input.amountPence ?? 0 };
    },
    async ping() { return { ok: true as const }; },
  };
  return { calls, state, client: client as unknown as StripeClient };
}

describe('what counts as a paying subscriber', () => {
  it('grants while active, and keeps granting while a retry is in flight', () => {
    // Stripe retries a failed renewal for days. Cutting access off the instant
    // a bank declined a payment the customer will make on the retry is hostile
    // and loses the recovery.
    const base = { subscriptionId: 's', customerId: 'c', planId: 'premium', liveTv: true, amountPence: 1898, currency: 'GBP' as const, currentPeriodEnd: 0, cancelAtPeriodEnd: false, createdAt: '', invoices: [], lastError: null };
    expect(grantsAccess({ ...base, state: 'active' })).toBe(true);
    expect(grantsAccess({ ...base, state: 'past_due' })).toBe(true);
    // Nothing has been paid yet.
    expect(grantsAccess({ ...base, state: 'incomplete' })).toBe(false);
    expect(grantsAccess({ ...base, state: 'canceled' })).toBe(false);
    expect(grantsAccess(null)).toBe(false);
  });

  it('maps every Stripe status onto a state the app acts on', () => {
    expect(stateFromStripe('active')).toBe('active');
    expect(stateFromStripe('trialing')).toBe('active');
    expect(stateFromStripe('past_due')).toBe('past_due');
    expect(stateFromStripe('unpaid')).toBe('past_due');
    expect(stateFromStripe('incomplete')).toBe('incomplete');
    expect(stateFromStripe('incomplete_expired')).toBe('canceled');
    expect(stateFromStripe('canceled')).toBe('canceled');
    // An unknown status must never grant by accident.
    expect(grantsAccess({ subscriptionId: 's', customerId: 'c', planId: 'p', liveTv: false, amountPence: 1, currency: 'GBP', state: stateFromStripe('something_new'), currentPeriodEnd: 0, cancelAtPeriodEnd: false, createdAt: '', invoices: [], lastError: null })).toBe(false);
  });
});

describe('starting a subscription', () => {
  it('creates a recurring price at the catalogue figure and grants nothing yet', async () => {
    const dir = await dataDir();
    const plans = recordingPlans(1898);
    const stripe = fakeStripe();
    const subs = createSubscriptionService({ dataDir: dir, plans: plans.port, client: () => stripe.client });

    const begun = await subs.begin({ planId: 'premium', liveTv: true, requestId: 'req_abcdefgh' });
    expect(begun.amountPence).toBe(1898);

    const created = stripe.calls.find((call) => call.method === 'createSubscription');
    expect((created?.input as { amountPence: number }).amountPence).toBe(1898);
    // default_incomplete: the plan must not exist until the first payment does.
    expect(plans.granted).toHaveLength(0);
    expect(subs.current().state).toBe('incomplete');
  });

  it('refuses a second subscription while one is already running', async () => {
    const dir = await dataDir();
    const plans = recordingPlans();
    const stripe = fakeStripe({ status: 'active' });
    const subs = createSubscriptionService({ dataDir: dir, plans: plans.port, client: () => stripe.client });
    await subs.begin({ planId: 'premium', requestId: 'req_abcdefgh' });
    await subs.confirm();
    await expect(subs.begin({ planId: 'ultra', requestId: 'req_ijklmnop' })).rejects.toThrow(/already has an active monthly plan/);
  });

  it('will not bill a free plan', async () => {
    const dir = await dataDir();
    const plans = recordingPlans(0);
    const stripe = fakeStripe();
    const subs = createSubscriptionService({ dataDir: dir, plans: plans.port, client: () => stripe.client });
    await expect(subs.begin({ planId: 'free', requestId: 'req_abcdefgh' })).rejects.toThrow(/free plan has nothing to bill/);
  });

  it('grants only once Stripe itself reports the subscription active', async () => {
    const dir = await dataDir();
    const plans = recordingPlans();
    const stripe = fakeStripe({ status: 'incomplete' });
    const subs = createSubscriptionService({ dataDir: dir, plans: plans.port, client: () => stripe.client });
    await subs.begin({ planId: 'premium', requestId: 'req_abcdefgh' });

    expect((await subs.confirm()).state).toBe('incomplete');
    expect(plans.granted).toHaveLength(0);

    stripe.state.status = 'active';
    expect((await subs.confirm()).state).toBe('active');
    expect(plans.granted).toHaveLength(1);
  });
});

describe('renewals', () => {
  async function started() {
    const dir = await dataDir();
    const plans = recordingPlans();
    const stripe = fakeStripe({ status: 'active' });
    const subs = createSubscriptionService({ dataDir: dir, plans: plans.port, client: () => stripe.client });
    await subs.begin({ planId: 'premium', requestId: 'req_abcdefgh' });
    await subs.confirm();
    return { dir, plans, stripe, subs };
  }

  it('extends the plan when next month is paid', async () => {
    const { plans, subs } = await started();
    const before = plans.granted.length;
    await subs.applyEvent('invoice.paid', { id: 'in_2', subscription: 'sub_test_1', amount_paid: 1898 }, 'evt_2');
    expect(plans.granted.length).toBe(before + 1);
    expect(subs.current().renewals).toBe(1);
  });

  it('counts a redelivered renewal once', async () => {
    // Stripe redelivers on its own schedule; a second grant would be a free month.
    const { plans, subs } = await started();
    const before = plans.granted.length;
    await subs.applyEvent('invoice.paid', { id: 'in_2', subscription: 'sub_test_1', amount_paid: 1898 }, 'evt_2');
    await subs.applyEvent('invoice.paid', { id: 'in_2', subscription: 'sub_test_1', amount_paid: 1898 }, 'evt_2');
    expect(plans.granted.length).toBe(before + 1);
    expect(subs.current().renewals).toBe(1);
  });

  it('ignores an invoice belonging to a different subscription', async () => {
    const { plans, subs } = await started();
    const before = plans.granted.length;
    const result = await subs.applyEvent('invoice.paid', { id: 'in_x', subscription: 'sub_someone_else', amount_paid: 1898 }, 'evt_x');
    expect(result.handled).toBe('other_subscription');
    expect(plans.granted.length).toBe(before);
  });

  it('marks a failed renewal past due without cutting access off', async () => {
    const { plans, subs } = await started();
    await subs.applyEvent('invoice.payment_failed', { id: 'in_3', subscription: 'sub_test_1' }, 'evt_3');
    const state = subs.current();
    expect(state.state).toBe('past_due');
    expect(state.lastError).toMatch(/declined/i);
    expect(plans.revoked).toHaveLength(0);
  });

  it('takes the plan back when the subscription is deleted', async () => {
    const { plans, subs } = await started();
    await subs.applyEvent('customer.subscription.deleted', { id: 'sub_test_1' }, 'evt_4');
    expect(subs.current().state).toBe('canceled');
    expect(plans.revoked).toHaveLength(1);
  });
});

describe('cancelling', () => {
  it('keeps the month already paid for', async () => {
    const dir = await dataDir();
    const plans = recordingPlans();
    const stripe = fakeStripe({ status: 'active' });
    const subs = createSubscriptionService({ dataDir: dir, plans: plans.port, client: () => stripe.client });
    await subs.begin({ planId: 'premium', requestId: 'req_abcdefgh' });
    await subs.confirm();

    const after = await subs.cancel(true);
    expect(after.cancelAtPeriodEnd).toBe(true);
    // Still paid up, so still watching.
    expect(after.state).toBe('active');
    expect(plans.revoked).toHaveLength(0);
  });

  it('ends access immediately when asked to', async () => {
    const dir = await dataDir();
    const plans = recordingPlans();
    const stripe = fakeStripe({ status: 'active' });
    const subs = createSubscriptionService({ dataDir: dir, plans: plans.port, client: () => stripe.client });
    await subs.begin({ planId: 'premium', requestId: 'req_abcdefgh' });
    await subs.confirm();

    const after = await subs.cancel(false);
    expect(after.state).toBe('canceled');
    expect(plans.revoked).toHaveLength(1);
  });
});

describe('the subscription ledger on disk', () => {
  it('is encrypted', async () => {
    const dir = await dataDir();
    const plans = recordingPlans();
    const stripe = fakeStripe();
    const subs = createSubscriptionService({ dataDir: dir, plans: plans.port, client: () => stripe.client });
    await subs.begin({ planId: 'premium', requestId: 'req_abcdefgh' });
    const blob = readFileSync(subscriptionsPath(dir), 'utf8');
    expect(blob).not.toContain('sub_test_1');
    expect(blob).not.toContain('cus_test_1');
    expect(subs.record()?.subscriptionId).toBe('sub_test_1');
  });

  it('reports nothing rather than guessing when there is no subscription', () => {
    expect(publicSubscription(null)).toMatchObject({ state: 'none', nextChargeAt: null, renewals: 0 });
  });
});

describe('the developer billing probe', () => {
  function probe(overrides: Partial<{ developer: boolean; customerId: string | null }> = {}) {
    const stripe = fakeStripe();
    const instance = createBillingProbe({
      client: () => stripe.client,
      customerId: () => (overrides.customerId === undefined ? 'cus_test_1' : overrides.customerId),
      developer: () => overrides.developer !== false,
      mode: () => 'test',
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    return { stripe, instance };
  }

  it('charges a penny off-session and refunds all of it', async () => {
    const { stripe, instance } = probe();
    await instance.runOnce();
    const charge = stripe.calls.find((call) => call.method === 'createPaymentIntent');
    const input = charge?.input as { amountPence: number; offSession: boolean; confirm: boolean; customerId: string };
    expect(input.amountPence).toBe(PROBE_PENCE);
    // Off-session is the whole point: it exercises the path a renewal takes,
    // with nobody present to confirm anything.
    expect(input.offSession).toBe(true);
    expect(input.confirm).toBe(true);
    expect(input.customerId).toBe('cus_test_1');

    const refund = stripe.calls.find((call) => call.method === 'refund');
    expect((refund?.input as { amountPence: number }).amountPence).toBe(PROBE_PENCE);
    expect(instance.status().history[0]).toMatchObject({ ok: true, chargedPence: 1, refundedPence: 1 });
  });

  it('refuses to run outside developer mode', () => {
    const { instance } = probe({ developer: false });
    expect(() => instance.start()).toThrow(/developer_required/);
  });

  it('stops rather than billing when no card has ever been saved', async () => {
    const { stripe, instance } = probe({ customerId: null });
    await instance.runOnce();
    expect(stripe.calls.filter((call) => call.method === 'createPaymentIntent')).toHaveLength(0);
    expect(instance.status().stoppedReason).toMatch(/Subscribe first/);
  });

  it('is capped, so it cannot keep looking like card testing forever', () => {
    // Repeated tiny charges followed by refunds are exactly the pattern
    // Stripe's fraud checks flag, so the loop has a hard end.
    expect(PROBE_MAX_CYCLES).toBeLessThanOrEqual(60);
    expect(PROBE_PENCE).toBe(1);
  });
});
