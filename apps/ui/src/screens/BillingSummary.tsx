import { useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { applyPlanClass, cancelPlan, chargeSavedCard, fetchBilling, formatBillingMoney, type BillingStatus } from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import { friendlyAccountError, friendlyPlanName, friendlyProcessorReason } from './accountCopy';
import './billing.css';

export function BillingSummary({ onChange }: { onChange: () => void }): React.JSX.Element {
  const navigate = useNavigate();
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chargeNote, setChargeNote] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    void fetchBilling(abort.signal).then(setBilling).catch((e: unknown) => {
      if (!abort.signal.aborted) setError(friendlyAccountError(e, 'billing'));
    });
    return () => abort.abort();
  }, [attempt]);

  const cancel = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const plan = await cancelPlan(crypto.randomUUID());
      applyPlanClass(plan);
      setConfirm(false);
      onChange();
      setAttempt((v) => v + 1);
    } catch (e) {
      setError(friendlyAccountError(e, 'billing'));
    } finally {
      setBusy(false);
    }
  };

  const charge = async (): Promise<void> => {
    if (busy || !billing?.paymentMethod) return;
    setBusy(true);
    setError('');
    setChargeNote('');
    try {
      const result = await chargeSavedCard(billing.paymentMethod.tokenId);
      setChargeNote(result.message);
    } catch (e) {
      setError(friendlyAccountError(e, 'billing'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass glass--card billing-panel">
      <div className="billing-panel__head">
        <h2>Billing &amp; receipts</h2>
        <span className="billing-badge">
          {billing?.processor?.linked ? 'Card billing via Stripe' : 'Billing'}
        </span>
      </div>

      {error && <p className="billing-message billing-message--error" role="alert">{error}</p>}

      {!billing && (
        <div className="billing-actions">
          <FocusButton
            id="billing-retry"
            className="tvm-button--glass billing-btn"
            onSelect={() => { setError(''); setAttempt((v) => v + 1); }}
          >
            Refresh billing
          </FocusButton>
        </div>
      )}

      {billing && (
        <>
          <dl className="panel__rows billing-rows">
            <div className="panel__row">
              <dt>Monthly plan</dt>
              <dd>{formatBillingMoney(billing.monthlyPence)}</dd>
            </div>
            <div className="panel__row">
              <dt>Next charge</dt>
              <dd>{billing.nextChargeAt ? new Date(billing.nextChargeAt).toLocaleDateString() : 'When due'}</dd>
            </div>
            <div className="panel__row">
              <dt>Saved card</dt>
              <dd>
                {billing.paymentMethod
                  ? `${billing.paymentMethod.brand} ending ${billing.paymentMethod.last4}, expires ${billing.paymentMethod.expiry}`
                  : 'No saved card on this device'}
              </dd>
            </div>
          </dl>

          {billing.processor?.linked === false && (
            <p className="billing-fineprint">{friendlyProcessorReason(billing.processor.reason)}</p>
          )}
          <p className="billing-fineprint">
            TVM plans provide app features. Provider subscriptions and rights to watch content are separate.
          </p>

          {(billing.paymentMethod || billing.subscription === 'active') && (
            <div className="billing-actions">
              {billing.paymentMethod && (
                <FocusButton
                  id="billing-charge"
                  variant={billing.subscription === 'active' ? 'standard' : 'primary'}
                  className={billing.subscription === 'active' ? 'tvm-button--glass billing-btn' : 'billing-btn'}
                  disabled={busy}
                  onSelect={() => void charge()}
                >
                  {busy ? 'Charging…' : 'Charge saved card'}
                </FocusButton>
              )}
              {billing.subscription === 'active' && !confirm && (
                <FocusButton
                  id="billing-cancel"
                  className="tvm-button--glass billing-btn"
                  disabled={busy}
                  onSelect={() => setConfirm(true)}
                >
                  Cancel plan
                </FocusButton>
              )}
              {billing.subscription === 'active' && confirm && (
                <>
                  <FocusButton
                    id="billing-keep"
                    variant="primary"
                    className="billing-btn"
                    disabled={busy}
                    onSelect={() => setConfirm(false)}
                  >
                    Keep plan
                  </FocusButton>
                  <FocusButton
                    id="billing-cancel"
                    className="tvm-button--glass billing-btn billing-btn--danger"
                    disabled={busy}
                    onSelect={() => void cancel()}
                  >
                    {busy ? 'Cancelling…' : 'Confirm cancellation'}
                  </FocusButton>
                </>
              )}
            </div>
          )}

          {chargeNote && <p className="billing-message" role="status">{chargeNote}</p>}
          {confirm && <p className="billing-fineprint">Cancellation stops future charges and returns your plan to Free.</p>}

          {billing.receipts.length > 0 ? (
            <ul className="billing-receipts">
              {billing.receipts.slice(0, 10).map((receipt) => (
                <li key={receipt.id}>
                  <strong>{receipt.event === 'cancellation' ? 'Plan cancelled' : `Order · ${friendlyPlanName(receipt.planId)}`}</strong>
                  <p className="billing-fineprint">
                    {new Date(receipt.at).toLocaleString()} · Monthly {formatBillingMoney(receipt.monthlyPence)} · One-time {formatBillingMoney(receipt.oneTimePence)} · Charged {formatBillingMoney(receipt.chargedPence)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="billing-fineprint">No payments yet.</p>
          )}
        </>
      )}

      <div className="billing-footer">
        <FocusButton
          id="billing-terms"
          variant="quiet"
          className="billing-link"
          onSelect={() => navigate.push('legal')}
        >
          Privacy, terms &amp; data export
        </FocusButton>
      </div>
    </section>
  );
}
