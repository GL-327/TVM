import { createHmac, timingSafeEqual } from 'node:crypto';
import { redact, type StripeConfig } from './stripeConfig.ts';

/**
 * A small Stripe REST client.
 *
 * Stripe publishes an official SDK, but its API is form-encoded HTTPS and the
 * three calls checkout needs are short, so this keeps the dependency tree
 * unchanged and every request inspectable. Card details never pass through
 * here: the browser sends them straight to Stripe and this side only ever sees
 * an identifier.
 */

const API = 'https://api.stripe.com/v1';
const API_VERSION = '2024-06-20';
const TIMEOUT_MS = 20_000;

export class StripeError extends Error {
  readonly type: string;
  readonly code: string | null;
  readonly statusCode: number;
  /** Safe to show a buyer: Stripe writes these for cardholders. */
  readonly declineMessage: string | null;

  constructor(message: string, options: { type?: string; code?: string | null; statusCode?: number; declineMessage?: string | null } = {}) {
    super(redact(message));
    this.name = 'StripeError';
    this.type = options.type ?? 'api_error';
    this.code = options.code ?? null;
    this.statusCode = options.statusCode ?? 0;
    this.declineMessage = options.declineMessage === undefined ? null : redact(options.declineMessage ?? '') || null;
  }
}

/**
 * Stripe takes nested data as bracketed form keys: metadata[planId]=plus.
 * Undefined and null are dropped so optional fields can be passed through.
 */
