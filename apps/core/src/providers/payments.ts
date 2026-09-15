import { randomUUID } from 'node:crypto';
import { paymentsLedgerPath } from '../update/paths.ts';
import { readSealed, writeSealed } from './vault.ts';
import { createStripeClient, StripeError, verifyWebhookSignature, type StripeClient, type StripePaymentIntent } from './stripeClient.ts';
import { loadStripeConfig, publicStripeStatus, redact, type PublicStripeStatus, type StripeMode } from './stripeConfig.ts';

/**
 * Card payments.
 *
 * The rule the whole design turns on: a card number never reaches this
 * process. The browser loads Stripe's own script, sends the card straight to
 * Stripe, and TVM only ever handles a PaymentIntent identifier. That is what
 * keeps this project inside PCI DSS SAQ-A, the only tier a project of this
 * size can honestly claim, and it is why there is no field here that could
 * hold a PAN even by accident.
 *
 * The second rule: the browser is not a source of truth. It says what the
 * buyer wants; the price is looked up here, the payment is re-read from Stripe
 * before anything is granted, and an entitlement is written only against a
 * PaymentIntent that Stripe itself reports as succeeded.
 */

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'canceled' | 'refunded';

/**
 * What was ordered, recorded when the intent is created.
 *
 * The grant is applied from this record rather than from anything the client
 * sends back, so a buyer cannot confirm a 99p payment and be handed the plan
 * they did not pay for.
 */
export interface PaymentOrder {
  paymentIntentId: string;
  requestId: string;
  fingerprint: string;
  planId: string;
  liveTv: boolean;
  anime: boolean;
  bundle: boolean;
  synthwave: boolean;
  packOnly: boolean;
  monthlyPence: number;
  oneTimePence: number;
  amountPence: number;
  currency: 'GBP';
  mode: StripeMode;
  status: OrderStatus;
  createdAt: string;
  settledAt: string | null;
  receiptUrl: string | null;
  chargedPence: number;
  refundedPence: number;
  failureMessage: string | null;
}

export interface PaymentsLedger {
  version: 1;
  orders: PaymentOrder[];
  /** Stripe event ids already applied, so a redelivered webhook grants nothing twice. */
  processedEvents: string[];
}

const MAX_ORDERS = 200;
const MAX_EVENTS = 500;

export function emptyPaymentsLedger(): PaymentsLedger {
  return { version: 1, orders: [], processedEvents: [] };
}

export function hydratePaymentsLedger(raw: unknown): PaymentsLedger {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyPaymentsLedger();
  const value = raw as Partial<PaymentsLedger>;
  if (value.version !== 1 || !Array.isArray(value.orders)) return emptyPaymentsLedger();
  const orders = value.orders.filter((order): order is PaymentOrder =>
    order !== null && typeof order === 'object'
    && typeof (order as PaymentOrder).paymentIntentId === 'string'
    && typeof (order as PaymentOrder).amountPence === 'number');
  const processedEvents = Array.isArray(value.processedEvents)
    ? value.processedEvents.filter((id): id is string => typeof id === 'string')
    : [];
  return { version: 1, orders, processedEvents };
}

/** The order as the interface may see it. */
export interface PublicPaymentOrder {
  paymentIntentId: string;
  planId: string;
  amountPence: number;
  chargedPence: number;
  refundedPence: number;
  currency: 'GBP';
  mode: StripeMode;
  status: OrderStatus;
  createdAt: string;
  settledAt: string | null;
  receiptUrl: string | null;
  failureMessage: string | null;
}

export function publicOrder(order: PaymentOrder): PublicPaymentOrder {
  return {
    paymentIntentId: order.paymentIntentId,
    planId: order.planId,
    amountPence: order.amountPence,
    chargedPence: order.chargedPence,
    refundedPence: order.refundedPence,
    currency: order.currency,
    mode: order.mode,
    status: order.status,
    createdAt: order.createdAt,
    settledAt: order.settledAt,
    receiptUrl: order.receiptUrl,
    failureMessage: order.failureMessage,
  };
}

