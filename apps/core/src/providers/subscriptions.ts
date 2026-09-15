import { subscriptionsPath } from '../update/paths.ts';
import { readSealed, writeSealed } from './vault.ts';
import type { StripeClient, StripeSubscription } from './stripeClient.ts';
import { liveTvExpiryIso, liveTvSpec, parseLiveTvTerm, type LiveTvTerm } from './liveTv.ts';

/**
 * Monthly billing that actually recurs.
 *
 * The first card implementation opened a PaymentIntent, took one payment and
 * stopped. That is a purchase, not a subscription: the plan said "per month"
 * and nothing was ever charged again. A real subscription needs three things
 * a one-off payment does not have — a Customer for Stripe to bill next month,
 * a recurring Price, and somewhere for the renewal to land a month later.
 *
 * Renewals arrive as `invoice.paid` webhooks, which is the only way a server
 * finds out about a charge nobody was present for. Anything that depends on
 * the browser being open cannot renew a subscription, so the webhook path is
 * the real one here and the return trip is only a courtesy for the first
 * payment.
 */

export type SubscriptionState =
  | 'none'
  /** Created, first payment not yet confirmed. Grants nothing. */
  | 'incomplete'
  | 'active'
  /** Paid but the renewal failed; Stripe is retrying. Access continues for now. */
  | 'past_due'
  | 'canceled';

export interface SubscriptionRecord {
  subscriptionId: string;
  customerId: string;
  planId: string;
  liveTv: boolean;
  liveTvTerm?: LiveTvTerm | null;
  liveTvKind?: 'plan' | 'livetv';
  liveTvSubscriptionId?: string | null;
  amountPence: number;
  currency: 'GBP';
  state: SubscriptionState;
  /** Unix seconds. When the next charge is due. */
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  /** Every renewal that has been applied, newest first. Capped. */
  invoices: Array<{ id: string; paidPence: number; at: string }>;
  lastError: string | null;
}

export interface SubscriptionsLedger {
  version: 1;
  current: SubscriptionRecord | null;
  /** Stripe event ids already applied, so a redelivered renewal is not counted twice. */
  processedEvents: string[];
}

const MAX_INVOICES = 36;
const MAX_EVENTS = 500;

export function emptySubscriptions(): SubscriptionsLedger {
  return { version: 1, current: null, processedEvents: [] };
}

