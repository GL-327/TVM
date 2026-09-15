import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stripeKeysPath, paymentsLedgerPath } from '../update/paths.ts';
import { createPaymentService, type OrderQuote, type PaymentOrder, type SettledPayment } from './payments.ts';
import { encodeForm, parsePaymentIntent, verifyWebhookSignature } from './stripeClient.ts';
import { keyMode, loadStripeConfig, publicStripeStatus, redact, saveStripeConfig } from './stripeConfig.ts';

// Assembled from parts rather than written out. These are invented values, but
// a literal sk_live_… in a source file is what GitHub's push protection looks
// for, and a repository carrying key-shaped strings teaches everyone to wave
// the scanner through — which is how a real key eventually gets committed.
const BODY = '51abcdefghijklmnopqrstuvwx';
const TEST_SECRET = ['sk', 'test', BODY].join('_');
const TEST_PUBLISHABLE = ['pk', 'test', BODY].join('_');
const LIVE_SECRET = ['sk', 'live', BODY].join('_');
const LIVE_PUBLISHABLE = ['pk', 'live', BODY].join('_');
const WEBHOOK_SECRET = ['whsec', 'abcdefghijklmnopqrstuvwxyz123456'].join('_');
const OTHER_WEBHOOK_SECRET = ['whsec', 'someoneelsessecretvalue000000000'].join('_');
const ATTACKER_WEBHOOK_SECRET = ['whsec', 'attackerchosensecretvalue0000000'].join('_');

const dirs: string[] = [];
async function dataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tvm-payments-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A plan port that records what it was asked to do, with a fixed £12.99 order. */
function recordingPlans(amountPence = 1299) {
  const granted: Array<{ order: PaymentOrder; payment: SettledPayment }> = [];
  const revoked: PaymentOrder[] = [];
  const quote: OrderQuote = {
    planId: 'ultra',
    fingerprint: 'fp-ultra',
    monthlyPence: amountPence,
    oneTimePence: 0,
    amountPence,
    liveTv: false,
    anime: false,
    bundle: false,
    synthwave: false,
    packOnly: false,
    description: 'TVM — TVM Ultra',
  };
  return {
    granted,
    revoked,
    port: {
      quote: () => quote,
      grant: (order: PaymentOrder, payment: SettledPayment) => { granted.push({ order, payment }); },
      revoke: (order: PaymentOrder) => { revoked.push(order); },
    },
  };
}

/** A Stripe stand-in. No test in this suite reaches the network. */
function fakeStripe(overrides: Partial<{
  intentStatus: string;
  amountReceived: number;
  intentId: string;
}> = {}) {
  const calls: Array<{ method: string; input: unknown }> = [];
  const state = {
    intentStatus: overrides.intentStatus ?? 'succeeded',
    amountReceived: overrides.amountReceived,
    intentId: overrides.intentId ?? 'pi_test_123',
  };
  const client = {
    mode: 'test' as const,
    async createPaymentIntent(input: { amountPence: number; idempotencyKey: string; metadata: Record<string, string> }) {
      calls.push({ method: 'createPaymentIntent', input });
      return {
        id: state.intentId,
        clientSecret: `${state.intentId}_secret_xyz`,
        status: 'requires_payment_method',
        amount: input.amountPence,
        currency: 'gbp',
        amountReceived: 0,
        metadata: input.metadata,
        latestChargeId: null,
        receiptUrl: null,
        livemode: false,
      };
    },
    async retrievePaymentIntent(id: string) {
      calls.push({ method: 'retrievePaymentIntent', input: id });
      return {
        id,
        clientSecret: `${id}_secret_xyz`,
        status: state.intentStatus,
        amount: 1299,
        currency: 'gbp',
        amountReceived: state.amountReceived ?? (state.intentStatus === 'succeeded' ? 1299 : 0),
        metadata: {},
        latestChargeId: 'ch_1',
        receiptUrl: 'https://pay.stripe.com/receipts/test',
        livemode: false,
      };
    },
    async refund(input: { paymentIntentId: string; amountPence?: number }) {
      calls.push({ method: 'refund', input });
      return { id: 're_1', status: 'succeeded', amount: input.amountPence ?? 1299 };
    },
    async ping() { return { ok: true as const }; },
  };
  return { calls, state, factory: () => client as never };
}

async function configured(dir: string, keys = { secretKey: TEST_SECRET, publishableKey: TEST_PUBLISHABLE, webhookSecret: WEBHOOK_SECRET }) {
  const saved = saveStripeConfig(dir, keys);
  expect(saved.configured).toBe(true);
}

