import { randomUUID } from 'node:crypto';
import type { StripeClient } from './stripeClient.ts';

/**
 * Donations.
 *
 * A donation is a gift. It buys nothing, unlocks nothing, activates nothing
 * and extends nothing — and that has to be true in the code, not only in the
 * copy, which is why this module has no access to the plan service, the
 * accounts service or the entitlement store. There is no wire along which a
 * donation could grant anything even by mistake.
 *
 * That separation is also the legally safer shape. Money taken in exchange for
 * access is a sale, with consumer rights, refund duties and a description that
 * has to match what is delivered. Money given with nothing offered in return
 * is a gift. Blurring the two — "donate and I'll switch you on" — would make
 * it a sale wearing a gift's label, and the label is not what decides.
 */

/** Suggested amounts, in pence. The payer can choose their own. */
export const DONATION_PRESETS = [200, 500, 1000, 2500] as const;
export const DONATION_MIN_PENCE = 100;
export const DONATION_MAX_PENCE = 50_000;

export interface DonationStart {
  paymentIntentId: string;
  clientSecret: string;
  amountPence: number;
  currency: 'GBP';
}

export function donationProblem(amountPence: unknown): string | null {
  if (typeof amountPence !== 'number' || !Number.isInteger(amountPence)) return 'Choose an amount.';
  if (amountPence < DONATION_MIN_PENCE) return 'The smallest donation is £1.00.';
  if (amountPence > DONATION_MAX_PENCE) return 'For anything above £500, please contact the app owner directly.';
  return null;
}

export interface DonationServiceOptions {
  client: () => StripeClient;
  publishableKey: () => string | null;
}

export function createDonationService(options: DonationServiceOptions) {
  return {
    presets(): { presets: readonly number[]; minPence: number; maxPence: number; publishableKey: string | null } {
      return {
        presets: DONATION_PRESETS,
        minPence: DONATION_MIN_PENCE,
        maxPence: DONATION_MAX_PENCE,
        publishableKey: options.publishableKey(),
      };
    },

    /**
     * Opens a one-off payment to the operator.
     *
     * Deliberately a plain PaymentIntent and never a subscription: a recurring
     * gift nobody remembered agreeing to is the thing donation flows get sued
     * over. The metadata marks it as a donation so it is obvious in the Stripe
     * dashboard which money was a gift and which was for access.
     */
    async begin(amountPence: number): Promise<DonationStart> {
      const problem = donationProblem(amountPence);
      if (problem !== null) throw new Error(problem);

      const intent = await options.client().createPaymentIntent({
        amountPence,
        description: 'Donation to the TVM app owner (no goods or services)',
        metadata: { kind: 'donation', grants: 'nothing' },
        idempotencyKey: `tvm_donation_${randomUUID().replace(/-/g, '')}`,
      });

      if (intent.clientSecret === null) throw new Error('Stripe did not return a payment to confirm.');
      return {
        paymentIntentId: intent.id,
        clientSecret: intent.clientSecret,
        amountPence,
        currency: 'GBP',
      };
    },
  };
}

export type DonationService = ReturnType<typeof createDonationService>;

/**
 * The wording shown beside the button.
 *
 * Kept here rather than in the interface so the same sentences are used
 * everywhere and cannot quietly soften into implying a benefit.
 */
export const DONATION_COPY = {
  heading: 'Donate to the app owner',
  lede: 'Entirely optional, and it gives you nothing.',
  detail:
    'This is a gift to the person who runs TVM. It does not create an account, activate one, upgrade one, extend one, or change anything in the app. If you want access, contact the owner instead — do not donate and expect it.',
  refunds: 'Donations are not refundable, because nothing was sold.',
} as const;
