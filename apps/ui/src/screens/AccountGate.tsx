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
  signInDev,
  signOut,
  verifyEmailCode,
  type AccountState,
  type TermsDocument,
  type TiersResponse,
} from '../data/account';
import { fetchAppBuild, type AppBuild } from '../data/appBuild';
import { formatBillingMoney } from '../data/plan';
import { requestFocus } from '../nav/focusEngine';
import { bindKeyboardFields } from '../nav/pointerInput';
import { confirmFieldOnEnter, gateFocusKey, useGateRemote } from './gateKeys';
import './accountGate.css';

/**
 * The sign-in screen. Nothing in TVM works until an account is signed in,
 * switched on by the dev and has agreed to the terms, and this is rendered
 * instead of the app until then. Each state gets its own panel:
 *
 *   signed out            sign in, ask for an account, or use the dev account
 *   email unverified      type in the code we emailed
 *   awaiting activation   the dev has not switched them on yet
 *   terms required        current terms have not been agreed
 *   suspended             switched off
 */

type Mode = 'signin' | 'register' | 'dev';

export interface AccountGateProps {
  state: AccountState;
  onChanged: (next: AccountState) => void;
}

function Prices({ tiers }: { tiers: TiersResponse }): React.JSX.Element {
  return (
    <div className="gate-prices">
      <h2>What access costs</h2>
      {tiers.tiers.map((tier) => (
        <div key={tier.id} className="gate-price">
          <div className="gate-price__head">
            <span className="gate-price__name">{tier.name}</span>
            {tier.monthlyPence !== null && (
              <span className="gate-price__amount">
                {formatBillingMoney(tier.monthlyPence)}<span>/month</span>
                {/* Both tiers share the monthly figure; Live TV is what differs. */}
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
  );
}

function GateMark(): React.JSX.Element {
  const [, setTaps] = useState(0);
  return (
    <button
      type="button"
      className="gate__mark-hit"
      aria-hidden="true"
      tabIndex={-1}
      onClick={() => setTaps((count) => bumpMarkEgg(count))}
    >
      <TvmMark size="md" className="gate__mark" />
    </button>
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
  const [devCode, setDevCode] = useState('');
  const [devBuild, setDevBuild] = useState<AppBuild | null>(null);
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

  // Signing out goes back to a clean sign-in form. On a shared television the
  // next person should not see the last person's address, or a notice meant
  // for them.
  useEffect(() => {
    if (state.signedIn) return;
    setMode('signin');
    setEmail('');
    setPassword('');
    setDisplayName('');
    setDevCode('');
    setDevBuild(null);
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
      setMessage(error instanceof Error ? error.message : 'That did not work. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const submit = (): Promise<void> => run(async () => {
    setNotice(null);
    if (mode === 'register') {
      await registerAccount({ email, password, displayName });
      // Straight in, so they land on the next step rather than a form they
      // have just filled in.
      onChanged(await signIn({ email, password }));
    } else {
      onChanged(await signIn({ email, password }));
    }
    setPassword('');
  });

  const submitDev = (code: string): Promise<void> => run(async () => {
    if (code.trim() === '') throw new Error('Enter the dev code.');
    try {
      onChanged(await signInDev(code.trim()));
    } catch (error) {
      // The code is checked by the app, not by this interface, and a phone
      // updates the two separately. Naming the build turns "that code is not
      // valid" into something you can act on.
      setDevBuild(await fetchAppBuild());
      throw error;
    }
    setDevCode('');
  });

  const confirmEmail = (code: string): Promise<void> => run(async () => {
    const digits = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(digits)) throw new Error('The code is the six digits in the email.');
    onChanged(await verifyEmailCode(digits));
    setEmailCode('');
  });

  const resendEmail = (): Promise<void> => run(async () => {
    setNotice(null);
    await sendEmailCode();
    setNotice(`A new code is on its way to ${state.account?.email ?? 'your inbox'}.`);
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
    setDevBuild(null);
  };
  const firstFocus = (): string => {
    if (panel === 'terms') return 'agree';
    if (panel === 'email_unverified') return 'gate-code';
    if (state.signedIn) return 'recheck';
    if (mode === 'register') return 'gate-name';
    if (mode === 'dev') return 'gate-dev-code';
    return 'gate-email';
  };
  useGateRemote({
    panel,
    first: firstFocus(),
    // Back from "Ask for an account" or the dev code returns to signing in.
    // Anywhere else there is nothing behind the door to go back to.
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
          <p className="gate__meta">Version {terms.version} · updated {terms.updated}</p>
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
              ? `We sent a six-digit code to ${address}. Type it in to confirm the address is yours. It works for 15 minutes.`
              : `We need to send a code to ${address} to confirm it's yours. Ask for one below.`}
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
              <span>Code</span>
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
                placeholder="123456"
              />
            </label>
            <div className="gate__actions">
              <FocusButton id="gate-code-submit" variant="primary" disabled={busy} onSelect={() => void confirmEmail(emailCode)}>
                {busy ? 'Checking…' : 'Confirm'}
              </FocusButton>
              <FocusButton id="gate-code-resend" disabled={busy} onSelect={() => void resendEmail()}>
                {state.account?.emailCodeSent === true ? 'Send a new code' : 'Send the code'}
              </FocusButton>
              <FocusButton id="signout" disabled={busy} onSelect={() => void leave()}>
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
              ? 'Access to this account has been turned off by the app owner. Contact them if you think that is a mistake.'
              : 'Your account exists and your sign-in works. It needs the app owner to switch it on before there is anything to watch.'}
          </p>
          {!suspended && (
            <p className="gate__hint">
              Signed in as <strong>{state.account?.email}</strong>. Send that address to the
              app owner and ask them to activate it.
            </p>
          )}
          {message !== null && <p className="gate__error" role="alert">{message}</p>}
          <div className="gate__actions">
            <FocusButton id="recheck" variant="primary" disabled={busy} onSelect={() => { void fetchAccount().then(onChanged); }}>
              Check again
            </FocusButton>
            <FocusButton id="signout" disabled={busy} onSelect={() => void leave()}>
              Sign out
            </FocusButton>
          </div>
          {tiers !== null && !suspended && <Prices tiers={tiers} />}
        </div>
      </main>
    );
  }

  // ---- The dev account ---------------------------------------------------
  if (!state.signedIn && mode === 'dev') {
    return (
      <main ref={pageRef} className="gate" data-keyboard-fields="">
        <div className="gate__panel">
          <GateMark />
          <h1>Dev account</h1>
          <p className="gate__lede">
            Enter the dev code to sign in to the dev account. Dev mode stays on until you sign out.
          </p>
          {message !== null && <p className="gate__error" role="alert">{message}</p>}
          {devBuild !== null && devBuild.kind !== 'desktop' && (
            <p className="gate__hint">
              {devBuild.kind === 'known'
                ? `This app was built from ${devBuild.build}.`
                : 'This app is too old to say which build it is.'}{' '}
              The code is checked by the app itself, not by this screen, so install the latest
              build from GitHub and try again.
            </p>
          )}
          <form
            className="gate__form"
            noValidate
            onKeyDown={confirmFieldOnEnter}
            onSubmit={(event) => { event.preventDefault(); void submitDev(devCode); }}
          >
            <label className="gate__field">
              <span>Dev code</span>
              <FocusField
                id="gate-dev-code"
                type="password"
                name="dev-code"
                autoComplete="off"
                enterKeyHint="go"
                value={devCode}
                onChange={setDevCode}
                onConfirm={(value) => void submitDev(value)}
                afterPasteFocusId="gate-dev-submit"
                placeholder="Dev code"
              />
            </label>
            <div className="gate__actions">
              <FocusButton id="gate-dev-submit" variant="primary" disabled={busy} onSelect={() => void submitDev(devCode)}>
                {busy ? 'Checking…' : 'Sign in'}
              </FocusButton>
              <FocusButton id="gate-dev-back" disabled={busy} onSelect={() => switchMode('signin')}>
                Back
              </FocusButton>
            </div>
            <button type="submit" className="gate__implicit-submit" tabIndex={-1} aria-hidden="true" />
          </form>
        </div>
      </main>
    );
  }

  // ---- Signed out --------------------------------------------------------
  return (
    <main ref={pageRef} className="gate" data-keyboard-fields="">
      <div className="gate__panel">
        <GateMark />
        <h1>{mode === 'signin' ? 'Sign in to TVM' : 'Ask for an account'}</h1>
        <p className="gate__lede">
          {mode === 'signin'
            ? 'TVM is not open to the public. Sign in with the account the app owner set up for you.'
            : state.canSendEmail === true
              ? "We'll email you a code to confirm your address. After that the app owner switches the account on by hand."
              : 'Creating an account does not give you access on its own. The app owner switches accounts on by hand.'}
        </p>

        {notice !== null && <p className="gate__notice" role="status">{notice}</p>}
        {message !== null && <p className="gate__error" role="alert">{message}</p>}

        {/* A real form, so a phone's Go key and a desktop's Enter both sign
            in. Submit is always intercepted, so it never navigates. */}
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
                placeholder="What should the owner call you?"
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
              placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'}
            />
          </label>

          <div className="gate__actions">
            <FocusButton id="gate-submit" variant="primary" disabled={busy} onSelect={() => void submit()}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </FocusButton>
            <FocusButton id="gate-switch" disabled={busy} onSelect={() => switchMode(mode === 'signin' ? 'register' : 'signin')}>
              {mode === 'signin' ? 'I need an account' : 'I already have an account'}
            </FocusButton>
            {mode === 'signin' && (
              <FocusButton id="gate-dev" disabled={busy} onSelect={() => switchMode('dev')}>
                I'm a dev
              </FocusButton>
            )}
          </div>
          <button type="submit" className="gate__implicit-submit" tabIndex={-1} aria-hidden="true" />
        </form>

        {tiers !== null && <Prices tiers={tiers} />}
      </div>
    </main>
  );
}
