import { useEffect, useRef, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { StripeCardPanel } from '../components/StripeCardPanel';
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
  formatBillingMoney,
  formatCvcInput,
  formatExpiryInput,
  formatPanInput,
  panLooksValid,
  type PaymentOrderView,
  type PlanId,
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
const OUTCOMES = ['success', 'decline', 'cancel'] as const;

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
  const [liveTv, setLiveTv] = useState(false);
  const [synthwave, setSynthwave] = useState(pack === 'synthwave');
  const [consent, setConsent] = useState(false);
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>('success');
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
      setLiveTv(packOnly || status.id === requestedId ? status.liveTv : false);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Unable to load checkout.');
    });
    void fetchStripeStatus(controller.signal)
      .then((status) => { if (!controller.signal.aborted) setStripe(status); })
      // A processor that cannot be reached is not an error: checkout falls
      // back to the sandbox rather than refusing to open.
      .catch(() => { if (!controller.signal.aborted) setStripe(null); });
    return () => controller.abort();
  }, [requestedId, packOnly, attempt]);

  const planId = packOnly && catalog ? catalog.id : requestedId;
  const entry = catalog?.catalog.find((item) => item.id === planId);
  const quote = catalog && entry ? checkoutQuote(catalog, planId, liveTv, synthwave, packOnly, pack) : null;
  // With Stripe configured the buyer pays for real and the sandbox controls
  // (test outcome, hand-typed card, "£0.00 charged") have no meaning.
  const cardPayments = stripe?.configured === true && stripe.mode !== null;
  const liveMoney = cardPayments && stripe?.mode === 'live';
  const stripeOrder = {
    planId, liveTv, synthwave, pack, packOnly, consent: true,
    requestId: request.current?.id ?? '',
    quotedMonthlyPence: quote?.monthlyPence ?? 0,
    quotedOneTimePence: quote?.oneTimePence ?? 0,
  };
  const owned = pack === 'anime' ? catalog?.animeOwned === true : pack === 'theme-bundle' ? catalog?.bundleOwned === true : catalog?.synthwaveOwned === true;

  if (cardPayments && request.current === null) {
    request.current = { key: 'stripe', id: crypto.randomUUID().replace(/-/g, '') };
  }

  const onPaid = (order: PaymentOrderView): void => {
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
      planId, liveTv, synthwave, pack, packOnly, consent: true, simulate: outcome,
      quotedMonthlyPence: quote.monthlyPence, quotedOneTimePence: quote.oneTimePence,
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
      setMessage(error instanceof Error ? error.message : 'Test checkout failed. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (success) return (
    <main ref={pageRef} className="page page--settings page--checkout billing-page" data-keyboard-fields="">
      <TopBar title="Test complete" />
      <p className="billing-badge">{paid === null ? 'Sandbox · no money charged' : paid.mode === 'live' ? 'Paid by card' : 'Stripe test mode · no real money'}</p>
      <h1 className="page__heading">{paid === null ? 'Your test plan is ready' : 'Your plan is active'}</h1>
      <section className="billing-panel" role="status">
        <h2>{success.name}</h2>
        {paid !== null ? (
          <p>
            {formatBillingMoney(paid.chargedPence)} was charged to your card
            {paid.mode === 'live' ? '' : ' in Stripe test mode'}. Your plan is active on this device.
            {paid.receiptUrl === null ? '' : ' Stripe has emailed you a receipt.'}
          </p>
        ) : storedLast4 ? (
          <p>Card ending {storedLast4} was tokenized and stored encrypted on this device. No payment processor is linked, so nothing was charged and nothing will renew automatically.</p>
        ) : (
          <p>Active on this device immediately. No card was stored, no payment was taken, and nothing will renew or charge automatically.</p>
        )}
        <dl className="billing-totals">
          <div><dt>Actually charged</dt><dd>{paid === null ? '£0.00' : formatBillingMoney(paid.chargedPence)}</dd></div>
          <div><dt>Monthly reference price</dt><dd>{formatBillingMoney(success.pricePence)}</dd></div>
          {quote && quote.oneTimePence > 0 ? <div><dt>Theme one-time reference price</dt><dd>{formatBillingMoney(quote.oneTimePence)}</dd></div> : null}
          {paid?.receiptUrl != null ? <div><dt>Stripe receipt</dt><dd><a href={paid.receiptUrl} target="_blank" rel="noreferrer noopener">View</a></dd></div> : null}
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
    <main ref={pageRef} className="page page--settings page--checkout billing-page" data-keyboard-fields="">
      <TopBar title="Checkout" />
      <p className="billing-badge">{liveMoney ? 'Card payment · real money' : cardPayments ? 'Stripe test mode · no real money' : 'Sandbox checkout · initial testing'}</p>
      <h1 className="page__heading">{packOnly ? `Unlock ${packName(pack!)}` : `Review ${entry?.name ?? 'your plan'}`}</h1>
      <p className="page__lede">
        {liveMoney
          ? 'Prices are in GBP and include VAT where it applies. Your card is charged today for the first month plus any one-off packs. Card details are handled by Stripe and never reach TVM.'
          : cardPayments
            ? 'Stripe is in test mode. The full payment runs end to end with a test card, and no real money moves.'
            : 'Reference prices are in GBP. The amount charged is always £0.00 — no processor is linked. You can confirm without a card, or add one to store a token on this device.'}
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
              <p>{packOnly ? 'Your current plan and Live TV choice stay as they are.' : 'Changes take effect immediately on this device. There are no renewals, charges or prorated invoices during testing.'}</p>
              {!packOnly && (entry.liveTvAddonPence ?? 0) > 0 && (
                <FocusButton id="live-tv-addon" className="billing-option" disabled={busy} detail={`${liveTv ? 'Selected' : 'Optional'} · ${formatBillingMoney(entry.liveTvAddonPence ?? 0)}/month reference price`} onSelect={() => { setLiveTv((on) => !on); setConsent(false); }}>
                  {liveTv ? '✓ ' : '+ '}Live TV connection pack
                </FocusButton>
              )}
              <p className="billing-fineprint">Live TV connects your own authorised IPTV playlist or provider. No channels or provider subscription are supplied.</p>
              <FocusButton id="synthwave-addon" className="billing-option" disabled={busy || owned || packOnly} detail={owned ? 'Already unlocked · no additional charge' : `One-time ${formatBillingMoney(pack === 'anime' ? catalog.animeAddonPence : pack === 'theme-bundle' ? catalog.themeBundlePence : catalog.synthwaveAddonPence)} reference price`} onSelect={() => { setSynthwave((on) => !on); setConsent(false); }}>
                {owned || synthwave || packOnly ? '✓ ' : '+ '}{pack ? packName(pack) : SYNTHWAVE_THEME_NAME} visual pack
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
                <div className="billing-totals__grand">
                  <dt>{cardPayments ? 'Charged today' : 'Actually charged today'}</dt>
                  <dd>{cardPayments ? formatBillingMoney(quote.monthlyPence + quote.oneTimePence) : '£0.00'}</dd>
                </div>
              </dl>
              <p className="billing-fineprint">
                {liveMoney
                  ? 'This is a one-off charge for the first month plus any packs. Nothing renews automatically; you will not be charged again unless you buy again.'
                  : cardPayments
                    ? 'Stripe test mode. The amounts and the flow are real; the money is not.'
                    : 'No real purchase or tax invoice is created. No renewal date. A saved card is tokenized on this device only.'}
              </p>
            </section>
          </div>
          {cardPayments ? null : (
            <section className="billing-panel">
              <p className="plan-current__kicker">Payment card</p>
              <h2>Store an encrypted token</h2>
              <p>Optional. The number and security code are never written in plaintext. Because no processor is linked, a later charge attempt always declines.</p>
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
            {/* A forced test outcome only makes sense when nothing is charged. */}
            {cardPayments ? null : (
              <FocusButton id="checkout-outcome" className="billing-option" disabled={busy} detail={`Current outcome: ${outcome}`} onSelect={() => { setOutcome(OUTCOMES[(OUTCOMES.indexOf(outcome) + 1) % OUTCOMES.length]!); setConsent(false); }}>Test outcome · change</FocusButton>
            )}
            <FocusButton id="checkout-consent" className={`billing-option${consent ? ' billing-option--selected' : ''}`} disabled={busy} detail={consent ? 'Confirmed' : 'Select to confirm'} onSelect={() => setConsent((on) => !on)}>
              {consent ? '✓ ' : '○ '}
              {liveMoney
                ? `I agree to pay ${formatBillingMoney(quote.monthlyPence + quote.oneTimePence)} today, and I have the right to use the sources I play.`
                : cardPayments
                  ? 'I understand this is a Stripe test payment, no real money moves, and playback requires sources I am authorised to use.'
                  : 'I understand this is a test, no money is charged, and playback requires sources I am authorised to use.'}
            </FocusButton>
            {cardPayments ? null : (
              <div className="hero__actions">
                <FocusButton id="pay" variant="primary" disabled={busy || !consent} onSelect={() => void pay()}>{busy ? 'Completing test…' : 'Confirm test · £0.00 charged'}</FocusButton>
                <FocusButton id="checkout-back" disabled={busy} onSelect={() => navigate.pop()}>Cancel checkout</FocusButton>
                <FocusButton id="checkout-legal" disabled={busy} onSelect={() => navigate.push('legal')}>Terms & privacy</FocusButton>
              </div>
            )}
          </section>

          {/* Consent first: the card form must not open a payment the buyer
              has not agreed to. */}
          {cardPayments && consent ? (
            <StripeCardPanel
              order={{ ...stripeOrder, requestId: request.current?.id ?? '' }}
              mode={stripe?.mode ?? 'test'}
              disabled={busy}
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
