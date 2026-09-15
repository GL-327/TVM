import { useEffect, useRef, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { StripeCardPanel } from '../components/StripeCardPanel';
import { CheckoutExplainer, CheckoutTotals, CHECKOUT_CSS } from './checkoutExplainer';
import {
  applyPlanClass,
  cardholderLooksValid,
  checkoutPlan, checkoutPack, packName,
  checkoutQuote,
  cvcLooksValid,
  digitsOnly,
  expiryLooksValid,
  fetchPlan,
  fetchStripeStatus,
  fetchSubscription,
  formatBillingMoney,
  formatChargeDate,
  formatCvcInput,
  formatExpiryInput,
  formatPanInput,
  formatUsdCents,
  LIVE_TV_TERMS,
  panLooksValid,
  type LiveTvTerm,
  type PaymentOrderView,
  type PlanId,
  type SubscriptionView,
  type PlanStatus,
  type StripeStatus,
} from '../data/plan';
import { applyTheme } from '../theme/apply';
import { SYNTHWAVE_THEME_NAME } from '../theme/registry';
import { bindKeyboardFields } from '../nav/pointerInput';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import './billing.css';

const PLAN_IDS: PlanId[] = ['free', 'basic', 'premium', 'ultra', 'max'];

function cardPayload(name: string, number: string, expiry: string, cvc: string, zip: string): {
  name: string; number: string; expiry: string; cvc: string; zip?: string;
} | { error: string } | null {
  const filled = name.trim() !== '' || digitsOnly(number) !== '' || expiry.trim() !== '' || cvc.trim() !== '' || zip.trim() !== '';
  if (!filled) return null;
  if (!cardholderLooksValid(name) || !panLooksValid(number) || !expiryLooksValid(expiry) || !cvcLooksValid(cvc)) {
    return { error: 'Check the cardholder name, number, expiry and security code.' };
  }
  return {
    name: name.trim(),
    number: digitsOnly(number),
    expiry: expiry.trim(),
    cvc: cvc.trim(),
    ...(zip.trim() !== '' ? { zip: zip.trim() } : {}),
  };
}

export function Checkout({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const requestedId = PLAN_IDS.includes(params['planId'] as PlanId) ? params['planId'] as PlanId : 'free';
  const pack = checkoutPack(params['pack']);
  const packOnly = pack !== undefined;
  const [catalog, setCatalog] = useState<PlanStatus | null>(null);
  const [liveTvTerm, setLiveTvTerm] = useState<LiveTvTerm | null>(null);
  const [synthwave, setSynthwave] = useState(pack === 'synthwave');
  const [consent, setConsent] = useState(false);
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [cardZip, setCardZip] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<PlanStatus | null>(null);
  const [storedLast4, setStoredLast4] = useState<string | null>(null);
  const [stripe, setStripe] = useState<StripeStatus | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [paid, setPaid] = useState<PaymentOrderView | null>(null);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{ key: string; id: string } | null>(null);
  const inFlight = useRef(false);
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => bindKeyboardFields(pageRef.current), []);

  useEffect(() => {
    const controller = new AbortController();
    setMessage(null);
    void fetchPlan(controller.signal, true).then((status) => {
      if (controller.signal.aborted) return;
      setCatalog(status);
      if ((packOnly || status.id === requestedId) && status.liveTvTerm) setLiveTvTerm(status.liveTvTerm);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Unable to load checkout.');
    });
    void fetchSubscription(controller.signal)
      .then((view) => { if (!controller.signal.aborted) setSubscription(view); })
      .catch(() => undefined);
    void fetchStripeStatus(controller.signal)
      .then((status) => { if (!controller.signal.aborted) setStripe(status); })
      .catch(() => { if (!controller.signal.aborted) setStripe(null); });
    return () => controller.abort();
  }, [requestedId, packOnly, attempt]);

  const planId = packOnly && catalog ? catalog.id : requestedId;
  const entry = catalog?.catalog.find((item) => item.id === planId);
  const terms = catalog?.liveTvTerms?.length ? catalog.liveTvTerms : LIVE_TV_TERMS;
  const selectedLive = terms.find((row) => row.id === liveTvTerm) ?? null;
  const quote = catalog && entry
    ? checkoutQuote(catalog, planId, liveTvTerm !== null, synthwave, packOnly, pack, liveTvTerm)
    : null;
  const cardPayments = stripe?.configured === true && stripe.mode !== null;
  const liveMoney = cardPayments && stripe?.mode === 'live';
  const stripeOrder = {
    planId,
    liveTv: liveTvTerm !== null,
    liveTvTerm,
    synthwave,
    pack,
    packOnly,
    consent: true,
    requestId: request.current?.id ?? '',
    quotedMonthlyPence: quote?.monthlyPence ?? 0,
    quotedOneTimePence: quote?.oneTimePence ?? 0,
  };
  const owned = pack === 'anime' ? catalog?.animeOwned === true : pack === 'theme-bundle' ? catalog?.bundleOwned === true : catalog?.synthwaveOwned === true;
  const recurring = (quote?.monthlyPence ?? 0) > 0 || (quote?.liveTvPence ?? 0) > 0;

  if (cardPayments && request.current === null) {
    request.current = { key: 'stripe', id: crypto.randomUUID().replace(/-/g, '') };
  }

  const onPaid = (order: PaymentOrderView | null): void => {
    setPaid(order);
    void fetchPlan(undefined, true).then((status) => {
      applyPlanClass(status);
      if (pack === 'anime' && status.anime) applyTheme('anime');
      else if (synthwave && status.synthwave) applyTheme('synthwave');
      setSuccess(status);
    }).catch(() => {
      setMessage('Your payment went through, but the plan could not be reloaded. Reopen TVM to see it.');
    });
  };

  const pay = async (): Promise<void> => {
    if (!catalog || !quote || !consent || inFlight.current) return;
    const card = cardPayload(cardName, cardNumber, cardExpiry, cardCvc, cardZip);
    if (card !== null && 'error' in card) {
      setMessage(card.error);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    const order = {
      planId,
      liveTv: liveTvTerm !== null,
      liveTvTerm,
      synthwave,
      pack,
      packOnly,
      consent: true,
      quotedMonthlyPence: quote.monthlyPence,
      quotedOneTimePence: quote.oneTimePence,
    };
    const key = JSON.stringify(order);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try {
      const status = await checkoutPlan({
        ...order,
        requestId: request.current.id,
        ...(card ?? {}),
      });
      applyPlanClass(status);
      if (pack === 'anime' && status.anime) applyTheme('anime');
      else if (synthwave && status.synthwave) applyTheme('synthwave');
      setStoredLast4(card ? card.number.slice(-4) : null);
      setCardNumber('');
      setCardCvc('');
      setSuccess(status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Payment failed. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (success) return (
    <main ref={pageRef} className="page page--settings page--checkout billing-page" data-keyboard-fields="">
      <TopBar title="Payment complete" />
      <p className="billing-badge">Paid · {success.name}</p>
      <h1 className="page__heading">Your plan is active</h1>
      <section className="billing-panel" role="status">
        <h2>{success.name}</h2>
        <p>
          {formatBillingMoney(paid?.chargedPence ?? quote?.dueTodayPence ?? success.pricePence)} was charged
          {storedLast4 ? ` to the card ending ${storedLast4}` : paid !== null ? ' to your card' : ''}.
          Your plan is active on this device.
          {paid?.receiptUrl ? ' Stripe has emailed you a receipt.' : ''}
        </p>
        <dl className="billing-totals">
          <div><dt>Charged</dt><dd>{formatBillingMoney(paid?.chargedPence ?? quote?.dueTodayPence ?? 0)}</dd></div>
          <div><dt>Monthly plan</dt><dd>{formatBillingMoney(success.pricePence)}</dd></div>
          {success.liveTv && selectedLive ? (
            <div><dt>Live TV</dt><dd>{selectedLive.name} · {formatUsdCents(selectedLive.usdCents)}</dd></div>
          ) : null}
          {quote && quote.oneTimePence > 0 && selectedLive?.id !== 'lifetime' ? (
            <div><dt>One-time</dt><dd>{formatBillingMoney(quote.oneTimePence)}</dd></div>
          ) : null}
          {paid?.receiptUrl != null ? <div><dt>Stripe receipt</dt><dd><a href={paid.receiptUrl} target="_blank" rel="noreferrer noopener">View</a></dd></div> : null}
        </dl>
        <p>Playback uses your connected sources. TVM plans do not include subscriptions to streaming services or rights to their programmes.</p>
      </section>
      <div className="hero__actions">
        <FocusButton id="checkout-consent" variant="primary" onSelect={() => navigate.replace('plans')}>View plan & receipts</FocusButton>
        <FocusButton id="checkout-home" onSelect={() => navigate.home()}>Go to Home</FocusButton>
      </div>
    </main>
  );

  return (
    <main ref={pageRef} className="page page--settings page--checkout billing-page" data-keyboard-fields="">
      <style>{CHECKOUT_CSS}</style>
      <TopBar title="Checkout" />
      <p className="billing-badge">{cardPayments ? 'Card payment via Stripe' : 'Checkout'}</p>
      <h1 className="page__heading">{packOnly ? `Unlock ${packName(pack!)}` : `Review ${entry?.name ?? 'your plan'}`}</h1>
      <p className="page__lede">
        Prices are in GBP and include VAT where it applies. Live TV is listed in US dollars and charged at the same figures in GBP.
        {cardPayments
          ? ' Your card is charged today for the first period plus any one-off packs. Card details are handled by Stripe and never reach TVM.'
          : ' Confirm the order to start this plan on this device.'}
      </p>
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
              <p>{packOnly ? 'Your current plan stays as it is. Live TV is billed on its own terms.' : 'Your plan starts when payment clears. Recurring items renew until you cancel.'}</p>
              {!packOnly && (entry.liveTvAddonPence ?? 0) > 0 && (
                <div className="billing-live-terms">
                  <p className="plan-current__kicker">Live TV</p>
                  <p className="billing-fineprint">Live TV is billed separately: 3-month, 1-year, or lifetime. It connects your own authorised IPTV playlist or provider. No channels are supplied.</p>
                  {terms.map((term) => (
                    <FocusButton
                      key={term.id}
                      id={`live-tv-${term.id}`}
                      className={`billing-option${liveTvTerm === term.id ? ' billing-option--selected' : ''}`}
                      disabled={busy}
                      detail={`${formatUsdCents(term.usdCents)} · ${term.blurb}`}
                      onSelect={() => {
                        setLiveTvTerm((current) => current === term.id ? null : term.id);
                        setConsent(false);
                      }}
                    >
                      {liveTvTerm === term.id ? '✓ ' : ''}Live TV {term.name} · {formatUsdCents(term.usdCents)}
                    </FocusButton>
                  ))}
                </div>
              )}
              <FocusButton id="synthwave-addon" className="billing-option" disabled={busy || owned || packOnly} detail={owned ? 'Already unlocked · no additional charge' : `One-time ${formatBillingMoney(pack === 'anime' ? catalog.animeAddonPence : pack === 'theme-bundle' ? catalog.themeBundlePence : catalog.synthwaveAddonPence)}`} onSelect={() => { setSynthwave((on) => !on); setConsent(false); }}>
                {owned || synthwave || packOnly ? '✓ ' : '+ '}{pack ? packName(pack) : SYNTHWAVE_THEME_NAME} visual pack
              </FocusButton>
              <p className="billing-fineprint">The visual pack stays unlocked when you change or cancel your plan. It is separate from the monthly price.</p>
            </section>
            <div className="billing-panel--summary">
              <CheckoutTotals
                monthlyPence={quote.monthlyPence}
                oneTimePence={quote.oneTimePence}
                liveTvPence={quote.liveTvPence}
                liveTvTerm={selectedLive}
                dueTodayPence={quote.dueTodayPence}
                cardPayments={cardPayments}
                liveMoney={liveMoney}
                nextChargeAt={formatChargeDate(subscription?.nextChargeAt ?? null)}
              />
              <CheckoutExplainer
                monthlyPence={quote.monthlyPence}
                oneTimePence={quote.oneTimePence}
                liveTvPence={quote.liveTvPence}
                liveTvTerm={selectedLive}
                dueTodayPence={quote.dueTodayPence}
                cardPayments={cardPayments}
                liveMoney={liveMoney}
                nextChargeAt={formatChargeDate(subscription?.nextChargeAt ?? null)}
              />
            </div>
          </div>
          {cardPayments ? null : (
            <section className="billing-panel">
              <p className="plan-current__kicker">Payment card</p>
              <h2>Card details</h2>
              <p>
                Optional on this device. The number is checked for shape and then
                discarded — only the last four digits, the brand and the expiry are
                recorded for the receipt.
              </p>
              <label className="token-field">
                <span>Cardholder name</span>
                <FocusField id="billing-name" value={cardName} onChange={setCardName} onConfirm={setCardName} afterPasteFocusId="billing-number" placeholder="Name on card" />
              </label>
              <label className="token-field">
                <span>Card number</span>
                <FocusField id="billing-number" value={cardNumber} onChange={(value) => setCardNumber(formatPanInput(value))} onConfirm={(value) => setCardNumber(formatPanInput(value))} afterPasteFocusId="billing-expiry" placeholder="Number" />
              </label>
              <label className="token-field">
                <span>Expiry</span>
                <FocusField id="billing-expiry" value={cardExpiry} onChange={(value) => setCardExpiry(formatExpiryInput(value))} onConfirm={(value) => setCardExpiry(formatExpiryInput(value))} afterPasteFocusId="billing-cvc" placeholder="MM/YY" />
              </label>
              <label className="token-field">
                <span>Security code</span>
                <FocusField id="billing-cvc" type="password" value={cardCvc} onChange={(value) => setCardCvc(formatCvcInput(value))} onConfirm={(value) => setCardCvc(formatCvcInput(value))} afterPasteFocusId="billing-zip" placeholder="CVC" />
              </label>
              <label className="token-field">
                <span>Billing ZIP or postcode (optional)</span>
                <FocusField id="billing-zip" value={cardZip} onChange={setCardZip} onConfirm={setCardZip} afterPasteFocusId="checkout-consent" placeholder="Optional" />
              </label>
            </section>
          )}
          <section className="billing-panel">
            <FocusButton id="checkout-consent" className={`billing-option${consent ? ' billing-option--selected' : ''}`} disabled={busy} detail={consent ? 'Confirmed' : 'Select to confirm'} onSelect={() => setConsent((on) => !on)}>
              {consent ? '✓ ' : '○ '}
              {`I agree to pay ${formatBillingMoney(quote.dueTodayPence)} today, and I have the right to use the sources I play.`}
            </FocusButton>
            {cardPayments ? null : (
              <div className="hero__actions">
                <FocusButton id="pay" variant="primary" disabled={busy || !consent} onSelect={() => void pay()}>{busy ? 'Taking payment…' : `Pay ${formatBillingMoney(quote.dueTodayPence)}`}</FocusButton>
                <FocusButton id="checkout-back" disabled={busy} onSelect={() => navigate.pop()}>Cancel checkout</FocusButton>
                <FocusButton id="checkout-legal" disabled={busy} onSelect={() => navigate.push('legal')}>Terms & privacy</FocusButton>
              </div>
            )}
          </section>

          {cardPayments && consent ? (
            <StripeCardPanel
              order={{ ...stripeOrder, requestId: request.current?.id ?? '' }}
              mode={stripe?.mode ?? 'test'}
              disabled={busy}
              recurring={recurring}
              onPaid={onPaid}
            />
          ) : null}

          {cardPayments ? (
            <div className="hero__actions">
              <FocusButton id="checkout-back" disabled={busy} onSelect={() => navigate.pop()}>Cancel checkout</FocusButton>
              <FocusButton id="checkout-legal" disabled={busy} onSelect={() => navigate.push('legal')}>Terms & privacy</FocusButton>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
