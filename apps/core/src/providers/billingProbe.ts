import { randomUUID } from 'node:crypto';
import type { StripeClient } from './stripeClient.ts';

/**
 * The developer billing probe: charge a penny, refund it, repeat.
 *
 * Recurring billing is the one part of this system that cannot be tested by
 * using it — a monthly charge takes a month to arrive, and nobody can wait
 * that long to find out whether renewals work. The probe exercises the same
 * path a renewal takes (charge the customer's saved card off-session, with
 * nobody present) once a minute against a penny, and hands the penny straight
 * back.
 *
 * Three things keep it from becoming a liability.
 *
 * It is developer-only and off by default; nothing starts it implicitly.
 *
 * It stops itself. Stripe's fraud systems read repeated small charges
 * followed by refunds as card testing — which is precisely what this looks
 * like — so it is capped at a fixed number of cycles and halts on the first
 * failure rather than hammering a declining card.
 *
 * It refunds every penny it takes, and it is the *only* thing here that
 * refunds automatically. Real payments never do: a subscription that quietly
 * returned its own money would not be a payment system.
 */

/** A penny. Stripe's GBP minimum is 30p for a fresh card, but an off-session charge against a saved one may go lower. */
export const PROBE_PENCE = 1;
export const PROBE_INTERVAL_MS = 60_000;
/** An hour of proof is plenty, and bounds how much this can look like card testing. */
export const PROBE_MAX_CYCLES = 60;

export interface ProbeCycle {
  at: string;
  ok: boolean;
  chargedPence: number;
  refundedPence: number;
  paymentIntentId: string | null;
  detail: string;
}

export interface ProbeStatus {
  running: boolean;
  cycles: number;
  maxCycles: number;
  intervalMs: number;
  amountPence: number;
  /** Newest first, capped. */
  history: ProbeCycle[];
  stoppedReason: string | null;
}

export interface BillingProbeOptions {
  client: () => StripeClient;
  /** The customer to bill. Null when nothing has ever subscribed on this device. */
  customerId: () => string | null;
  /** Refuses to run unless this is true, checked on every tick rather than once. */
  developer: () => boolean;
  /** Live keys move real money even for a penny; the probe says so. */
  mode: () => 'test' | 'live' | null;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const MAX_HISTORY = 20;

export function createBillingProbe(options: BillingProbeOptions) {
  const now = options.now ?? (() => new Date());
  const setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => { clearInterval(handle as ReturnType<typeof setInterval>); });

  let handle: unknown = null;
  let cycles = 0;
  let history: ProbeCycle[] = [];
  let stoppedReason: string | null = null;
  let busy = false;

  const record = (cycle: ProbeCycle): void => {
    history = [cycle, ...history].slice(0, MAX_HISTORY);
  };

  const halt = (reason: string): void => {
    if (handle !== null) clearTimer(handle);
    handle = null;
    stoppedReason = reason;
  };

  /**
   * One charge-and-refund. Overlapping ticks are skipped rather than queued:
   * a slow network must not turn a one-a-minute probe into a burst.
   */
  const tick = async (): Promise<void> => {
    if (busy) return;
    if (!options.developer()) { halt('Developer mode was locked, so the probe stopped.'); return; }
    if (cycles >= PROBE_MAX_CYCLES) { halt(`Reached the ${PROBE_MAX_CYCLES}-cycle limit and stopped on its own.`); return; }

    const customerId = options.customerId();
    if (customerId === null) {
      halt('No saved card on this device yet. Subscribe first, then the probe can bill the same card a renewal would.');
      return;
    }

    busy = true;
    cycles += 1;
    const at = now().toISOString();
    const key = `tvm_probe_${randomUUID().replace(/-/g, '')}`;
    try {
      const client = options.client();
      const intent = await client.createPaymentIntent({
        amountPence: PROBE_PENCE,
        description: 'TVM developer billing probe (refunded immediately)',
        metadata: { probe: 'true', cycle: String(cycles) },
        idempotencyKey: key,
        customerId,
        offSession: true,
        confirm: true,
      });

      if (intent.status !== 'succeeded') {
        record({ at, ok: false, chargedPence: 0, refundedPence: 0, paymentIntentId: intent.id, detail: `Charge did not complete (${intent.status}).` });
        halt('A probe charge did not complete, so the probe stopped rather than retrying a failing card.');
        return;
      }

      const refund = await client.refund({
        paymentIntentId: intent.id,
        amountPence: intent.amountReceived,
        idempotencyKey: `${key}_refund`,
      });
      record({
        at,
        ok: refund.amount >= intent.amountReceived,
        chargedPence: intent.amountReceived,
        refundedPence: refund.amount,
        paymentIntentId: intent.id,
        detail: refund.amount >= intent.amountReceived
          ? 'Charged a penny off-session and refunded it, exactly as a renewal would charge.'
          : 'Charged, but the refund came back short. Check the Stripe dashboard.',
      });
      if (refund.amount < intent.amountReceived) {
        halt('A probe refund did not return the full amount, so the probe stopped.');
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The probe failed.';
      record({ at, ok: false, chargedPence: 0, refundedPence: 0, paymentIntentId: null, detail });
      halt('A probe cycle failed, so the probe stopped rather than repeating it.');
    } finally {
      busy = false;
    }
  };

  return {
    status(): ProbeStatus {
      return {
        running: handle !== null,
        cycles,
        maxCycles: PROBE_MAX_CYCLES,
        intervalMs: PROBE_INTERVAL_MS,
        amountPence: PROBE_PENCE,
        history,
        stoppedReason,
      };
    },

    start(): ProbeStatus {
      if (!options.developer()) throw new Error('developer_required');
      if (options.mode() === null) throw new Error('Stripe is not configured, so there is nothing to probe.');
      if (handle !== null) return this.status();
      cycles = 0;
      history = [];
      stoppedReason = null;
      handle = setTimer(() => { void tick(); }, PROBE_INTERVAL_MS);
      // Run one immediately so the first result does not take a minute.
      void tick();
      return this.status();
    },

    stop(): ProbeStatus {
      halt('Stopped by hand.');
      return this.status();
    },

    /** Exposed for tests; the interval calls this. */
    async runOnce(): Promise<void> {
      await tick();
    },
  };
}

export type BillingProbe = ReturnType<typeof createBillingProbe>;
