import { useEffect, useRef, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { FocusField } from '../components/FocusField';
import { bumpMarkEgg } from '../brand/easterEggs';
import { TvmMark } from '../brand/TvmMark';
import {
  acceptTerms,
  fetchAccount,
  fetchTerms,
  fetchTiers,
  registerAccount,
  sendEmailCode,
  signIn,
  signOut,
  verifyEmailCode,
  type AccountState,
  type TermsDocument,
  type TiersResponse,
} from '../data/account';
import { formatBillingMoney } from '../data/plan';
import { requestFocus } from '../nav/focusEngine';
import { bindKeyboardFields } from '../nav/pointerInput';
import { confirmFieldOnEnter, gateFocusKey, useGateRemote } from './gateKeys';
import './accountGate.css';

/**
 * What the field actually contains.
 *
 * React state is a render behind the DOM. Enter and a phone's Go key submit
 * in the same turn as the last character, and the state they would have read
 * is the password without that character — which then fails as "those do not
 * match" for a password that was typed correctly.
 */
function typed(id: string, fallback: string): string {
  const node = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-focus-id="${id}"]`);
  return node?.value ?? fallback;
}

/**
 * The sign-in gate. Renders instead of the view stack until an account is
 * signed in, activated by the owner, and has accepted the current terms.
 */
type Mode = 'signin' | 'register';

export interface AccountGateProps {
  state: AccountState;
  onChanged: (next: AccountState) => void;
}

function Prices({ tiers }: { tiers: TiersResponse }): React.JSX.Element {
  return (
    <details className="gate-plans">
      <summary className="gate-plans__toggle">
        <span>Plans &amp; pricing</span>
        <span className="gate-plans__chevron" aria-hidden="true">▾</span>
      </summary>
      <div className="gate-prices">
        <h2>Available plans</h2>
        {tiers.tiers.map((tier) => (
          <div key={tier.id} className="gate-price">
            <div className="gate-price__head">
              <span className="gate-price__name">{tier.name}</span>
              {tier.monthlyPence !== null && (
                <span className="gate-price__amount">
                  {formatBillingMoney(tier.monthlyPence)}<span>/month</span>
                  {tier.liveTvTerms.length > 0 && (
                    <span className="gate-price__plus">
                      plus Live TV from{' '}
                      {formatBillingMoney(Math.min(...tier.liveTvTerms.map((term) => term.amountPence)))}
                    </span>
                  )}
                </span>
              )}
            </div>
            <p className="gate-price__summary">{tier.summary}</p>
            {tier.liveTvTerms.length > 0 && (
              <ul className="gate-price__terms">
                {tier.liveTvTerms.map((term) => (
                  <li key={term.id}>
                    <span>Live TV · {term.name}</span>
                    <span>{formatBillingMoney(term.amountPence)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <p className="gate-prices__route">
          <strong>{tiers.route.headline}.</strong> {tiers.route.detail}
        </p>
      </div>
    </details>
  );
}

function GateMark(): React.JSX.Element {
  const taps = useRef(0);
  return (
    <div className="gate__brand">
      <button
        type="button"
        className="gate__mark-hit"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => { taps.current = bumpMarkEgg(taps.current); }}
      >
        <TvmMark size="md" className="gate__mark" />
      </button>
      <span className="gate__brand-pill">TVM</span>
    </div>
  );
}

function TermsBody({ terms }: { terms: TermsDocument }): React.JSX.Element {
  return (
    <div className="gate-terms" role="document" tabIndex={0}>
      {terms.intro.map((line) => <p key={line} className="gate-terms__intro">{line}</p>)}
      {terms.sections.map((section) => (
        <section key={section.heading}>
          <h3>{section.heading}</h3>
          {section.body.map((line) => <p key={line}>{line}</p>)}
        </section>
      ))}
    </div>
  );
}

export function AccountGate({ state, onChanged }: AccountGateProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [terms, setTerms] = useState<TermsDocument | null>(null);
  const [tiers, setTiers] = useState<TiersResponse | null>(null);
  const pageRef = useRef<HTMLElement>(null);
  // `busy` only updates on the next render, so a double press could otherwise
  // send two requests.
  const inFlight = useRef(false);

  useEffect(() => bindKeyboardFields(pageRef.current), [state.usable.reason, mode]);

  // Signing out goes back to a clean sign-in form.
  useEffect(() => {
    if (state.signedIn) return;
    setMode('signin');
    setEmail('');
    setPassword('');
    setDisplayName('');
    setEmailCode('');
    setNotice(null);
    setMessage(null);
  }, [state.signedIn]);

  useEffect(() => {
    let cancelled = false;
    void fetchTerms().then((doc) => { if (!cancelled) setTerms(doc); });
    void fetchTiers().then((list) => { if (!cancelled) setTiers(list); });
    return () => { cancelled = true; };
  }, []);

  /** Runs one request at a time and shows its error, if any. */
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const submit = (): Promise<void> => run(async () => {
    setNotice(null);
    const nextEmail = typed('gate-email', email).trim();
    const nextPassword = typed('gate-password', password);
    const nextName = typed('gate-name', displayName).trim();
    if (mode === 'register') {
      await registerAccount({ email: nextEmail, password: nextPassword, displayName: nextName });
      onChanged(await signIn({ email: nextEmail, password: nextPassword }));
    } else {
      onChanged(await signIn({ email: nextEmail, password: nextPassword }));
    }
    setPassword('');
  });

  const confirmEmail = (code: string): Promise<void> => run(async () => {
    const digits = typed('gate-code', code).replace(/\s+/g, '');
    if (!/^\d{6}$/.test(digits)) throw new Error('Enter the 6-digit verification code.');
    onChanged(await verifyEmailCode(digits));
    setEmailCode('');
  });

  const resendEmail = (): Promise<void> => run(async () => {
    setNotice(null);
    await sendEmailCode();
    setNotice(`Verification code sent to ${state.account?.email ?? 'your inbox'}.`);
    window.setTimeout(() => requestFocus(gateFocusKey('gate-code')), 0);
  });

  const agree = (): Promise<void> => run(async () => {
    onChanged(await acceptTerms());
  });

  const leave = (): Promise<void> => run(async () => {
    await signOut();
    onChanged(await fetchAccount());
  });

  const reason = state.usable.reason;
  const panel = !state.signedIn
    ? mode
    : reason === 'terms_required' && terms !== null
      ? 'terms'
      : reason ?? 'ready';
  const switchMode = (next: Mode): void => {
    setMode(next);
    setMessage(null);
    setNotice(null);
  };
  const firstFocus = (): string => {
    if (panel === 'terms') return 'agree';
    if (panel === 'email_unverified') return 'gate-code';
    if (state.signedIn) return 'recheck';
    if (mode === 'register') return 'gate-name';
    return 'gate-email';
  };
  useGateRemote({
    panel,
    first: firstFocus(),
    onBack: !state.signedIn && mode !== 'signin' ? () => switchMode('signin') : undefined,
  });
  /** Enter in one field moves to the next; in the last one it submits. */
  const next = (id: string) => (): void => requestFocus(gateFocusKey(id));

  // ---- Terms ------------------------------------------------------------
  if (state.signedIn && reason === 'terms_required' && terms !== null) {
    return (
      <main ref={pageRef} className="gate" data-keyboard-fields="">
        <div className="gate__panel gate__panel--wide">
          <GateMark />
          <h1>Before you start</h1>
          <p className="gate__lede">{terms.summary}</p>
          <p className="gate__meta">Version {terms.version} · Updated {terms.updated}</p>
          <TermsBody terms={terms} />
          {message !== null && <p className="gate__error" role="alert">{message}</p>}
          <div className="gate__actions">
            <FocusButton id="agree" variant="primary" disabled={busy} onSelect={() => void agree()}>
              {busy ? 'Saving…' : 'I have read and agree to these terms'}
            </FocusButton>
          </div>
        </div>
      </main>
    );
  }

  // ---- The emailed code -------------------------------------------------
  if (state.signedIn && reason === 'email_unverified') {
    const address = state.account?.email ?? 'your email address';
    return (
      <main ref={pageRef} className="gate" data-keyboard-fields="">
        <div className="gate__panel">
          <GateMark />
          <h1>Check your email</h1>
          <p className="gate__lede">
            {state.account?.emailCodeSent === true
              ? `Enter the 6-digit code sent to ${address}. Valid for 15 minutes.`
              : `We'll send a 6-digit verification code to ${address}.`}
          </p>
          {notice !== null && <p className="gate__notice" role="status">{notice}</p>}
          {message !== null && <p className="gate__error" role="alert">{message}</p>}
          <form
            className="gate__form"
            noValidate
            onKeyDown={confirmFieldOnEnter}
            onSubmit={(event) => { event.preventDefault(); void confirmEmail(emailCode); }}
          >
            <label className="gate__field">
              <span>Verification code</span>
              <FocusField
                id="gate-code"
                name="one-time-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                enterKeyHint="go"
                value={emailCode}
                onChange={setEmailCode}
                onConfirm={(value) => void confirmEmail(value)}
                afterPasteFocusId="gate-code-submit"
                placeholder="6-digit code"
              />
            </label>
            <div className="gate__actions">
              <FocusButton id="gate-code-submit" variant="primary" disabled={busy} onSelect={() => void confirmEmail(emailCode)}>
                {busy ? 'Verifying…' : 'Verify & continue'}
              </FocusButton>
              <FocusButton id="gate-code-resend" className="tvm-button--glass" disabled={busy} onSelect={() => void resendEmail()}>
                {state.account?.emailCodeSent === true ? 'Resend code' : 'Send code'}
              </FocusButton>
              <FocusButton id="signout" className="tvm-button--glass" disabled={busy} onSelect={() => void leave()}>
                Sign out
              </FocusButton>
            </div>
            <button type="submit" className="gate__implicit-submit" tabIndex={-1} aria-hidden="true" />
          </form>
        </div>
      </main>
    );
  }

  // ---- Waiting on the dev -----------------------------------------------
  if (state.signedIn && (reason === 'awaiting_activation' || reason === 'suspended')) {
    const suspended = reason === 'suspended';
    return (
      <main ref={pageRef} className="gate" data-keyboard-fields="">
        <div className="gate__panel">
          <GateMark />
          <h1>{suspended ? 'This account is switched off' : 'Almost there'}</h1>
          <p className="gate__lede">
            {suspended
              ? 'This profile is currently paused. Contact the app owner if access should be restored.'
              : 'Your email is verified and your account is ready—just waiting on the owner to switch it on.'}
          </p>
          {!suspended && (
            <p className="gate__hint">
              Signed in as <strong>{state.account?.email}</strong>. Share this address with the app owner to finish
              activation.
            </p>
          )}
          {message !== null && <p className="gate__error" role="alert">{message}</p>}
          <div className="gate__actions">
            <FocusButton id="recheck" variant="primary" disabled={busy} onSelect={() => { void fetchAccount().then(onChanged); }}>
              Check status
            </FocusButton>
            <FocusButton id="signout" className="tvm-button--glass" disabled={busy} onSelect={() => void leave()}>
              Sign out
            </FocusButton>
          </div>
          {tiers !== null && !suspended && <Prices tiers={tiers} />}
        </div>
      </main>
    );
  }

  // ---- Signed out --------------------------------------------------------
  return (
    <main ref={pageRef} className="gate" data-keyboard-fields="">
      <div className="gate__panel">
        <GateMark />
        <div className="gate-tabs" role="tablist" aria-label="Sign-in mode" data-wrap="row">
          <FocusButton
            id={mode === 'register' ? 'gate-switch' : 'gate-tab-signin'}
            className={`gate-tab${mode === 'signin' ? ' gate-tab--active' : ''}`}
            disabled={busy}
            onSelect={() => switchMode('signin')}
          >
            Sign in
          </FocusButton>
          <FocusButton
            id={mode === 'signin' ? 'gate-switch' : 'gate-tab-register'}
            className={`gate-tab${mode === 'register' ? ' gate-tab--active' : ''}`}
            disabled={busy}
            onSelect={() => switchMode('register')}
          >
            Create account
          </FocusButton>
        </div>

        <h1>{mode === 'signin' ? 'Sign in to TVM' : 'Ask for an account'}</h1>
        <p className="gate__lede">
          {mode === 'signin'
            ? 'Welcome back. Sign in to resume your shows, channels, and watchlist.'
            : state.canSendEmail === true
              ? "Request access in seconds. We'll email a verification code before the owner activates your profile."
              : 'Request an account below. The app owner will activate your access shortly.'}
        </p>

        {notice !== null && <p className="gate__notice" role="status">{notice}</p>}
        {message !== null && <p className="gate__error" role="alert">{message}</p>}

        <form
          className="gate__form"
          noValidate
          onKeyDown={confirmFieldOnEnter}
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          {mode === 'register' && (
            <label className="gate__field">
              <span>Your name</span>
              <FocusField
                id="gate-name"
                name="name"
                autoComplete="name"
                enterKeyHint="next"
                value={displayName}
                onChange={setDisplayName}
                onConfirm={next('gate-email')}
                afterPasteFocusId="gate-email"
                placeholder="Display name"
              />
            </label>
          )}
          <label className="gate__field">
            <span>Email</span>
            <FocusField
              id="gate-email"
              name="email"
              inputMode="email"
              autoComplete={mode === 'register' ? 'email' : 'username'}
              enterKeyHint="next"
              value={email}
              onChange={setEmail}
              onConfirm={next('gate-password')}
              afterPasteFocusId="gate-password"
              placeholder="you@example.com"
            />
          </label>
          <label className="gate__field">
            <span>Password</span>
            <FocusField
              id="gate-password"
              type="password"
              name="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              enterKeyHint="go"
              value={password}
              onChange={setPassword}
              onConfirm={() => void submit()}
              afterPasteFocusId="gate-submit"
              placeholder={mode === 'register' ? 'At least 10 characters' : 'Enter your password'}
            />
          </label>

          <div className="gate__actions">
            <FocusButton id="gate-submit" variant="primary" disabled={busy} onSelect={() => void submit()}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </FocusButton>
          </div>
          <button type="submit" className="gate__implicit-submit" tabIndex={-1} aria-hidden="true" />
        </form>

        {tiers !== null && <Prices tiers={tiers} />}
      </div>
    </main>
  );
}
