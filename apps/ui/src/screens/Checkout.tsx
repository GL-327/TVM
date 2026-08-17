import { useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { applyPlanClass, checkoutPlan, type PlanId } from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const PLAN_IDS: PlanId[] = ['free', 'basic', 'premium', 'ultra', 'max'];

function asPlanId(value: unknown): PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value) ? (value as PlanId) : 'free';
}

export function Checkout({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const planId = asPlanId(params['planId']);
  const name = typeof params['name'] === 'string' ? params['name'] : planId;
  const price = typeof params['price'] === 'string' ? params['price'] : '';
  const free = planId === 'free';
  const [holder, setHolder] = useState('');
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pay = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const status = await checkoutPlan(
        free
          ? { planId }
          : {
              planId,
              name: fieldValue('card-name') || holder,
              number: fieldValue('card-number') || number,
              expiry: fieldValue('card-expiry') || expiry,
              cvc: fieldValue('card-cvc') || cvc,
            },
      );
      applyPlanClass(status);
      navigate.pop();
      navigate.pop();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Checkout failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page--settings">
      <TopBar title="Checkout" />
      <p className="stage__kicker">Mock payment · GLogic Studios</p>
      <h1 className="page__heading">{name}</h1>
      <p className="page__lede">
        {free
          ? 'Free stays on TVM Stream. A Real-Debrid token is still required for playback, or a studio pool token later.'
          : `${price} per month. This is a mock charge. The card number is checked with Luhn, then discarded.`}
      </p>
      {message !== null && <p className="page__message">{message}</p>}
      {!free && (
        <>
          <label className="token-field">
            <span>Name on card</span>
            <FocusField id="card-name" value={holder} onChange={setHolder} onConfirm={() => undefined} placeholder="Name" />
          </label>
          <label className="token-field">
            <span>Card number</span>
            <FocusField id="card-number" value={number} onChange={setNumber} onConfirm={() => undefined} placeholder="ACCT-000015" />
          </label>
          <label className="token-field">
            <span>Expiry</span>
            <FocusField id="card-expiry" value={expiry} onChange={setExpiry} onConfirm={() => undefined} placeholder="MM/YY" />
          </label>
          <label className="token-field">
            <span>Security code</span>
            <FocusField
              id="card-cvc"
              type="password"
              value={cvc}
              onChange={setCvc}
              onConfirm={() => void pay()}
              afterPasteFocusId="pay"
              placeholder="CVC"
            />
          </label>
        </>
      )}
      <div className="hero__actions">
        <FocusButton id="pay" variant="primary" disabled={busy} onSelect={() => void pay()}>
          {busy ? 'Working…' : free ? 'Use Free' : `Pay ${price} (mock)`}
        </FocusButton>
        <FocusButton id="checkout-back" onSelect={() => navigate.pop()}>
          Back
        </FocusButton>
      </div>
    </main>
  );
}
