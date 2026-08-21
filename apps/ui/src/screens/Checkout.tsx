import { useEffect, useMemo, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { applyPlanClass, checkoutPlan, FALLBACK_PLAN, fetchPlan, type PlanId, type PlanStatus } from '../data/plan';
import { applyTheme } from '../theme/apply';
import { SYNTHWAVE_THEME_NAME } from '../theme/registry';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const PLAN_IDS: PlanId[] = ['free', 'basic', 'premium', 'ultra', 'max'];
const FALLBACK_BASE: Record<PlanId, number> = {
  free: 0,
  basic: 499,
  premium: 899,
  ultra: 1299,
  max: 1599,
};

function asPlanId(value: unknown): PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value) ? (value as PlanId) : 'free';
}

function formatGbp(pence: number): string {
  if (pence === 0) return 'Free';
  return `£${(pence / 100).toFixed(2)}`;
}

export function Checkout({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const planId = asPlanId(params['planId']);
  const name = typeof params['name'] === 'string' ? params['name'] : planId;
  const free = planId === 'free';
  const [catalog, setCatalog] = useState<PlanStatus>(FALLBACK_PLAN);
  const [liveTv, setLiveTv] = useState(planId !== 'free');
  const [synthwave, setSynthwave] = useState(params['pack'] === 'synthwave');
  const [holder, setHolder] = useState('');
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchPlan().then((status) => {
      setCatalog(status);
      const entry = status.catalog.find((item) => item.id === planId);
      if (entry !== undefined) setLiveTv(entry.liveTv);
    });
  }, [planId]);

  const entry = catalog.catalog.find((item) => item.id === planId);
  const addonPence = entry?.liveTvAddonPence ?? (free ? 0 : 300);
  const packPence = catalog.synthwaveAddonPence || 499;
  const basePence = entry?.basePricePence ?? FALLBACK_BASE[planId];
  const canLive = !free && addonPence > 0;
  const extras = entry?.extras ?? [];
  const pricePence = useMemo(() => {
    const pack = synthwave ? packPence : 0;
    if (free) return pack;
    return basePence + (liveTv ? addonPence : 0) + pack;
  }, [addonPence, basePence, free, liveTv, packPence, synthwave]);
  const price = formatGbp(pricePence);
  const current = catalog.id === planId;
  const needsCard = !free || synthwave;

  const pay = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const status = await checkoutPlan(
        needsCard
          ? {
              planId,
              name: fieldValue('card-name') || holder,
              number: fieldValue('card-number') || number,
              expiry: fieldValue('card-expiry') || expiry,
              cvc: fieldValue('card-cvc') || cvc,
              liveTv: free ? false : liveTv,
              synthwave,
            }
          : { planId, liveTv: false, synthwave: false },
      );
      applyPlanClass(status);
      if (synthwave) applyTheme('synthwave');
      navigate.pop();
      navigate.pop();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Checkout failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page--settings page--checkout">
      <TopBar title="Checkout" />
      <p className="stage__kicker">Mock payment · GLogic Studios</p>
      <h1 className="page__heading">{current ? `Manage ${name}` : `Subscribe to ${name}`}</h1>
      <section className="checkout-summary">
        <div>
          <p className="plan-current__kicker">Due today</p>
          <p className="checkout-summary__price">{price}</p>
          <p className="page__lede">
            {free
              ? 'Free stays on TVM Stream. A Real-Debrid token is still required for playback.'
              : 'Mock charge only. The card number is checked with Luhn, then discarded.'}
          </p>
        </div>
        <ul className="checkout-summary__list">
          <li>
            {name} · {formatGbp(basePence)}
          </li>
          {canLive ? <li>Live TV pack · {liveTv ? formatGbp(addonPence) : 'Off'}</li> : null}
          <li>{SYNTHWAVE_THEME_NAME} · {synthwave ? formatGbp(packPence) : 'Off'}</li>
          {catalog.id !== 'free' ? <li>Current: {catalog.name}</li> : null}
          {extras.slice(0, 4).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      {message !== null && <p className="page__message">{message}</p>}
      {canLive && (
        <FocusButton
          id="live-tv-addon"
          className="settings-row"
          detail={liveTv ? `On · ${price}` : `Off · ${formatGbp(basePence)}`}
          onSelect={() => setLiveTv((on) => !on)}
        >
          Live TV pack · £3.00
        </FocusButton>
      )}
      <FocusButton
        id="synthwave-addon"
        className="settings-row"
        detail={synthwave ? `On · ${formatGbp(packPence)}` : `Off · ${formatGbp(packPence)}`}
        onSelect={() => setSynthwave((on) => !on)}
      >
        {SYNTHWAVE_THEME_NAME} pack · {formatGbp(packPence)}
      </FocusButton>
      {needsCard && (
        <div className="checkout-card">
          <p className="plan-current__kicker">Payment</p>
          <label className="token-field">
            <span>Name on card</span>
            <FocusField id="card-name" value={holder} onChange={setHolder} onConfirm={() => undefined} placeholder="Name" />
          </label>
          <label className="token-field">
            <span>Card number</span>
            <FocusField id="card-number" value={number} onChange={setNumber} onConfirm={() => undefined} placeholder="ACCT-000015" />
          </label>
          <div className="checkout-card__row">
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
          </div>
        </div>
      )}
      <div className="hero__actions">
        <FocusButton id="pay" variant="primary" disabled={busy} onSelect={() => void pay()}>
          {busy ? 'Working…' : needsCard ? `Pay ${price} (mock)` : 'Use Free'}
        </FocusButton>
        <FocusButton id="checkout-back" onSelect={() => navigate.pop()}>
          Back
        </FocusButton>
      </div>
    </main>
  );
}