export function hydrateSubscriptions(raw: unknown): SubscriptionsLedger {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptySubscriptions();
  const value = raw as Partial<SubscriptionsLedger>;
  if (value.version !== 1) return emptySubscriptions();
  const current = value.current !== null && typeof value.current === 'object'
    && typeof (value.current as SubscriptionRecord).subscriptionId === 'string'
    ? value.current as SubscriptionRecord
    : null;
  return {
    version: 1,
    current,
    processedEvents: Array.isArray(value.processedEvents)
      ? value.processedEvents.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

/**
 * Whether this subscription should be granting access right now.
 *
 * `past_due` deliberately still counts. Stripe retries a failed renewal over
 * several days, and cutting someone off the moment their bank declined a
 * payment they will make on the retry is both hostile and bad for recovery
 * rates. `incomplete` never counts: nothing has been paid yet.
 */
export function grantsAccess(record: SubscriptionRecord | null): boolean {
  if (record === null) return false;
  return record.state === 'active' || record.state === 'past_due';
}

/** Maps Stripe's vocabulary onto the four states this app acts on. */
export function stateFromStripe(status: string): SubscriptionState {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'incomplete':
      return 'incomplete';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'incomplete';
  }
}

export interface PublicSubscription {
  state: SubscriptionState;
  planId: string | null;
  liveTv: boolean;
  amountPence: number;
  currency: 'GBP';
  /** ISO date of the next charge, or null when nothing is due. */
  nextChargeAt: string | null;
  cancelAtPeriodEnd: boolean;
  renewals: number;
  lastError: string | null;
}

export function publicSubscription(record: SubscriptionRecord | null): PublicSubscription {
  if (record === null) {
    return {
      state: 'none', planId: null, liveTv: false, amountPence: 0, currency: 'GBP',
      nextChargeAt: null, cancelAtPeriodEnd: false, renewals: 0, lastError: null,
    };
  }
  return {
    state: record.state,
    planId: record.planId,
    liveTv: record.liveTv,
    amountPence: record.amountPence,
    currency: 'GBP',
    nextChargeAt: record.currentPeriodEnd > 0 ? new Date(record.currentPeriodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: record.cancelAtPeriodEnd,
    renewals: record.invoices.length,
    lastError: record.lastError,
  };
}

/** What subscriptions needs from the plan catalogue. */
export interface SubscriptionPlanPort {
  monthlyQuote(input: Record<string, unknown>): {
    planId: string;
    liveTv: boolean;
    liveTvTerm?: LiveTvTerm | null;
    monthlyPence: number;
    liveTvPence?: number;
    oneTimePence?: number;
    description: string;
  };
  grantMonthly(record: SubscriptionRecord, paidPence: number, at: string): void;
  revokeMonthly(record: SubscriptionRecord): void;
}

export interface SubscriptionServiceOptions {
  dataDir: string;
  plans: SubscriptionPlanPort;
  client: () => StripeClient;
  now?: () => Date;
}

export function createSubscriptionService(options: SubscriptionServiceOptions) {
  const { dataDir, plans } = options;
  const now = options.now ?? (() => new Date());

  const read = (): SubscriptionsLedger =>
    hydrateSubscriptions(readSealed<SubscriptionsLedger>(dataDir, subscriptionsPath(dataDir)));

  const write = (ledger: SubscriptionsLedger): void => {
    writeSealed(dataDir, subscriptionsPath(dataDir), {
      version: 1,
      current: ledger.current === null ? null : {
        ...ledger.current,
        invoices: ledger.current.invoices.slice(0, MAX_INVOICES),
      },
      processedEvents: ledger.processedEvents.slice(0, MAX_EVENTS),
    } satisfies SubscriptionsLedger);
  };

  const save = (record: SubscriptionRecord | null): void => {
    write({ ...read(), current: record });
  };

  /**
   * Folds Stripe's view of the subscription into ours.
   *
   * Stripe is authoritative about state — it knows whether last night's charge
   * cleared — so its status always wins over whatever was stored here.
   */
  const sync = (record: SubscriptionRecord, remote: StripeSubscription): SubscriptionRecord => ({
    ...record,
    state: stateFromStripe(remote.status),
    currentPeriodEnd: remote.currentPeriodEnd > 0 ? remote.currentPeriodEnd : record.currentPeriodEnd,
    cancelAtPeriodEnd: remote.cancelAtPeriodEnd,
    amountPence: remote.amountPence > 0 ? remote.amountPence : record.amountPence,
  });

  const armLiveTv = async (record: SubscriptionRecord): Promise<SubscriptionRecord> => {
    const term = parseLiveTvTerm(record.liveTvTerm);
    if (!record.liveTv || term === null || term === 'lifetime') return record;
    if (typeof record.liveTvSubscriptionId === 'string' && record.liveTvSubscriptionId !== '') return record;
    const spec = liveTvSpec(term);
    if (spec.interval === null) return record;
    const expiry = liveTvExpiryIso(term, now());
    const trialEnd = expiry === null ? undefined : Math.floor(new Date(expiry).getTime() / 1000);
    const remote = await options.client().createSubscription({
      customerId: record.customerId,
      amountPence: spec.amountPence,
      productName: `TVM Live TV ${spec.name}`,
      interval: spec.interval,
      intervalCount: spec.intervalCount,
      trialEnd,
      metadata: { kind: 'livetv', planId: record.planId, liveTvTerm: term },
      idempotencyKey: `tvm_livetv_${record.subscriptionId}`,
    });
    const next = { ...record, liveTvSubscriptionId: remote.id };
    save(next);
    return next;
  };

  return {
    current(): PublicSubscription {
      return publicSubscription(read().current);
    },

    record(): SubscriptionRecord | null {
      return read().current;
    },

    /**
     * Starts a subscription and returns the first payment to confirm.
     *
     * Nothing is granted here. The subscription is created `incomplete`, so a
     * card that declines leaves no plan behind.
     */
    async begin(input: Record<string, unknown>): Promise<{
      subscriptionId: string;
      clientSecret: string;
      amountPence: number;
      planId: string;
      liveTv: boolean;
      description: string;
    }> {
      const ledger = read();
      if (grantsAccess(ledger.current) && ledger.current?.cancelAtPeriodEnd === false) {
        throw new Error('This device already has an active monthly plan. Cancel it before starting another.');
      }

      const quote = plans.monthlyQuote(input);
      const liveTvPence = quote.liveTvPence ?? 0;
      const oneTimePence = quote.oneTimePence ?? 0;
      const liveTvTerm = parseLiveTvTerm(quote.liveTvTerm);
      if (quote.monthlyPence <= 0 && liveTvPence <= 0) {
        throw new Error('The free plan has nothing to bill. Choose a paid plan to subscribe.');
      }

      const requestId = typeof input['requestId'] === 'string' ? input['requestId'] : '';
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) {
        throw new Error('A valid checkout request ID is required. Please reopen checkout.');
      }

      const client = options.client();
      const customerId = ledger.current?.customerId
        ?? (await client.createCustomer({
          metadata: { app: 'tvm' },
          idempotencyKey: `tvm_customer_${requestId}`,
        })).id;

      const invoiceItems: Array<{ amountPence: number; description: string }> = [];
      if (oneTimePence > 0) invoiceItems.push({ amountPence: oneTimePence, description: 'TVM one-time items' });
      if (liveTvPence > 0 && quote.monthlyPence > 0) {
        invoiceItems.push({
          amountPence: liveTvPence,
          description: liveTvTerm !== null ? `TVM Live TV ${liveTvSpec(liveTvTerm).name}` : 'TVM Live TV',
        });
      }

      const recurringPence = quote.monthlyPence > 0 ? quote.monthlyPence : liveTvPence;
      const liveSpec = liveTvTerm !== null && liveTvTerm !== 'lifetime' ? liveTvSpec(liveTvTerm) : null;
      const remote = await client.createSubscription({
        customerId,
        amountPence: recurringPence,
        productName: quote.description,
        interval: quote.monthlyPence > 0 ? 'month' : (liveSpec?.interval ?? 'month'),
        intervalCount: quote.monthlyPence > 0 ? 1 : (liveSpec?.intervalCount ?? 1),
        invoiceItems,
        metadata: {
          requestId,
          planId: quote.planId,
          liveTv: String(quote.liveTv),
          liveTvTerm: liveTvTerm ?? '',
        },
        idempotencyKey: `tvm_sub_${requestId}`,
      });

      if (remote.clientSecret === null) {
        throw new Error('Stripe did not return a payment to confirm for this subscription.');
      }

      const firstInvoicePence = quote.monthlyPence + liveTvPence + oneTimePence;
      save({
        subscriptionId: remote.id,
        customerId,
        planId: quote.planId,
        liveTv: quote.liveTv,
        liveTvTerm,
        liveTvKind: 'plan',
        liveTvSubscriptionId: null,
        amountPence: quote.monthlyPence > 0 ? quote.monthlyPence : liveTvPence,
        currency: 'GBP',
        state: stateFromStripe(remote.status),
        currentPeriodEnd: remote.currentPeriodEnd,
        cancelAtPeriodEnd: remote.cancelAtPeriodEnd,
        createdAt: now().toISOString(),
        invoices: [],
        lastError: null,
      });

      return {
        subscriptionId: remote.id,
        clientSecret: remote.clientSecret,
        amountPence: firstInvoicePence,
        planId: quote.planId,
        liveTv: quote.liveTv,
        description: quote.description,
      };
    },

    /** Re-reads Stripe after the browser confirms, and grants if it really is active. */
    async confirm(): Promise<PublicSubscription> {
      const ledger = read();
      const record = ledger.current;
      if (record === null) throw new Error('There is no subscription to confirm.');

      const remote = await options.client().retrieveSubscription(record.subscriptionId);
      let next = sync(record, remote);
      save(next);
      if (grantsAccess(next)) {
        plans.grantMonthly(next, next.amountPence, now().toISOString());
        next = await armLiveTv(next);
      }
      return publicSubscription(next);
    },

    /**
     * Applies a Stripe subscription event.
     *
     * Called from the webhook handler after the signature has been verified;
     * this function trusts its input because the caller has already proved it
     * came from Stripe.
     */
    async applyEvent(type: string, object: Record<string, unknown>, eventId: string): Promise<{ handled: string }> {
      const ledger = read();
      if (eventId !== '' && ledger.processedEvents.includes(eventId)) return { handled: 'duplicate' };
      const record = ledger.current;

      const remember = (): void => {
        const fresh = read();
        if (eventId === '' || fresh.processedEvents.includes(eventId)) return;
        write({ ...fresh, processedEvents: [eventId, ...fresh.processedEvents] });
      };

      if (record === null) { remember(); return { handled: 'no_subscription' }; }

      if (type === 'invoice.paid' || type === 'invoice.payment_succeeded') {
        const subscriptionId = typeof object['subscription'] === 'string' ? object['subscription'] : '';
        const liveTvSub = record.liveTvSubscriptionId ?? '';
        if (subscriptionId !== record.subscriptionId && subscriptionId !== liveTvSub) {
          remember();
          return { handled: 'other_subscription' };
        }
        const invoiceId = typeof object['id'] === 'string' ? object['id'] : '';
        const paid = typeof object['amount_paid'] === 'number' ? object['amount_paid'] : record.amountPence;
        if (record.invoices.some((entry) => entry.id === invoiceId)) { remember(); return { handled: 'duplicate_invoice' }; }

        const at = now().toISOString();
        const liveTvInvoice = liveTvSub !== '' && subscriptionId === liveTvSub;
        const remote = await options.client().retrieveSubscription(liveTvInvoice ? liveTvSub : record.subscriptionId);
        let next: SubscriptionRecord = {
          ...sync(record, liveTvInvoice ? { ...remote, currentPeriodEnd: record.currentPeriodEnd } : remote),
          invoices: [{ id: invoiceId, paidPence: paid, at }, ...record.invoices],
          lastError: null,
        };
        if (liveTvInvoice) next = { ...next, liveTvKind: 'livetv' };
        save(next);
        plans.grantMonthly(liveTvInvoice ? { ...next, liveTvKind: 'livetv', liveTv: true } : next, paid, at);
        if (!liveTvInvoice && grantsAccess(next)) next = await armLiveTv(next);
        remember();
        return { handled: liveTvInvoice ? 'livetv_renewed' : 'renewed' };
      }

      if (type === 'invoice.payment_failed') {
        const message = 'Your bank declined the monthly payment. Stripe will try again over the next few days.';
        save({ ...record, state: 'past_due', lastError: message });
        remember();
        return { handled: 'payment_failed' };
      }

      if (type === 'customer.subscription.updated') {
        const remote = await options.client().retrieveSubscription(record.subscriptionId);
        const next = sync(record, remote);
        save(next);
        if (!grantsAccess(next)) plans.revokeMonthly(next);
        remember();
        return { handled: 'updated' };
      }

      if (type === 'customer.subscription.deleted') {
        const ended: SubscriptionRecord = { ...record, state: 'canceled', cancelAtPeriodEnd: false };
        save(ended);
        plans.revokeMonthly(ended);
        remember();
        return { handled: 'canceled' };
      }

      remember();
      return { handled: 'ignored' };
    },

    /**
     * Stops future charges.
     *
     * Ends at the period end by default: the month has been paid for, so it is
     * kept. Only a refund justifies cutting access off mid-month.
     */
    async cancel(atPeriodEnd = true): Promise<PublicSubscription> {
      const record = read().current;
      if (record === null) throw new Error('There is no subscription to cancel.');
      const remote = await options.client().cancelSubscription({ id: record.subscriptionId, atPeriodEnd });
      const next = sync(record, remote);
      save(next);
      if (!grantsAccess(next)) plans.revokeMonthly(next);
      return publicSubscription(next);
    },
  };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
