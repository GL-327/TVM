import { useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { applyPlanClass, cancelPlan, chargeSavedCard, fetchBilling, formatBillingMoney, type BillingStatus } from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
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
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Billing is unavailable.');
    });
    return () => abort.abort();
  }, [attempt]);
  const cancel = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const plan = await cancelPlan(crypto.randomUUID());
      applyPlanClass(plan); setConfirm(false); onChange(); setAttempt((v) => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Cancellation failed. Try again.'); }
    finally { setBusy(false); }
  };
  const charge = async (): Promise<void> => {
    if (busy || !billing?.paymentMethod) return;
    setBusy(true); setError(''); setChargeNote('');
    try {
      const result = await chargeSavedCard(billing.paymentMethod.tokenId);
      setChargeNote(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : 'Charge attempt failed.'); }
    finally { setBusy(false); }
  };
  return <section className="billing-panel">
    <h2>Billing & receipts</h2>
    <p className="billing-badge">{billing?.processor?.linked ? 'Card payments via Stripe' : 'Billing'}</p>
    {error && <p role="alert">{error}</p>}
    {!billing && <FocusButton id="billing-retry" onSelect={() => { setError(''); setAttempt((v) => v + 1); }}>Refresh billing</FocusButton>}
    {billing && <>
      <p>Monthly plan: {formatBillingMoney(billing.monthlyPence)}. Next charge: {billing.nextChargeAt ? new Date(billing.nextChargeAt).toLocaleDateString() : 'when due'}.</p>
      {billing.paymentMethod ? (
        <p>Saved card: {billing.paymentMethod.brand} ending {billing.paymentMethod.last4}, expires {billing.paymentMethod.expiry}.</p>
      ) : (
        <p>No card token on this device.</p>
      )}
      {billing.processor?.linked === false && <p className="billing-fineprint">Card processor is not connected on this device ({billing.processor.reason}).</p>}
      <p className="billing-fineprint">TVM plans provide app features. Provider subscriptions and rights to watch content are separate. Retro is a one-time visual pack. Live TV is billed on 3-month, 1-year or lifetime terms.</p>
      {billing.paymentMethod && <div className="hero__actions">
        <FocusButton id="billing-charge" disabled={busy} onSelect={() => void charge()}>{busy ? 'Charging…' : 'Charge saved card'}</FocusButton>
      </div>}
      {chargeNote && <p role="status">{chargeNote}</p>}
      {billing.subscription === 'active' && <div className="hero__actions">
        <FocusButton id="billing-cancel" disabled={busy} onSelect={() => confirm ? void cancel() : setConfirm(true)}>{busy ? 'Cancelling…' : confirm ? 'Confirm cancellation — return to Free' : 'Cancel plan'}</FocusButton>
        {confirm && <FocusButton id="billing-keep" disabled={busy} onSelect={() => setConfirm(false)}>Keep plan</FocusButton>}
      </div>}
      {confirm && <p>Cancellation takes effect for future charges. Visual packs stay unlocked.</p>}
      <ul className="billing-receipts">{billing.receipts.slice(0, 10).map((receipt) => <li key={receipt.id}>
        <strong>{receipt.event === 'cancellation' ? 'Plan cancelled' : `Order · ${receipt.planId}`}</strong>
        <p className="billing-fineprint">{new Date(receipt.at).toLocaleString()} · Monthly {formatBillingMoney(receipt.monthlyPence)} · One-time {formatBillingMoney(receipt.oneTimePence)} · Charged {formatBillingMoney(receipt.chargedPence)}<br />{receipt.id}</p>
      </li>)}</ul>
      {billing.receipts.length === 0 && <p>No payments yet.</p>}
    </>}
    <FocusButton id="billing-terms" onSelect={() => navigate.push('legal')}>Privacy, terms & data export</FocusButton>
  </section>;
}
