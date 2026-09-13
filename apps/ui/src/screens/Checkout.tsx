import { useEffect, useRef, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { TopBar } from '../components/TopBar';
import { applyPlanClass, checkoutPlan, checkoutQuote, fetchPlan, formatBillingMoney, type PlanId, type PlanStatus } from '../data/plan';
import { applyTheme } from '../theme/apply';
import { SYNTHWAVE_THEME_NAME } from '../theme/registry';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import './billing.css';

const PLAN_IDS: PlanId[] = ['free', 'basic', 'premium', 'ultra', 'max'];
const OUTCOMES = ['success', 'decline', 'cancel'] as const;

export function Checkout({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const requestedId = PLAN_IDS.includes(params['planId'] as PlanId) ? params['planId'] as PlanId : 'free';
  const packOnly = params['pack'] === 'synthwave';
  const [catalog, setCatalog] = useState<PlanStatus | null>(null);
  const [liveTv, setLiveTv] = useState(false);
  const [synthwave, setSynthwave] = useState(packOnly);
  const [consent, setConsent] = useState(false);
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>('success');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<PlanStatus | null>(null);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{ key: string; id: string } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setMessage(null);
    void fetchPlan(controller.signal, true).then((status) => {
      if (controller.signal.aborted) return;
      setCatalog(status);
      setLiveTv(packOnly || status.id === requestedId ? status.liveTv : false);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Unable to load checkout.');
    });
    return () => controller.abort();
  }, [requestedId, packOnly, attempt]);

  const planId = packOnly && catalog ? catalog.id : requestedId;
  const entry = catalog?.catalog.find((item) => item.id === planId);
  const quote = catalog && entry ? checkoutQuote(catalog, planId, liveTv, synthwave, packOnly) : null;
  const owned = catalog?.synthwaveOwned === true;

  const pay = async (): Promise<void> => {
    if (!catalog || !quote || !consent || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    const order = {
      planId, liveTv, synthwave, packOnly, consent: true, simulate: outcome,
      quotedMonthlyPence: quote.monthlyPence, quotedOneTimePence: quote.oneTimePence,
    };
    const key = JSON.stringify(order);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try {
      const status = await checkoutPlan({ ...order, requestId: request.current.id });
      applyPlanClass(status);
      if (synthwave && status.synthwave) applyTheme('synthwave');
      setSuccess(status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Test checkout failed. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (success) return (
    <main className="page page--settings page--checkout billing-page">
      <TopBar title="Test complete" />
      <p className="billing-badge">Sandbox · no money charged</p>
      <h1 className="page__heading">Your test plan is ready</h1>
      <section className="billing-panel" role="status">
        <h2>{success.name}</h2>
        <p>Active on this device immediately. No card was requested, no payment was taken, and nothing will renew or charge automatically.</p>
        <dl className="billing-totals">
          <div><dt>Actually charged</dt><dd>£0.00</dd></div>
          <div><dt>Monthly reference price</dt><dd>{formatBillingMoney(success.pricePence)}</dd></div>
          {quote && quote.oneTimePence > 0 ? <div><dt>Colourcast one-time reference price</dt><dd>{formatBillingMoney(quote.oneTimePence)}</dd></div> : null}
        </dl>
        <p>Playback uses your connected sources. TVM plans do not include subscriptions to streaming services or rights to their programmes.</p>
      </section>
      <div className="hero__actions">
        <FocusButton id="checkout-consent" variant="primary" onSelect={() => navigate.replace('plans')}>View plan & test receipts</FocusButton>
        <FocusButton id="checkout-home" onSelect={() => navigate.home()}>Go to Home</FocusButton>
      </div>
    </main>
  );

  return (
    <main className="page page--settings page--checkout billing-page">
      <TopBar title="Checkout" />
      <p className="billing-badge">Sandbox checkout · initial testing</p>
      <h1 className="page__heading">{packOnly ? `Unlock ${SYNTHWAVE_THEME_NAME}` : `Review ${entry?.name ?? 'your plan'}`}</h1>
      <p className="page__lede">Test every step without a payment card. Reference prices are in GBP; the amount charged is always £0.00.</p>
      {message && <p className="billing-message billing-message--error" role="alert">{message}</p>}
      {!catalog || !entry || !quote ? (
        <section className="billing-panel">
          <p role="status">{message ? 'Checkout is unavailable until current plan information can be loaded.' : 'Loading your plan and current prices…'}</p>
          {message && <FocusButton id="checkout-retry" onSelect={() => setAttempt((value) => value + 1)}>Try again</FocusButton>}
          <FocusButton id="checkout-consent" onSelect={() => navigate.pop()}>Back</FocusButton>
        </section>
      ) : (
        <>
          <div className="billing-layout">
            <section className="billing-panel">
              <p className="plan-current__kicker">Your selection</p>
              <h2>{entry.name}</h2>
              <p>{packOnly ? 'Your current plan and Live TV choice stay as they are.' : 'Changes take effect immediately on this device. There are no renewals, charges or prorated invoices during testing.'}</p>
              {!packOnly && (entry.liveTvAddonPence ?? 0) > 0 && (
                <FocusButton id="live-tv-addon" className="billing-option" disabled={busy} detail={`${liveTv ? 'Selected' : 'Optional'} · ${formatBillingMoney(entry.liveTvAddonPence ?? 0)}/month reference price`} onSelect={() => { setLiveTv((on) => !on); setConsent(false); }}>
                  {liveTv ? '✓ ' : '+ '}Live TV connection pack
                </FocusButton>
              )}
              <p className="billing-fineprint">Live TV connects your own authorised IPTV playlist or provider. No channels or provider subscription are supplied.</p>
              <FocusButton id="synthwave-addon" className="billing-option" disabled={busy || owned || packOnly} detail={owned ? 'Already unlocked · no additional charge' : `One-time ${formatBillingMoney(catalog.synthwaveAddonPence)} reference price`} onSelect={() => { setSynthwave((on) => !on); setConsent(false); }}>
                {owned || synthwave ? '✓ ' : '+ '}{SYNTHWAVE_THEME_NAME} visual pack
              </FocusButton>
              <p className="billing-fineprint">The visual pack stays unlocked when you change or cancel your test plan. It is separate from the monthly price.</p>
            </section>
            <section className="billing-panel billing-panel--summary">
              <p className="plan-current__kicker">Order summary</p>
              <dl className="billing-totals">
                <div><dt>{entry.name}</dt><dd>{formatBillingMoney(entry.basePricePence ?? 0)}/month</dd></div>
                {liveTv && (entry.liveTvAddonPence ?? 0) > 0 && <div><dt>Live TV connection pack</dt><dd>{formatBillingMoney(entry.liveTvAddonPence ?? 0)}/month</dd></div>}
                <div><dt>Monthly reference total{packOnly ? ' (unchanged)' : ''}</dt><dd>{formatBillingMoney(quote.monthlyPence)}</dd></div>
                <div><dt>One-time visual pack</dt><dd>{formatBillingMoney(quote.oneTimePence)}</dd></div>
                <div className="billing-totals__grand"><dt>Actually charged today</dt><dd>£0.00</dd></div>
              </dl>
              <p className="billing-fineprint">No real purchase or tax invoice is created. No renewal date. Live prices, taxes and consumer terms must be confirmed before a real payment service launches.</p>
            </section>
          </div>
          <section className="billing-panel">
            <FocusButton id="checkout-outcome" className="billing-option" disabled={busy} detail={`Current outcome: ${outcome}`} onSelect={() => { setOutcome(OUTCOMES[(OUTCOMES.indexOf(outcome) + 1) % OUTCOMES.length]!); setConsent(false); }}>Test outcome · change</FocusButton>
            <FocusButton id="checkout-consent" className={`billing-option${consent ? ' billing-option--selected' : ''}`} disabled={busy} detail={consent ? 'Confirmed' : 'Select to confirm'} onSelect={() => setConsent((on) => !on)}>
              {consent ? '✓ ' : '○ '}I understand this is a test, no money is charged, and playback requires sources I am authorised to use.
            </FocusButton>
            <div className="hero__actions">
              <FocusButton id="pay" variant="primary" disabled={busy || !consent} onSelect={() => void pay()}>{busy ? 'Completing test…' : 'Confirm test · £0.00 charged'}</FocusButton>
              <FocusButton id="checkout-back" disabled={busy} onSelect={() => navigate.pop()}>Cancel checkout</FocusButton>
              <FocusButton id="checkout-legal" disabled={busy} onSelect={() => navigate.push('legal')}>Terms & privacy</FocusButton>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
