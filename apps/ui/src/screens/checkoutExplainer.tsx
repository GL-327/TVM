import { formatBillingMoney } from '../data/plan';

/**
 * The part of checkout that explains itself.
 *
 * On a phone the order summary is the whole screen rather than a column beside
 * the plan, so the questions a buyer actually has — when am I charged, how much
 * is it every month, what happens to my card, how do I stop — have to be
 * answered in the flow instead of in a footer nobody scrolls to.
 *
 * Every line here is a fact the code can prove: the amount comes from the
 * catalogue, the renewal date from Stripe, and "your card details never reach
 * TVM" is true because the fields belong to Stripe's iframe.
 */

export interface ExplainerProps {
  monthlyPence: number;
  oneTimePence: number;
  /** True once a processor is configured; the sandbox explains itself differently. */
  cardPayments: boolean;
  liveMoney: boolean;
  /** Formatted date of the first renewal, when known. */
  nextChargeAt?: string | null;
}

/** One row of the total, so the arithmetic is visible rather than asserted. */
function Line({ label, value, note }: { label: string; value: string; note?: string }): React.JSX.Element {
  return (
    <div className="checkout-line">
      <div className="checkout-line__label">
        <span>{label}</span>
        {note !== undefined && <span className="checkout-line__note">{note}</span>}
      </div>
      <span className="checkout-line__value">{value}</span>
    </div>
  );
}

export function CheckoutTotals({ monthlyPence, oneTimePence, cardPayments }: ExplainerProps): React.JSX.Element {
  const today = monthlyPence + oneTimePence;
  return (
    <section className="checkout-card" aria-label="What you pay">
      <h2 className="checkout-card__title">What you pay</h2>

      {monthlyPence > 0 && (
        <Line
          label="Monthly plan"
          value={`${formatBillingMoney(monthlyPence)}/month`}
          note="Charged today, then on the same date each month"
        />
      )}

      {oneTimePence > 0 && (
        <Line
          label="Visual pack"
          value={formatBillingMoney(oneTimePence)}
          note="One payment. Yours to keep, even if you cancel"
        />
      )}

      <div className="checkout-line checkout-line--total">
        <div className="checkout-line__label"><span>Total today</span></div>
        <span className="checkout-line__value">
          {cardPayments ? formatBillingMoney(today) : '£0.00'}
        </span>
      </div>

      {monthlyPence > 0 && cardPayments && (
        <p className="checkout-card__after">
          Then {formatBillingMoney(monthlyPence)} every month until you cancel.
        </p>
      )}
    </section>
  );
}

/**
 * The four questions, answered before they are asked.
 *
 * Written as statements of fact rather than reassurance: each one describes
 * something the system actually does, which is why the copy changes with the
 * mode rather than staying vague enough to cover both.
 */
export function CheckoutExplainer({ monthlyPence, cardPayments, liveMoney, nextChargeAt }: ExplainerProps): React.JSX.Element {
  const recurring = monthlyPence > 0;
  return (
    <section className="checkout-card checkout-explainer" aria-label="How this works">
      <h2 className="checkout-card__title">How this works</h2>
      <ol className="checkout-steps">
        <li>
          <span className="checkout-steps__num" aria-hidden="true">1</span>
          <div>
            <h3>You pay by card</h3>
            <p>
              {cardPayments
                ? 'The card form on the next step is served by Stripe, not by TVM. Your card number goes straight to Stripe and is never stored on this device or by TVM — only the last four digits come back, for the receipt.'
                : 'No payment processor is connected yet, so nothing is charged and no card is needed. This is a test checkout.'}
            </p>
          </div>
        </li>

        <li>
          <span className="checkout-steps__num" aria-hidden="true">2</span>
          <div>
            <h3>{recurring ? 'It renews every month' : 'It is a single payment'}</h3>
            <p>
              {recurring
                ? cardPayments
                  ? `The same amount is taken automatically each month${nextChargeAt != null ? `, starting ${nextChargeAt}` : ''}. Nobody has to be here for it to happen — that is what makes it a subscription rather than a one-off purchase.`
                  : 'In a live setup this would renew each month automatically. Nothing renews in the sandbox.'
                : 'A visual pack is bought once. There is no renewal and nothing further is taken.'}
            </p>
          </div>
        </li>

        <li>
          <span className="checkout-steps__num" aria-hidden="true">3</span>
          <div>
            <h3>Your plan starts when the payment clears</h3>
            <p>
              {cardPayments
                ? 'Not when the card form says so — TVM asks Stripe directly and only then unlocks the plan. A declined card leaves nothing behind and costs you nothing.'
                : 'The plan applies immediately on this device.'}
            </p>
          </div>
        </li>

        {recurring && (
          <li>
            <span className="checkout-steps__num" aria-hidden="true">4</span>
            <div>
              <h3>You can stop any time</h3>
              <p>
                Cancel from Settings. You keep the month you have already paid
                for, and nothing is taken again after that.
                {liveMoney ? ' Under UK consumer law you also have 14 days to change your mind.' : ''}
              </p>
            </div>
          </li>
        )}
      </ol>
    </section>
  );
}

export const CHECKOUT_CSS = `
.checkout-card {
  background: var(--tvm-surface);
  border: 1px solid var(--tvm-border-soft);
  border-radius: 14px;
  padding: 1.1rem 1.2rem;
  margin: 0 0 1rem;
}

.checkout-card__title {
  font-size: 0.82rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--tvm-text-faint);
  margin: 0 0 0.9rem;
}

.checkout-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--tvm-border-soft);
}

.checkout-line:last-of-type { border-bottom: none; }

.checkout-line__label { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.checkout-line__note { font-size: 0.78rem; color: var(--tvm-text-faint); }
.checkout-line__value { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }

.checkout-line--total {
  border-top: 1px solid var(--tvm-border);
  border-bottom: none;
  margin-top: 0.35rem;
  padding-top: 0.8rem;
  font-size: 1.15rem;
}

.checkout-card__after {
  margin: 0.7rem 0 0;
  font-size: 0.85rem;
  color: var(--tvm-text-muted);
}

.checkout-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 1rem; }
.checkout-steps li { display: grid; grid-template-columns: 1.6rem 1fr; gap: 0.75rem; align-items: start; }

.checkout-steps__num {
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 50%;
  background: var(--tvm-accent);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 700;
}

.checkout-steps h3 { margin: 0 0 0.2rem; font-size: 0.97rem; }
.checkout-steps p { margin: 0; font-size: 0.87rem; color: var(--tvm-text-muted); line-height: 1.45; }

/*
 * On a phone the summary is the screen rather than a sidebar, so it stacks and
 * the touch targets grow. 44px is the smallest reliably tappable height.
 */
@media (max-width: 760px) {
  .checkout-card { padding: 1rem; border-radius: 12px; }
  .checkout-line { padding: 0.65rem 0; }
  .checkout-line--total { font-size: 1.05rem; }
  .checkout-steps p { font-size: 0.9rem; }
  .billing-page .tvm-button { min-height: 44px; }
}
`;