function signed(payload: string, secret = WEBHOOK_SECRET, at = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac('sha256', secret).update(`${at}.${payload}`, 'utf8').digest('hex');
  return `t=${at},v1=${signature}`;
}

describe('stripe key handling', () => {
  it('refuses a live secret paired with a test publishable key', async () => {
    const dir = await dataDir();
    const state = saveStripeConfig(dir, { secretKey: LIVE_SECRET, publishableKey: TEST_PUBLISHABLE });
    expect(state.configured).toBe(false);
    if (!state.configured) expect(state.reason).toBe('mismatched_mode');
  });

  it('rejects keys that are not Stripe keys at all', async () => {
    const dir = await dataDir();
    expect(saveStripeConfig(dir, { secretKey: 'hunter2', publishableKey: TEST_PUBLISHABLE }).configured).toBe(false);
    expect(saveStripeConfig(dir, { secretKey: TEST_SECRET, publishableKey: 'nope' }).configured).toBe(false);
    expect(saveStripeConfig(dir, { secretKey: TEST_SECRET, publishableKey: TEST_PUBLISHABLE, webhookSecret: 'bad' }).configured).toBe(false);
  });

  it('tells test and live apart', () => {
    expect(keyMode(TEST_SECRET)).toBe('test');
    expect(keyMode(LIVE_SECRET)).toBe('live');
    expect(keyMode('rk_other_x')).toBeNull();
  });

  it('seals the secret key on disk and never publishes it', async () => {
    const dir = await dataDir();
    await configured(dir);

    // On disk: encrypted, so the key cannot be read out of the data directory.
    const blob = readFileSync(stripeKeysPath(dir), 'utf8');
    expect(blob).not.toContain(TEST_SECRET);
    expect(blob).not.toContain(WEBHOOK_SECRET);

    // Over the wire: only the publishable key, which is designed to be public.
    const status = publicStripeStatus(loadStripeConfig(dir, {}));
    expect(status).toMatchObject({ configured: true, mode: 'test', publishableKey: TEST_PUBLISHABLE, webhookConfigured: true });
    expect(JSON.stringify(status)).not.toContain(TEST_SECRET);
    expect(JSON.stringify(status)).not.toContain(WEBHOOK_SECRET);
  });

  it('lets the environment override the sealed file', async () => {
    const dir = await dataDir();
    await configured(dir);
    const state = loadStripeConfig(dir, { STRIPE_SECRET_KEY: LIVE_SECRET, STRIPE_PUBLISHABLE_KEY: LIVE_PUBLISHABLE });
    expect(state.configured).toBe(true);
    if (state.configured) expect(state.config.mode).toBe('live');
  });

  it('redacts secrets that reach a message', () => {
    expect(redact(`failed with ${TEST_SECRET}`)).toBe('failed with sk_test_***');
    expect(redact(`sig ${WEBHOOK_SECRET}`)).toBe('sig whsec_***');
  });
});

describe('webhook signatures', () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' });

  it('accepts a correctly signed body', () => {
    const result = verifyWebhookSignature({ payload, header: signed(payload), secret: WEBHOOK_SECRET });
    expect(result.ok).toBe(true);
  });

  it('rejects a body that was altered after signing', () => {
    const header = signed(payload);
    const tampered = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', extra: true });
    const result = verifyWebhookSignature({ payload: tampered, header, secret: WEBHOOK_SECRET });
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects a signature made with the wrong secret', () => {
    const header = signed(payload, OTHER_WEBHOOK_SECRET);
    expect(verifyWebhookSignature({ payload, header, secret: WEBHOOK_SECRET })).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects a replay from outside the tolerance window', () => {
    const old = Math.floor(Date.now() / 1000) - 4000;
    expect(verifyWebhookSignature({ payload, header: signed(payload, WEBHOOK_SECRET, old), secret: WEBHOOK_SECRET }))
      .toEqual({ ok: false, reason: 'timestamp_outside_tolerance' });
  });

  it('rejects a missing or malformed header', () => {
    expect(verifyWebhookSignature({ payload, header: undefined, secret: WEBHOOK_SECRET }).ok).toBe(false);
    expect(verifyWebhookSignature({ payload, header: 'nonsense', secret: WEBHOOK_SECRET }).ok).toBe(false);
    expect(verifyWebhookSignature({ payload, header: 't=123', secret: WEBHOOK_SECRET }).ok).toBe(false);
  });
});

