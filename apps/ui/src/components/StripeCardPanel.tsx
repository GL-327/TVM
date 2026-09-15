import { useEffect, useRef, useState } from 'react';
import { FocusButton } from './FocusButton';
import { confirmPaymentIntent, formatBillingMoney, startPaymentIntent, type CheckoutRequest, type PaymentOrderView } from '../data/plan';

/**
 * The card form.
 *
 * Every field in here belongs to Stripe, not to TVM: `elements.create('payment')`
 * mounts an iframe served from Stripe's own origin, so the number is typed
 * into Stripe's page and posted straight to Stripe. This component never reads
 * it, the app never receives it, and no part of TVM is in scope for handling
 * it — which is the whole point, and the only way a project this size can take
 * a card honestly.
 *
 * Stripe.js is loaded from js.stripe.com at runtime rather than bundled.
 * Stripe's terms require exactly that: a bundled copy would go stale against
 * their fraud checks and is not permitted.
 */

const STRIPE_JS = 'https://js.stripe.com/v3/';

interface StripeElement {
  mount(target: HTMLElement): void;
  unmount(): void;
  on(event: string, handler: (payload: { error?: { message?: string } }) => void): void;
}

interface StripeElements {
  create(type: string, options?: Record<string, unknown>): StripeElement;
  getElement(type: string): StripeElement | null;
  submit(): Promise<{ error?: { message?: string } }>;
}

interface StripeInstance {
  elements(options: Record<string, unknown>): StripeElements;
  confirmPayment(options: {
    elements: StripeElements;
    clientSecret?: string;
    confirmParams?: Record<string, unknown>;
    redirect?: 'if_required' | 'always';
  }): Promise<{ error?: { message?: string; type?: string }; paymentIntent?: { id: string; status: string } }>;
}

declare global {
  interface Window {
    Stripe?: (key: string, options?: Record<string, unknown>) => StripeInstance;
  }
}

let stripeJsPromise: Promise<void> | null = null;

function loadStripeJs(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No browser.'));
  if (window.Stripe !== undefined) return Promise.resolve();
  if (stripeJsPromise !== null) return stripeJsPromise;
  stripeJsPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${STRIPE_JS}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => { resolve(); });
    script.addEventListener('error', () => {
      stripeJsPromise = null;
      reject(new Error('Could not load Stripe. Check this device is online, then try again.'));
    });
    if (existing === null) {
      script.src = STRIPE_JS;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return stripeJsPromise;
}

export interface StripeCardPanelProps {
  /** The order, priced by the server when the intent is opened. */
  order: CheckoutRequest;
  /** Live keys move real money; the panel says so plainly. */
  mode: 'test' | 'live';
  disabled?: boolean;
  onPaid: (order: PaymentOrderView) => void;
}

export function StripeCardPanel({ order, mode, disabled = false, onPaid }: StripeCardPanelProps): React.JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const intentRef = useRef<{ id: string; clientSecret: string } | null>(null);
  const inFlight = useRef(false);
  const [ready, setReady] = useState(false);
  const [amountPence, setAmountPence] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const orderKey = JSON.stringify(order);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);

    void (async () => {
      try {
        const started = await startPaymentIntent(order);
        if (cancelled) return;
        intentRef.current = { id: started.paymentIntentId, clientSecret: started.clientSecret };
        setAmountPence(started.amountPence);

        await loadStripeJs();
        if (cancelled) return;
        const factory = window.Stripe;
        if (factory === undefined) throw new Error('Stripe did not load.');

        const stripe = factory(started.publishableKey);
        // Inherit the app's own colours so the iframe does not look pasted in.
        const styles = getComputedStyle(document.documentElement);
        const elements = stripe.elements({
          clientSecret: started.clientSecret,
          appearance: {
            theme: 'night',
            variables: {
              colorPrimary: styles.getPropertyValue('--accent').trim() || '#9b5cff',
              colorBackground: styles.getPropertyValue('--surface').trim() || '#16161c',
              colorText: styles.getPropertyValue('--text').trim() || '#f5f5f7',
              borderRadius: '10px',
            },
          },
        });
        elementsRef.current = elements;
        stripeRef.current = stripe;

        const payment = elements.create('payment', { layout: 'tabs' });
        payment.on('change', (event) => { setError(event.error?.message ?? null); });
        if (mountRef.current !== null && !cancelled) {
          payment.mount(mountRef.current);
          setReady(true);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not start the payment.');
      }
    })();

    return () => {
      cancelled = true;
      elementsRef.current?.getElement('payment')?.unmount();
      elementsRef.current = null;
      stripeRef.current = null;
    };
  }, [orderKey, attempt]);

  const pay = async (): Promise<void> => {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    const intent = intentRef.current;
    if (stripe === null || elements === null || intent === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const submitted = await elements.submit();
      if (submitted.error !== undefined) {
        setError(submitted.error.message ?? 'Check the card details.');
        return;
      }
      // redirect: 'if_required' keeps the buyer here for a normal card and
      // still allows the redirect that 3-D Secure sometimes demands.
      const result = await stripe.confirmPayment({
        elements,
        clientSecret: intent.clientSecret,
        redirect: 'if_required',
        confirmParams: { return_url: `${window.location.origin}${window.location.pathname}` },
      });
      if (result.error !== undefined) {
        setError(result.error.message ?? 'The payment was declined.');
        return;
      }
      // Stripe says it worked; the server still re-reads it before granting.
      const settled = await confirmPaymentIntent(intent.id);
      if (settled.status === 'paid') onPaid(settled);
      else setError(settled.failureMessage ?? 'The payment has not completed yet. Give it a moment and try again.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The payment could not be completed.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="billing-panel">
      <p className="plan-current__kicker">Payment card</p>
      <h2>{mode === 'live' ? 'Pay by card' : 'Pay by card · Stripe test mode'}</h2>
      {mode === 'live' ? (
        <p>This is a real payment. Your card will be charged{amountPence === null ? '' : ` ${formatBillingMoney(amountPence)}`} and the money goes to TVM&rsquo;s Stripe account.</p>
      ) : (
        <p>Stripe is in test mode, so no real money moves. Use card <code>4242 4242 4242 4242</code>, any future expiry, any CVC and any postcode.</p>
      )}
      <p className="billing-fineprint">
        The card fields below are served by Stripe, not by TVM. Your card number is sent
        straight to Stripe and is never stored on this device or by TVM.
      </p>

      <div ref={mountRef} className="stripe-element" />

      {!ready && error === null && <p role="status">Loading the secure card form…</p>}
      {error !== null && <p className="billing-message billing-message--error" role="alert">{error}</p>}

      <div className="hero__actions">
        <FocusButton
          id="pay"
          variant="primary"
          disabled={disabled || busy || !ready}
          onSelect={() => void pay()}
        >
          {busy ? 'Taking payment…' : amountPence === null ? 'Pay' : `Pay ${formatBillingMoney(amountPence)}`}
        </FocusButton>
        {error !== null && (
          <FocusButton id="stripe-retry" disabled={busy} onSelect={() => setAttempt((value) => value + 1)}>
            Start again
          </FocusButton>
        )}
      </div>
    </section>
  );
}