export function encodeForm(value: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) continue;
    const name = prefix === '' ? key : `${prefix}[${key}]`;
    if (Array.isArray(raw)) {
      raw.forEach((item, index) => {
        if (item === undefined || item === null) return;
        if (typeof item === 'object') parts.push(encodeForm(item as Record<string, unknown>, `${name}[${index}]`));
        else parts.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof raw === 'object') {
      parts.push(encodeForm(raw as Record<string, unknown>, name));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(raw))}`);
    }
  }
  return parts.filter((part) => part !== '').join('&');
}

export interface StripePaymentIntent {
  id: string;
  clientSecret: string | null;
  status: string;
  amount: number;
  currency: string;
  /** Set once Stripe has actually taken the money. */
  amountReceived: number;
  metadata: Record<string, string>;
  latestChargeId: string | null;
  receiptUrl: string | null;
  livemode: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function parsePaymentIntent(raw: unknown): StripePaymentIntent {
  const body = asRecord(raw);
  const charge = asRecord(body['latest_charge']);
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(asRecord(body['metadata']))) {
    if (typeof value === 'string') metadata[key] = value;
  }
  return {
    id: asString(body['id']) ?? '',
    clientSecret: asString(body['client_secret']),
    status: asString(body['status']) ?? 'unknown',
    amount: typeof body['amount'] === 'number' ? body['amount'] : 0,
    currency: (asString(body['currency']) ?? 'gbp').toLowerCase(),
    amountReceived: typeof body['amount_received'] === 'number' ? body['amount_received'] : 0,
    metadata,
    latestChargeId: asString(body['latest_charge']) ?? asString(charge['id']),
    receiptUrl: asString(charge['receipt_url']),
    livemode: body['livemode'] === true,
  };
}

export interface StripeFetch {
  (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<{
    status: number;
    text(): Promise<string>;
  }>;
}

export interface StripeClientOptions {
  config: StripeConfig;
  /** Injected in tests so no suite ever reaches the network. */
  fetchImpl?: StripeFetch;
}

export function createStripeClient(options: StripeClientOptions) {
  const { config } = options;
  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as StripeFetch);

  async function call(path: string, method: 'GET' | 'POST', form: Record<string, unknown>, idempotencyKey?: string): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.secretKey}`,
      'Stripe-Version': API_VERSION,
    };
    let url = `${API}${path}`;
    let body: string | undefined;
    const encoded = encodeForm(form);
    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = encoded;
      // Stripe replays the first response for a repeated key, so a retry after a
      // dropped connection cannot charge the same card twice.
      if (idempotencyKey !== undefined && idempotencyKey !== '') headers['Idempotency-Key'] = idempotencyKey;
    } else if (encoded !== '') {
      url = `${url}?${encoded}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, TIMEOUT_MS);
    let status: number;
    let text: string;
    try {
      const response = await doFetch(url, { method, headers, body, signal: controller.signal });
      status = response.status;
      text = await response.text();
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'request failed';
      throw new StripeError(`Could not reach Stripe: ${reason}`, { type: 'connection_error' });
    } finally {
      clearTimeout(timer);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new StripeError(`Stripe returned a response that was not JSON (HTTP ${status}).`, { statusCode: status });
    }

    if (status < 200 || status >= 300) {
      const error = asRecord(asRecord(parsed)['error']);
      throw new StripeError(
        asString(error['message']) ?? `Stripe rejected the request (HTTP ${status}).`,
        {
          type: asString(error['type']) ?? 'api_error',
          code: asString(error['code']),
          statusCode: status,
          // decline_code is the cardholder-facing reason; message is the developer one.
          declineMessage: asString(error['code']) === null ? null : asString(error['message']),
        },
      );
    }
    return parsed;
  }

  return {
    mode: config.mode,

    /**
     * Creates the intent the browser will confirm. The amount is decided here,
     * on the server, from the plan catalogue — never sent up by the client,
     * which could otherwise name its own price.
     */
    async createPaymentIntent(input: {
      amountPence: number;
      description: string;
      metadata: Record<string, string>;
      idempotencyKey: string;
      receiptEmail?: string | null;
    }): Promise<StripePaymentIntent> {
      if (!Number.isInteger(input.amountPence) || input.amountPence < 30) {
        // Stripe's GBP minimum is 30p; below it the charge is rejected.
        throw new StripeError('A card payment must be at least £0.30.', { type: 'invalid_request_error' });
      }
      const raw = await call('/payment_intents', 'POST', {
        amount: input.amountPence,
        currency: 'gbp',
        description: input.description,
        metadata: input.metadata,
        receipt_email: input.receiptEmail ?? undefined,
        automatic_payment_methods: { enabled: true },
      }, input.idempotencyKey);
      return parsePaymentIntent(raw);
    },

    /**
     * Re-reads an intent from Stripe. The browser's word that a payment
     * succeeded is not evidence; this is.
     */
    async retrievePaymentIntent(id: string): Promise<StripePaymentIntent> {
      const raw = await call(`/payment_intents/${encodeURIComponent(id)}`, 'GET', { expand: ['latest_charge'] });
      return parsePaymentIntent(raw);
    },

    async refund(input: { paymentIntentId: string; amountPence?: number; idempotencyKey: string }): Promise<{ id: string; status: string; amount: number }> {
      const raw = asRecord(await call('/refunds', 'POST', {
        payment_intent: input.paymentIntentId,
        amount: input.amountPence,
      }, input.idempotencyKey));
      return {
        id: asString(raw['id']) ?? '',
        status: asString(raw['status']) ?? 'unknown',
        amount: typeof raw['amount'] === 'number' ? raw['amount'] : 0,
      };
    },

    /** Confirms the account is reachable and the key works, without moving money. */
    async ping(): Promise<{ ok: true } | { ok: false; detail: string }> {
      try {
        await call('/balance', 'GET', {});
        return { ok: true };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : 'Stripe is unreachable.' };
      }
    },
  };
}

export type StripeClient = ReturnType<typeof createStripeClient>;

/** Stripe allows this much clock drift on a webhook before it is stale. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type WebhookResult =
  | { ok: true; event: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Verifies a Stripe-Signature header against the raw request body.
 *
 * This is the only thing standing between a webhook endpoint and anyone on the
 * internet granting themselves a subscription by POSTing a payment_intent
 * .succeeded, so it compares in constant time and rejects a replayed timestamp.
 * It must run against the *raw* bytes: re-serialising the JSON first changes
 * them and the signature will never match.
 */
export function verifyWebhookSignature(input: {
  payload: string;
  header: string | undefined;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): WebhookResult {
  const { payload, header, secret } = input;
  if (header === undefined || header.trim() === '') return { ok: false, reason: 'missing_signature' };

  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (key === 't' && value !== undefined) timestamp = value;
    if (key === 'v1' && value !== undefined) signatures.push(value);
  }
  if (timestamp === null || !/^\d+$/.test(timestamp)) return { ok: false, reason: 'missing_timestamp' };
  if (signatures.length === 0) return { ok: false, reason: 'missing_v1_signature' };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - Number(timestamp)) > tolerance) return { ok: false, reason: 'timestamp_outside_tolerance' };

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest();
  const matched = signatures.some((candidate) => {
    if (!/^[0-9a-f]+$/i.test(candidate)) return false;
    const given = Buffer.from(candidate, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matched) return { ok: false, reason: 'signature_mismatch' };

  try {
    const event = JSON.parse(payload) as unknown;
    if (event === null || typeof event !== 'object' || Array.isArray(event)) return { ok: false, reason: 'malformed_event' };
    return { ok: true, event: event as Record<string, unknown> };
  } catch {
    return { ok: false, reason: 'malformed_event' };
  }
}