describe('form encoding', () => {
  it('nests objects the way Stripe expects and drops empty values', () => {
    expect(encodeForm({ amount: 1299, metadata: { planId: 'ultra' }, missing: undefined, blank: null }))
      .toBe('amount=1299&metadata%5BplanId%5D=ultra');
    expect(encodeForm({ expand: ['latest_charge'] })).toBe('expand%5B0%5D=latest_charge');
  });

  it('reads an intent whose charge is expanded or just an id', () => {
    expect(parsePaymentIntent({ id: 'pi_1', status: 'succeeded', amount_received: 1299, latest_charge: { id: 'ch_1', receipt_url: 'https://r' } }))
      .toMatchObject({ id: 'pi_1', amountReceived: 1299, latestChargeId: 'ch_1', receiptUrl: 'https://r' });
    expect(parsePaymentIntent({ id: 'pi_2', latest_charge: 'ch_2' })).toMatchObject({ latestChargeId: 'ch_2', receiptUrl: null });
  });
});

describe('taking a payment', () => {
  it('charges the catalogue price, not a figure the client sent', async () => {
    const dir = await dataDir();
    await configured(dir);
    const plans = recordingPlans(1299);
    const stripe = fakeStripe();
    const payments = createPaymentService({ dataDir: dir, plans: plans.port, env: {}, clientFactory: stripe.factory });

    const begun = await payments.begin({ planId: 'ultra', requestId: 'req_abcdefgh', amountPence: 1 });
    expect(begun.amountPence).toBe(1299);
    const created = stripe.calls.find((call) => call.method === 'createPaymentIntent');
    expect((created?.input as { amountPence: number }).amountPence).toBe(1299);
    // Nothing is granted merely by opening a payment.
    expect(plans.granted).toHaveLength(0);
  });

  it('reuses one intent for a repeated request id so a double tap cannot double charge', async () => {
    const dir = await dataDir();
    await configured(dir);
    const plans = recordingPlans();
    const stripe = fakeStripe();
    const payments = createPaymentService({ dataDir: dir, plans: plans.port, env: {}, clientFactory: stripe.factory });

    const first = await payments.begin({ planId: 'ultra', requestId: 'req_abcdefgh' });
    const second = await payments.begin({ planId: 'ultra', requestId: 'req_abcdefgh' });
    expect(second.paymentIntentId).toBe(first.paymentIntentId);
    expect(stripe.calls.filter((call) => call.method === 'createPaymentIntent')).toHaveLength(1);
    // Stripe is also given an idempotency key, so even a retried HTTP call is safe.
    expect((stripe.calls[0]?.input as { idempotencyKey: string }).idempotencyKey).toBe('tvm_checkout_req_abcdefgh');
  });

  it('grants only once across the webhook and the browser coming back', async () => {
    const dir = await dataDir();
    await configured(dir);
    const plans = recordingPlans();
    const stripe = fakeStripe();
    const payments = createPaymentService({ dataDir: dir, plans: plans.port, env: {}, clientFactory: stripe.factory });
    const begun = await payments.begin({ planId: 'ultra', requestId: 'req_abcdefgh' });

    const event = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: begun.paymentIntentId } } });
    expect(await payments.webhook(event, signed(event))).toMatchObject({ ok: true, handled: 'payment_intent.succeeded' });
    // Stripe redelivers; the browser also returns. Neither may grant again.
    expect(await payments.webhook(event, signed(event))).toMatchObject({ ok: true, handled: 'duplicate' });
    await payments.confirm(begun.paymentIntentId);

    expect(plans.granted).toHaveLength(1);
    expect(plans.granted[0]?.payment.chargedPence).toBe(1299);
    expect(payments.order(begun.paymentIntentId)).toMatchObject({ status: 'paid', chargedPence: 1299 });
  });

  it('grants nothing when the amount Stripe received falls short', async () => {
    const dir = await dataDir();
    await configured(dir);
    const plans = recordingPlans(1299);
    const stripe = fakeStripe({ amountReceived: 99 });
    const payments = createPaymentService({ dataDir: dir, plans: plans.port, env: {}, clientFactory: stripe.factory });
    const begun = await payments.begin({ planId: 'ultra', requestId: 'req_abcdefgh' });

    await payments.confirm(begun.paymentIntentId);
    expect(plans.granted).toHaveLength(0);
    expect(payments.order(begun.paymentIntentId)?.status).toBe('pending');
  });

  it('grants nothing on an unsigned or wrongly signed webhook', async () => {
    const dir = await dataDir();
    await configured(dir);
    const plans = recordingPlans();
    const stripe = fakeStripe();
    const payments = createPaymentService({ dataDir: dir, plans: plans.port, env: {}, clientFactory: stripe.factory });
    const begun = await payments.begin({ planId: 'ultra', requestId: 'req_abcdefgh' });

    const event = JSON.stringify({ id: 'evt_2', type: 'payment_intent.succeeded', data: { object: { id: begun.paymentIntentId } } });
    expect(await payments.webhook(event, undefined)).toMatchObject({ ok: false, reason: 'missing_signature' });
    expect(await payments.webhook(event, 't=1,v1=deadbeef')).toMatchObject({ ok: false });
    expect(await payments.webhook(event, signed(event, ATTACKER_WEBHOOK_SECRET))).toMatchObject({ ok: false, reason: 'signature_mismatch' });
    expect(plans.granted).toHaveLength(0);
  });

  it('does not grant a plan that was never paid for', async () => {
    const dir = await dataDir();
    await configured(dir);
    const plans = recordingPlans();
    const stripe = fakeStripe({ intentStatus: 'requires_payment_method' });
    const payments = createPaymentService({ dataDir: dir, plans: plans.port, env: {}, clientFactory: stripe.factory });
    const begun = await payments.begin({ planId: 'ultra', requestId: 'req_abcdefgh' });

    expect((await payments.confirm(begun.paymentIntentId)).status).toBe('pending');
    expect(plans.granted).toHaveLength(0);
  });

  it('refuses a payment reference that belongs to no order', async () => {
    const dir = await dataDir();
    await configured(dir);
    const plans = recordingPlans();
    const payments = createPaymentService({ dataDir: dir, plans: plans.port, env: {}, clientFactory: fakeStripe().factory });
    await expect(payments.confirm('pi_never_seen')).rejects.toThrow(/No order matches/);
    await expect(payments.confirm('not-a-reference')).rejects.toThrow(/not a payment reference/i);
  });

  it('refuses to open a payment when Stripe is not configured', async () => {
    const dir = await dataDir();
    const plans = recordingPlans();
    const payments = createPaymentService({ dataDir: dir, plans: plans.port, env: {} });
    await expect(payments.begin({ planId: 'ultra', requestId: 'req_abcdefgh' })).rejects.toThrow(/No Stripe keys/);
    expect(payments.status().configured).toBe(false);
  });

  it('refuses a checkout with no request id', async () => {
    const dir = await dataDir();
    await configured(dir);
    const plans = recordingPlans();
    const payments = createPaymentService({ dataDir: dir, plans: plans.port, env: {}, clientFactory: fakeStripe().factory });
    await expect(payments.begin({ planId: 'ultra', requestId: 'no' })).rejects.toThrow(/request ID/);
  });
});