/** The priced order, worked out by the plan catalogue rather than the client. */
export interface OrderQuote {
  planId: string;
  fingerprint: string;
  monthlyPence: number;
  oneTimePence: number;
  /** Charged now: the first month plus any one-off packs. */
  amountPence: number;
  liveTv: boolean;
  anime: boolean;
  bundle: boolean;
  synthwave: boolean;
  packOnly: boolean;
  description: string;
}

export interface SettledPayment {
  paymentIntentId: string;
  chargedPence: number;
  receiptUrl: string | null;
  mode: StripeMode;
  at: string;
}

/**
 * What the payment service needs from the plan catalogue. Keeping it to two
 * functions means payments can be tested without a plan store and the plan
 * store keeps sole ownership of entitlements.
 */
export interface PlanPort {
  /** Prices an order. Throws with a buyer-readable message if the order is not valid. */
  quote(input: Record<string, unknown>): OrderQuote;
  /** Applies the entitlement and writes the receipt. Must tolerate being called twice. */
  grant(order: PaymentOrder, payment: SettledPayment): void;
  /** Reverses the entitlement after a refund. */
  revoke(order: PaymentOrder): void;
}

export interface PaymentServiceOptions {
  dataDir: string;
  plans: PlanPort;
  env?: NodeJS.ProcessEnv;
  /** Injected in tests. */
  clientFactory?: (config: Parameters<typeof createStripeClient>[0]['config']) => StripeClient;
  now?: () => Date;
}

export class PaymentsNotConfigured extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'PaymentsNotConfigured';
  }
}

