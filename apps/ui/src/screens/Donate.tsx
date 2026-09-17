import { useEffect, useRef, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { TopBar } from '../components/TopBar';
import { formatBillingMoney } from '../data/plan';
import { apiFetch } from '../data/media';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import './billing.css';
import './plans.css';

/**
 * A gift to the operator, and nothing else.
 *
 * Every piece of copy on this screen says the same thing in a different place,
 * which is deliberate rather than repetitive: the failure mode worth designing
 * against is somebody donating in the belief it will switch their account on.
 * The confirmation says it again, after the money has gone, because that is
 * the moment the belief would otherwise form.
 *
 * The card fields are Stripe's own iframe, so the number never reaches TVM.
 */

const STRIPE_JS = 'https://js.stripe.com/v3/';

interface StripeElementsLike {
  create(type: string, options?: Record<string, unknown>): { mount(el: HTMLElement): void; unmount(): void };
  getElement(type: string): { unmount(): void } | null;
  submit(): Promise<{ error?: { message?: string } }>;
}
interface StripeLike {
  elements(options: Record<string, unknown>): StripeElementsLike;
  confirmPayment(options: Record<string, unknown>): Promise<{ error?: { message?: string } }>;
}

function loadStripeJs(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No browser.'));
  const existing = (window as { Stripe?: unknown }).Stripe;
  if (existing !== undefined) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tag = document.querySelector<HTMLScriptElement>(`script[src="${STRIPE_JS}"]`) ?? document.createElement('script');
    tag.addEventListener('load', () => resolve());
    tag.addEventListener('error', () => reject(new Error('Could not load Stripe. Check this device is online.')));
    if (!tag.isConnected) { tag.src = STRIPE_JS; tag.async = true; document.head.appendChild(tag); }
  });
}

interface DonateConfig {
  presets: number[];
  minPence: number;
  maxPence: number;
  publishableKey: string | null;
  copy: { heading: string; lede: string; detail: string; refunds: string };
}

export function Donate(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [config, setConfig] = useState<DonateConfig | null>(null);
  const [amount, setAmount] = useState(500);
  const [stage, setStage] = useState<'choose' | 'card' | 'done'>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<StripeLike | null>(null);
  const elementsRef = useRef<StripeElementsLike | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await apiFetch('/api/donate');
        const body = (await response.json()) as DonateConfig;
        if (!cancelled) {
          setConfig(body);
          setAmount(body.presets[1] ?? body.presets[0] ?? 500);
        }
      } catch {
        if (!cancelled) setError('Donations are unavailable right now.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const begin = async (): Promise<void> => {
    if (busy || config === null) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch('/api/donate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountPence: amount }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await response.json()) as { clientSecret?: string; error?: string };
      if (!response.ok || body.clientSecret === undefined) throw new Error(body.error ?? 'That did not work.');

      await loadStripeJs();
      const factory = (window as unknown as { Stripe: (key: string) => StripeLike }).Stripe;
      if (config.publishableKey === null) throw new Error('Stripe is not configured on this device.');
      const stripe = factory(config.publishableKey);
      const styles = getComputedStyle(document.documentElement);
      const elements = stripe.elements({
        clientSecret: body.clientSecret,
        appearance: {
          theme: 'night',
          variables: {
            colorPrimary: styles.getPropertyValue('--tvm-accent').trim() || '#2f6bff',
            colorBackground: styles.getPropertyValue('--tvm-surface').trim() || '#17122a',
            borderRadius: '10px',
          },
        },
      });
      stripeRef.current = stripe;
      elementsRef.current = elements;
      setStage('card');
      // Mount after the panel exists.
      window.setTimeout(() => {
        if (mountRef.current !== null) elements.create('payment', { layout: 'tabs' }).mount(mountRef.current);
      }, 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const pay = async (): Promise<void> => {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (stripe === null || elements === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const submitted = await elements.submit();
      if (submitted.error !== undefined) { setError(submitted.error.message ?? 'Check the card details.'); return; }
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: { return_url: `${window.location.origin}${window.location.pathname}` },
      });
      if (result.error !== undefined) { setError(result.error.message ?? 'The payment was declined.'); return; }
      setStage('done');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The payment could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  if (stage === 'done') {
    return (
      <main className="page page--settings page--plans">
        <TopBar title="Thank you" />
        <section className="tier-donate tier-donate--done">
          <h1 className="page__heading">Thank you</h1>
          <p className="tier-donate__lede">{formatBillingMoney(amount)} went to the app owner as a gift.</p>
          <p className="tier-donate__detail">
            To be clear, because it matters: this changed nothing about your account. It did not
            create access, activate anything or extend anything. If you were hoping it would,
            contact the app owner — and ask them about a refund, since nothing was sold.
          </p>
          <div className="hero__actions">
            <FocusButton id="donate-back" variant="primary" onSelect={() => navigate.pop()}>Back</FocusButton>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page page--settings page--plans">
      <TopBar title="Donate" />
      <p className="stage__kicker">Optional</p>
      <h1 className="page__heading">{config?.copy.heading ?? 'Donate to the app owner'}</h1>
      <p className="page__lede">{config?.copy.lede ?? 'Entirely optional, and it gives you nothing.'}</p>

      <section className="tier-donate">
        <p className="tier-donate__detail">
          {config?.copy.detail ?? 'A donation is a gift and does not change anything in the app.'}
        </p>
        <p className="tier-donate__refunds">{config?.copy.refunds ?? 'Donations are not refundable, because nothing was sold.'}</p>
      </section>

      {error !== null && <p className="billing-message billing-message--error" role="alert">{error}</p>}

      {stage === 'choose' && config !== null && (
        <>
          <section className="donate-amounts" aria-label="Amount">
            {config.presets.map((preset) => (
              <FocusButton
                key={preset}
                id={`donate-${preset}`}
                className={`billing-option${amount === preset ? ' billing-option--selected' : ''}`}
                disabled={busy}
                onSelect={() => setAmount(preset)}
              >
                {formatBillingMoney(preset)}
              </FocusButton>
            ))}
          </section>
          <div className="hero__actions">
            <FocusButton id="donate-continue" variant="primary" disabled={busy} onSelect={() => void begin()}>
              {busy ? 'Please wait…' : `Donate ${formatBillingMoney(amount)}`}
            </FocusButton>
            <FocusButton id="donate-cancel" disabled={busy} onSelect={() => navigate.pop()}>Cancel</FocusButton>
          </div>
        </>
      )}

      {stage === 'card' && (
        <section className="billing-panel">
          <h2>Pay {formatBillingMoney(amount)}</h2>
          <p className="billing-fineprint">
            The card fields below are served by Stripe, not by TVM. Your card number is never
            stored on this device or by TVM.
          </p>
          <div ref={mountRef} className="stripe-element" />
          <div className="hero__actions">
            <FocusButton id="donate-pay" variant="primary" disabled={busy} onSelect={() => void pay()}>
              {busy ? 'Sending…' : `Send ${formatBillingMoney(amount)}`}
            </FocusButton>
            <FocusButton id="donate-back" disabled={busy} onSelect={() => navigate.pop()}>Cancel</FocusButton>
          </div>
        </section>
      )}
    </main>
  );
}