describe('refunds', () => {
  it('reverses the entitlement once the full amount is returned', async () => {
    const dir = await dataDir();
    await configured(dir);
    const plans = recordingPlans();
    const stripe = fakeStripe();
    const payments = createPaymentService({ dataDir: dir, plans: plans.port, env: {}, clientFactory: stripe.factory });
    const begun = await payments.begin({ planId: 'ultra', requestId: 'req_abcdefgh' });
    await payments.confirm(begun.paymentIntentId);

    const refunded = await payments.refund(begun.paymentIntentId);
    expect(refunded).toMatchObject({ status: 'refunded', refundedPence: 1299 });
    expect(plans.revoked).toHaveLength(1);
  });

  it('will not refund more than was charged, or refund an unpaid order', async () => {
    const dir = await dataDir();
    await configured(dir);
    const plans = recordingPlans();
    const stripe = fakeStripe();
    const payments = createPaymentService({ dataDir: dir, plans: plans.port, env: {}, clientFactory: stripe.factory });
    const begun = await payments.begin({ planId: 'ultra', requestId: 'req_abcdefgh' });

    await expect(payments.refund(begun.paymentIntentId)).rejects.toThrow(/Only a paid order/);
    await payments.confirm(begun.paymentIntentId);
    await expect(payments.refund(begun.paymentIntentId, 99_999)).rejects.toThrow(/not valid/);
    expect(plans.revoked).toHaveLength(0);
  });
});

describe('the payments ledger on disk', () => {
  it('is encrypted, and carries no card data because none is ever held', async () => {
    const dir = await dataDir();
    await configured(dir);
    const plans = recordingPlans();
    const payments = createPaymentService({ dataDir: dir, plans: plans.port, env: {}, clientFactory: fakeStripe().factory });
    await payments.begin({ planId: 'ultra', requestId: 'req_abcdefgh' });

    const blob = readFileSync(paymentsLedgerPath(dir), 'utf8');
    expect(blob).not.toContain('pi_test_123');
    expect(blob).not.toContain('ultra');
    // The order is still readable through the service, which holds the key.
    expect(payments.orders()).toHaveLength(1);
    expect(JSON.stringify(payments.orders())).not.toMatch(/\b\d{13,19}\b/);
  });
});