export function createPaymentService(options: PaymentServiceOptions) {
  const { dataDir, plans } = options;
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());

  const read = (): PaymentsLedger => hydratePaymentsLedger(readSealed<PaymentsLedger>(dataDir, paymentsLedgerPath(dataDir)));
  const write = (ledger: PaymentsLedger): void => {
    writeSealed(dataDir, paymentsLedgerPath(dataDir), {
      version: 1,
      orders: ledger.orders.slice(0, MAX_ORDERS),
      processedEvents: ledger.processedEvents.slice(0, MAX_EVENTS),
    } satisfies PaymentsLedger);
  };

  const upsert = (order: PaymentOrder): void => {
    const ledger = read();
    write({
      ...ledger,
      orders: [order, ...ledger.orders.filter((entry) => entry.paymentIntentId !== order.paymentIntentId)],
    });
  };

  const findOrder = (paymentIntentId: string): PaymentOrder | null =>
    read().orders.find((order) => order.paymentIntentId === paymentIntentId) ?? null;

  function configState() {
    return loadStripeConfig(dataDir, env);
  }

  function client(): StripeClient {
    const state = configState();
    if (!state.configured) throw new PaymentsNotConfigured(state.detail);
    return options.clientFactory !== undefined
      ? options.clientFactory(state.config)
      : createStripeClient({ config: state.config });
  }

  /**
   * Applies a settled payment exactly once.
   *
   * Both the webhook and the browser's return trip land here, and Stripe
   * redelivers webhooks on its own schedule, so this is written to be safe to
   * call repeatedly: an order already marked paid returns without granting
   * anything a second time.
   */
  function settle(order: PaymentOrder, intent: StripePaymentIntent): PaymentOrder {
    if (order.status === 'paid' || order.status === 'refunded') return order;
    // Trust Stripe's figure, not the order's: a partial capture must not grant
    // a full-price plan.
    if (intent.status !== 'succeeded' || intent.amountReceived < order.amountPence) {
      return order;
    }
    const settledAt = now().toISOString();
    const paid: PaymentOrder = {
      ...order,
      status: 'paid',
      settledAt,
      chargedPence: intent.amountReceived,
      receiptUrl: intent.receiptUrl,
      failureMessage: null,
    };
    plans.grant(paid, {
      paymentIntentId: paid.paymentIntentId,
      chargedPence: paid.chargedPence,
      receiptUrl: paid.receiptUrl,
      mode: paid.mode,
      at: settledAt,
    });
    upsert(paid);
    return paid;
  }

  return {
    status(): PublicStripeStatus {
      return publicStripeStatus(configState());
    },

    /** Confirms the keys actually work, without moving money. */
    async verify(): Promise<{ ok: boolean; mode: StripeMode | null; detail: string | null }> {
      const state = configState();
      if (!state.configured) return { ok: false, mode: null, detail: state.detail };
      const result = await client().ping();
      return result.ok
        ? { ok: true, mode: state.config.mode, detail: null }
        : { ok: false, mode: state.config.mode, detail: result.detail };
    },

    orders(): PublicPaymentOrder[] {
      return read().orders.map(publicOrder);
    },

    order(paymentIntentId: string): PublicPaymentOrder | null {
      const order = findOrder(paymentIntentId);
      return order === null ? null : publicOrder(order);
    },

    /**
     * Prices the order and opens a PaymentIntent for it. Grants nothing: the
     * buyer has not paid yet at this point, they have only been quoted.
     */
    async begin(input: Record<string, unknown>): Promise<{
      paymentIntentId: string;
      clientSecret: string;
      publishableKey: string;
      amountPence: number;
      monthlyPence: number;
      oneTimePence: number;
      currency: 'GBP';
      mode: StripeMode;
      description: string;
    }> {
      const state = configState();
      if (!state.configured) throw new PaymentsNotConfigured(state.detail);
      const quote = plans.quote(input);

      const requestId = typeof input['requestId'] === 'string' ? input['requestId'] : '';
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) {
        throw new Error('A valid checkout request ID is required. Please reopen checkout.');
      }

      // Reuse the intent for a repeated request id rather than opening a second
      // one, so a double-tapped Pay button cannot produce two charges.
      const existing = read().orders.find((order) => order.requestId === requestId);
      if (existing !== null && existing !== undefined) {
        if (existing.fingerprint !== quote.fingerprint) {
          throw new Error('This request ID was used for a different order. Reopen checkout.');
        }
        if (existing.status === 'pending') {
          const intent = await client().retrievePaymentIntent(existing.paymentIntentId);
          if (intent.clientSecret !== null) {
            return {
              paymentIntentId: existing.paymentIntentId,
              clientSecret: intent.clientSecret,
              publishableKey: state.config.publishableKey,
              amountPence: existing.amountPence,
              monthlyPence: existing.monthlyPence,
              oneTimePence: existing.oneTimePence,
              currency: 'GBP',
              mode: existing.mode,
              description: quote.description,
            };
          }
        } else {
          throw new Error('This order has already been paid. Reopen checkout to buy something else.');
        }
      }

      if (quote.amountPence <= 0) {
        throw new Error('There is nothing to pay for on this order.');
      }

      const intent = await client().createPaymentIntent({
        amountPence: quote.amountPence,
        description: quote.description,
        // Metadata is a cross-check and an audit trail in the Stripe dashboard.
        // It is not read back to decide what to grant; the sealed order is.
        metadata: {
          requestId,
          planId: quote.planId,
          liveTv: String(quote.liveTv),
          anime: String(quote.anime),
          bundle: String(quote.bundle),
          synthwave: String(quote.synthwave),
          monthlyPence: String(quote.monthlyPence),
          oneTimePence: String(quote.oneTimePence),
        },
        idempotencyKey: `tvm_checkout_${requestId}`,
      });

      if (intent.clientSecret === null) throw new Error('Stripe did not return a client secret for this payment.');

      upsert({
        paymentIntentId: intent.id,
        requestId,
        fingerprint: quote.fingerprint,
        planId: quote.planId,
        liveTv: quote.liveTv,
        anime: quote.anime,
        bundle: quote.bundle,
        synthwave: quote.synthwave,
        packOnly: quote.packOnly,
        monthlyPence: quote.monthlyPence,
        oneTimePence: quote.oneTimePence,
        amountPence: quote.amountPence,
        currency: 'GBP',
        mode: state.config.mode,
        status: 'pending',
        createdAt: now().toISOString(),
        settledAt: null,
        receiptUrl: null,
        chargedPence: 0,
        refundedPence: 0,
        failureMessage: null,
      });

      return {
        paymentIntentId: intent.id,
        clientSecret: intent.clientSecret,
        publishableKey: state.config.publishableKey,
        amountPence: quote.amountPence,
        monthlyPence: quote.monthlyPence,
        oneTimePence: quote.oneTimePence,
        currency: 'GBP',
        mode: state.config.mode,
        description: quote.description,
      };
    },

    /**
     * Called when the browser comes back from Stripe.
     *
     * A webhook is the authoritative path, but a webhook cannot reach a laptop
     * on a home network without a tunnel, so this re-reads the intent from
     * Stripe and settles from that. It never trusts the browser's claim, only
     * the identifier it carries.
     */
    async confirm(paymentIntentId: string): Promise<PublicPaymentOrder> {
      if (typeof paymentIntentId !== 'string' || !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) {
        throw new Error('That is not a payment reference.');
      }
      const order = findOrder(paymentIntentId);
      if (order === null) throw new Error('No order matches that payment. Reopen checkout.');
      if (order.status === 'paid' || order.status === 'refunded') return publicOrder(order);

      const intent = await client().retrievePaymentIntent(paymentIntentId);
      if (intent.status === 'succeeded') return publicOrder(settle(order, intent));

      if (intent.status === 'canceled') {
        const canceled: PaymentOrder = { ...order, status: 'canceled', failureMessage: 'This payment was cancelled.' };
        upsert(canceled);
        return publicOrder(canceled);
      }
      // requires_payment_method means the card was declined and Stripe is
      // waiting for another one; that is a failure to report, not to record
      // permanently, so the order stays pending and can be retried.
      return publicOrder(order);
    },

    /**
     * The authoritative settlement path in production.
     *
     * Verifies the signature over the raw body before reading a single field:
     * without that, this endpoint would let anyone on the internet grant
     * themselves a subscription.
     */
    /**
     * Stripe's callback.
     *
     * Subscription and invoice events are forwarded to `onSubscriptionEvent`
     * rather than handled here: this module owns one-off payments, and
     * renewals belong to the subscription ledger. The signature is verified
     * once, before anything is read or forwarded, so the forwarded event is
     * already known to have come from Stripe.
     */
    async webhook(
      rawBody: string,
      signatureHeader: string | undefined,
      onSubscriptionEvent?: (type: string, object: Record<string, unknown>, eventId: string) => Promise<void>,
    ): Promise<{ ok: boolean; handled: string; reason?: string }> {
      const state = configState();
      if (!state.configured) return { ok: false, handled: 'none', reason: 'stripe_not_configured' };
      if (state.config.webhookSecret === null) return { ok: false, handled: 'none', reason: 'webhook_secret_not_configured' };

      const verified = verifyWebhookSignature({
        payload: rawBody,
        header: signatureHeader,
        secret: state.config.webhookSecret,
      });
      if (!verified.ok) return { ok: false, handled: 'none', reason: verified.reason };

      const event = verified.event;
      const eventId = typeof event['id'] === 'string' ? event['id'] : '';
      const type = typeof event['type'] === 'string' ? event['type'] : '';
      const ledger = read();
      if (eventId !== '' && ledger.processedEvents.includes(eventId)) {
        return { ok: true, handled: 'duplicate' };
      }

      const dataObject = ((event['data'] as Record<string, unknown> | undefined)?.['object']) as Record<string, unknown> | undefined;
      const intentId = typeof dataObject?.['id'] === 'string' ? dataObject['id'] : '';
      const remember = (): void => {
        const current = read();
        if (eventId === '' || current.processedEvents.includes(eventId)) return;
        write({ ...current, processedEvents: [eventId, ...current.processedEvents] });
      };

      // Anything about an invoice or a subscription is a recurring-billing
      // event, and none of them correspond to a one-off order here.
      if (type.startsWith('invoice.') || type.startsWith('customer.subscription.')) {
        if (onSubscriptionEvent !== undefined) {
          await onSubscriptionEvent(type, dataObject ?? {}, eventId);
        }
        remember();
        return { ok: true, handled: type };
      }

      if (type === 'payment_intent.succeeded') {
        const order = findOrder(intentId);
        if (order === null) { remember(); return { ok: true, handled: 'unknown_order' }; }
        // Re-read rather than trusting the event body, which may be older than
        // the current state of the intent.
        settle(order, await client().retrievePaymentIntent(intentId));
        remember();
        return { ok: true, handled: 'payment_intent.succeeded' };
      }

      if (type === 'payment_intent.payment_failed') {
        const order = findOrder(intentId);
        if (order !== null && order.status === 'pending') {
          const lastError = dataObject?.['last_payment_error'] as Record<string, unknown> | undefined;
          const message = typeof lastError?.['message'] === 'string' ? redact(lastError['message']) : 'The payment was declined.';
          upsert({ ...order, failureMessage: message });
        }
        remember();
        return { ok: true, handled: 'payment_intent.payment_failed' };
      }

      if (type === 'charge.refunded') {
        const paymentIntentId = typeof dataObject?.['payment_intent'] === 'string' ? dataObject['payment_intent'] : '';
        const order = findOrder(paymentIntentId);
        if (order !== null) {
          const refunded = typeof dataObject?.['amount_refunded'] === 'number' ? dataObject['amount_refunded'] : order.chargedPence;
          const next: PaymentOrder = {
            ...order,
            refundedPence: refunded,
            status: refunded >= order.chargedPence ? 'refunded' : order.status,
          };
          upsert(next);
          if (next.status === 'refunded') plans.revoke(next);
        }
        remember();
        return { ok: true, handled: 'charge.refunded' };
      }

      remember();
      return { ok: true, handled: 'ignored' };
    },

    /** Refunds a paid order and takes the entitlement back with it. */
    async refund(paymentIntentId: string, amountPence?: number): Promise<PublicPaymentOrder> {
      const order = findOrder(paymentIntentId);
      if (order === null) throw new Error('No order matches that payment.');
      if (order.status !== 'paid') throw new Error('Only a paid order can be refunded.');
      const amount = amountPence === undefined ? order.chargedPence : amountPence;
      if (!Number.isInteger(amount) || amount <= 0 || amount > order.chargedPence - order.refundedPence) {
        throw new Error('That refund amount is not valid for this order.');
      }
      const result = await client().refund({
        paymentIntentId,
        amountPence: amount,
        idempotencyKey: `tvm_refund_${paymentIntentId}_${amount}`,
      });
      const refundedPence = order.refundedPence + result.amount;
      const next: PaymentOrder = {
        ...order,
        refundedPence,
        status: refundedPence >= order.chargedPence ? 'refunded' : order.status,
      };
      upsert(next);
      if (next.status === 'refunded') plans.revoke(next);
      return publicOrder(next);
    },
  };
}

export type PaymentService = ReturnType<typeof createPaymentService>;

/** Turns a Stripe failure into something a buyer can act on. */
export function buyerMessage(error: unknown): string {
  if (error instanceof PaymentsNotConfigured) return error.message;
  if (error instanceof StripeError) {
    if (error.declineMessage !== null) return error.declineMessage;
    if (error.type === 'connection_error') return 'TVM could not reach Stripe. Check your connection and try again.';
    return error.message;
  }
  return error instanceof Error ? redact(error.message) : 'The payment could not be completed.';
}

/** Used when an order id is needed before Stripe has issued one. */
export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '')}`;
}
