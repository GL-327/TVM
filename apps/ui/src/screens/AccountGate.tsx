import { useCallback, useEffect, useRef, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { FocusField } from '../components/FocusField';
import { IconAccountPaused, IconAlertCircle, IconCheck, IconClock, IconEye, IconEyeOff } from '../components/Icons';
import { bumpMarkEgg } from '../brand/easterEggs';
import { TvmMark } from '../brand/TvmMark';
import {
  acceptTerms,
  fetchAccount,
  fetchTerms,
  registerAccount,
  sendEmailCode,
  signIn,
  signOut,
  verifyEmailCode,
  type AccountState,
  type TermsDocument,
} from '../data/account';
import { requestFocus } from '../nav/focusEngine';
import { bindKeyboardFields } from '../nav/pointerInput';
import {
  accountStatusLabel,
  friendlyAccountError,
  MIN_PASSWORD_LENGTH,
  validateEmailInput,
  validatePasswordInput,
} from './accountCopy';
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

function focusInput(id: string): void {
  requestFocus(gateFocusKey(id));
  const node = document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
  node?.focus();
}

type Mode = 'signin' | 'register';
type SignInStep = 'email' | 'password';

export interface AccountGateProps {
  state: AccountState;
  onChanged: (next: AccountState) => void;
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
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string | null }): React.JSX.Element {
  return (
    <p
      id={id}
      className={`gate__field-error${message === null ? ' gate__field-error--empty' : ''}`}
      role={message !== null ? 'alert' : undefined}
      aria-live="polite"
    >
      {message !== null && (
        <>
          <IconAlertCircle className="gate__field-error-icon" />
          <span>{message}</span>
        </>
      )}
    </p>
  );
}

function TermsBody({ terms }: { terms: TermsDocument | null }): React.JSX.Element {
  if (terms === null) {
    return (
      <div className="gate-terms" role="document" tabIndex={0}>
        <p className="gate-terms__intro">
          TVM is a media interface for your own files and sources you are authorised to use. A TVM account does not supply
          rights to films, channels or third-party services.
        </p>
        <section>
          <h3>Your data</h3>
          <p>
            TVM stores your account details, profile names, watch progress and preferences to run your library. Provider
            tokens stay encrypted and are sent only to the services you choose to connect.
          </p>
        </section>
        <section>
          <h3>Access</h3>
          <p>
            New accounts are checked and switched on by the owner. You can export or erase your local TVM data at any
            time from Settings.
          </p>
        </section>
      </div>
    );
  }
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

function PrimaryLabel({ busy, idle, active }: { busy: boolean; idle: string; active: string }): React.JSX.Element {
  if (!busy) return <>{idle}</>;
  return (
    <span className="gate__btn-busy">
      <span className="gate__spinner" aria-hidden="true" />
      <span>{active}</span>
    </span>
  );
}

const RECHECK_INTERVAL_MS = 60_000;
const RECHECK_FOCUS_MIN_AGE_MS = 15_000;

/**
 * The sign-in gate. Renders instead of the view stack until an account is
 * signed in, activated by the owner, and has accepted the current terms.
 */
export function AccountGate({ state, onChanged }: AccountGateProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('signin');
  const [step, setStep] = useState<SignInStep>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [privacyReturnId, setPrivacyReturnId] = useState<string>('gate-privacy');

  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number>(() => Date.now());
  const [terms, setTerms] = useState<TermsDocument | null>(null);

  const pageRef = useRef<HTMLElement>(null);
  // `busy` only updates on the next render, so a double press could otherwise
  // send two requests.
  const inFlight = useRef(false);
  const lastCheckRef = useRef(Date.now());

  const reason = state.usable.reason;

  useEffect(() => bindKeyboardFields(pageRef.current), [reason, mode, step, privacyOpen]);

  // Signing out goes back to a clean sign-in form.
  useEffect(() => {
    if (state.signedIn) return;
    setMode('signin');
    setStep('email');
    setEmail('');
    setPassword('');
    setDisplayName('');
    setEmailCode('');
    setAgreedTerms(false);
    setShowPassword(false);
    setShowForgot(false);
    setPrivacyOpen(false);
    setEmailError(null);
    setPasswordError(null);
    setTermsError(null);
    setCodeError(null);
    setNotice(null);
    setMessage(null);
  }, [state.signedIn]);

  useEffect(() => {
    let cancelled = false;
    void fetchTerms().then((doc) => { if (!cancelled) setTerms(doc); });
    return () => { cancelled = true; };
  }, []);

  /** Runs one request at a time and shows its plain error, if any. */
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage(friendlyAccountError(error, mode === 'register' ? 'register' : 'signin'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const checkWaitingAccount = useCallback(async (manual: boolean): Promise<void> => {
    if (inFlight.current) return;
    if (!manual && Date.now() - lastCheckRef.current < RECHECK_FOCUS_MIN_AGE_MS) return;
    inFlight.current = true;
    if (manual) {
      setBusy(true);
      setMessage(null);
    }
    try {
      const next = await fetchAccount();
      const now = Date.now();
      lastCheckRef.current = now;
      setLastCheckedAt(now);
      onChanged(next);
    } catch (error) {
      if (manual) setMessage(friendlyAccountError(error, 'general'));
    } finally {
      inFlight.current = false;
      if (manual) setBusy(false);
    }
  }, [onChanged]);

  // Auto-recheck every 60 s while Waiting for approval is visible.
  useEffect(() => {
    if (!state.signedIn || reason !== 'awaiting_activation') return undefined;
    const now = Date.now();
    lastCheckRef.current = now;
    setLastCheckedAt(now);
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void checkWaitingAccount(false);
    }, RECHECK_INTERVAL_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void checkWaitingAccount(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [checkWaitingAccount, reason, state.signedIn]);

  const clearErrors = (): void => {
    setEmailError(null);
    setPasswordError(null);
    setTermsError(null);
    setCodeError(null);
    setMessage(null);
  };

  const advanceToPassword = (): void => {
    const nextEmail = typed('gate-email', email).trim();
    setEmail(nextEmail);
    const problem = validateEmailInput(nextEmail);
    if (problem !== null) {
      setEmailError(problem);
      focusInput('gate-email');
      return;
    }
    setEmailError(null);
    setPasswordError(null);
    setMessage(null);
    setShowForgot(false);
    setStep('password');
  };

  const submitSignIn = (): Promise<void> => run(async () => {
    setNotice(null);
    const nextEmail = email.trim();
    const nextPassword = typed('gate-password', password);
    const passwordProblem = validatePasswordInput(nextPassword, false);
    if (passwordProblem !== null) {
      setPasswordError(passwordProblem);
      focusInput('gate-password');
      return;
    }
    setPasswordError(null);
    try {
      const nextState = await signIn({ email: nextEmail, password: nextPassword });
      setPassword('');
      onChanged(nextState);
    } catch (error) {
      setPasswordError(friendlyAccountError(error, 'signin'));
      focusInput('gate-password');
    }
  });

  const submitRegister = (): Promise<void> => run(async () => {
    setNotice(null);
    const nextName = typed('gate-name', displayName).trim();
    const nextEmail = typed('gate-email', email).trim();
    const nextPassword = typed('gate-password', password);
    setDisplayName(nextName);
    setEmail(nextEmail);

    const nextEmailError = validateEmailInput(nextEmail);
    const nextPasswordError = validatePasswordInput(nextPassword, true);
    const nextTermsError = agreedTerms ? null : 'Accept the terms to continue.';
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setTermsError(nextTermsError);

    if (nextEmailError !== null) {
      focusInput('gate-email');
      return;
    }
    if (nextPasswordError !== null) {
      focusInput('gate-password');
      return;
    }
    if (nextTermsError !== null) {
      focusInput('gate-agree-terms');
      return;
    }

    try {
      await registerAccount({ email: nextEmail, password: nextPassword, displayName: nextName });
      const nextState = await signIn({ email: nextEmail, password: nextPassword });
      setPassword('');
      onChanged(nextState);
    } catch (error) {
      setMessage(friendlyAccountError(error, 'register'));
    }
  });

  const confirmEmail = (code: string): Promise<void> => run(async () => {
    const digits = typed('gate-code', code).replace(/\s+/g, '');
    if (!/^\d{6}$/.test(digits)) {
      setCodeError('Enter the 6-digit verification code.');
      focusInput('gate-code');
      return;
    }
    setCodeError(null);
    try {
      const nextState = await verifyEmailCode(digits);
      setEmailCode('');
      onChanged(nextState);
    } catch (error) {
      setCodeError(friendlyAccountError(error, 'verify'));
      focusInput('gate-code');
    }
  });

  const resendEmail = (): Promise<void> => run(async () => {
    setNotice(null);
    setCodeError(null);
    try {
      await sendEmailCode();
      setNotice(`Verification code sent to ${state.account?.email ?? 'your inbox'}.`);
      window.setTimeout(() => requestFocus(gateFocusKey('gate-code')), 0);
    } catch (error) {
      setCodeError(friendlyAccountError(error, 'verify'));
    }
  });

  const agree = (): Promise<void> => run(async () => {
    onChanged(await acceptTerms());
  });

  const leave = (): Promise<void> => run(async () => {
    await signOut();
    onChanged(await fetchAccount());
  });

  const switchMode = (nextMode: Mode): void => {
    setMode(nextMode);
    setStep('email');
    setPassword('');
    setShowPassword(false);
    setShowForgot(false);
    clearErrors();
    setNotice(null);
  };

  const backToEmail = (): void => {
    setStep('email');
    setPassword('');
    setShowPassword(false);
    setShowForgot(false);
    clearErrors();
  };

  const openPrivacy = (returnFocusId: string): void => {
    setPrivacyReturnId(returnFocusId);
    setPrivacyOpen(true);
  };

  const closePrivacy = (): void => {
    setPrivacyOpen(false);
    window.setTimeout(() => requestFocus(gateFocusKey(privacyReturnId)), 0);
  };

  const panel = privacyOpen
    ? 'privacy'
    : !state.signedIn
      ? (mode === 'register' ? 'register' : `signin:${step}`)
      : reason === 'terms_required' && terms !== null
        ? 'terms'
        : reason ?? 'ready';

  const firstFocus = (): string => {
    if (privacyOpen) return 'gate-privacy-close';
    if (state.signedIn) {
      if (reason === 'terms_required') return 'agree';
      if (reason === 'email_unverified') return 'gate-code';
      if (reason === 'suspended') return 'signout';
      return 'recheck';
    }
    if (mode === 'register') return 'gate-name';
    return step === 'password' ? 'gate-password' : 'gate-email';
  };

  const onBack = privacyOpen
    ? closePrivacy
    : !state.signedIn && mode === 'signin' && step === 'password'
      ? backToEmail
      : !state.signedIn && mode !== 'signin'
        ? () => switchMode('signin')
        : undefined;

  useGateRemote({
    panel,
    first: firstFocus(),
    onBack,
  });

  /** Enter in one field moves to the next; in the last one it submits. */
  const next = (id: string) => (): void => focusInput(id);

  // ---- Privacy & terms sheet --------------------------------------------
  if (privacyOpen) {
    return (
      <main ref={pageRef} className="gate" data-keyboard-fields="">
        <div className="gate__panel gate__panel--wide glass-appear">
          <GateMark />
          <div className="gate__header">
            <h1>Privacy &amp; terms</h1>
            <p className="gate__lede">
              {terms?.summary ?? 'How TVM handles your account, viewing history, and third-party sources.'}
            </p>
            {terms !== null && (
              <p className="gate__meta">Version {terms.version} · Updated {terms.updated}</p>
            )}
          </div>
          <TermsBody terms={terms} />
          <div className="gate__actions">
            <FocusButton id="gate-privacy-close" variant="primary" tabIndex={0} onSelect={closePrivacy}>
              Close
            </FocusButton>
          </div>
        </div>
      </main>
    );
  }

  // ---- Terms acceptance -------------------------------------------------
  if (state.signedIn && reason === 'terms_required' && terms !== null) {
    return (
      <main ref={pageRef} className="gate" data-keyboard-fields="">
        <div className="gate__panel gate__panel--wide glass-appear">
          <GateMark />
          <div className="gate__header">
            <h1>Accept the terms to continue</h1>
            <p className="gate__lede">{terms.summary}</p>
            <p className="gate__meta">Version {terms.version} · Updated {terms.updated}</p>
          </div>
          <TermsBody terms={terms} />
          {message !== null && (
            <p className="gate__error" role="alert">
              <IconAlertCircle className="gate__field-error-icon" />
              <span>{message}</span>
            </p>
          )}
          <div className="gate__actions">
            <FocusButton id="agree" variant="primary" tabIndex={0} disabled={busy} onSelect={() => void agree()}>
              <PrimaryLabel busy={busy} idle="I agree and continue" active="Saving…" />
            </FocusButton>
          </div>
          <footer className="gate__footer">
            <FocusButton id="signout" variant="quiet" className="gate__link" tabIndex={0} disabled={busy} onSelect={() => void leave()}>
              Sign out
            </FocusButton>
          </footer>
        </div>
      </main>
    );
  }

  // ---- Email code verification ------------------------------------------
  if (state.signedIn && reason === 'email_unverified') {
    const address = state.account?.email ?? 'your email address';
    return (
      <main ref={pageRef} className="gate" data-keyboard-fields="">
        <div className="gate__panel glass-appear">
          <GateMark />
          <div className="gate__header">
            <h1>Confirm your email to continue</h1>
            <p className="gate__lede">
              {state.account?.emailCodeSent === true
                ? `Enter the 6-digit code sent to ${address}.`
                : `Send a 6-digit verification code to ${address}.`}
            </p>
          </div>
          {notice !== null && <p className="gate__notice" role="status">{notice}</p>}
          {message !== null && (
            <p className="gate__error" role="alert">
              <IconAlertCircle className="gate__field-error-icon" />
              <span>{message}</span>
            </p>
          )}
          <form
            className="gate__form"
            noValidate
            onKeyDown={confirmFieldOnEnter}
            onSubmit={(event) => { event.preventDefault(); void confirmEmail(emailCode); }}
          >
            <div className="gate__field">
              <label className="gate__label" htmlFor="gate-code-input">Verification code</label>
              <FocusField
                id="gate-code"
                inputId="gate-code-input"
                name="one-time-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                enterKeyHint="go"
                tabIndex={0}
                disabled={busy}
                ariaInvalid={codeError !== null}
                ariaDescribedBy={codeError !== null ? 'gate-code-error' : undefined}
                value={emailCode}
                onChange={(val) => { setEmailCode(val); if (codeError !== null) setCodeError(null); }}
                onConfirm={(value) => void confirmEmail(value)}
                afterPasteFocusId="gate-code-submit"
                placeholder="6-digit code"
              />
              <FieldError id="gate-code-error" message={codeError} />
            </div>
            <div className="gate__actions">
              <FocusButton id="gate-code-submit" variant="primary" tabIndex={0} disabled={busy} onSelect={() => void confirmEmail(emailCode)}>
                <PrimaryLabel busy={busy} idle="Verify & continue" active="Verifying…" />
              </FocusButton>
            </div>
            <button type="submit" className="gate__implicit-submit" tabIndex={-1} aria-hidden="true" />
          </form>
          <div className="gate__links">
            <FocusButton id="gate-code-resend" variant="quiet" className="gate__link" tabIndex={0} disabled={busy} onSelect={() => void resendEmail()}>
              {state.account?.emailCodeSent === true ? 'Resend code' : 'Send code'}
            </FocusButton>
          </div>
          <footer className="gate__footer" data-wrap="row">
            <FocusButton id="signout" variant="quiet" className="gate__link" tabIndex={0} disabled={busy} onSelect={() => void leave()}>
              Sign out
            </FocusButton>
            <FocusButton id="gate-privacy" variant="quiet" className="gate__link" tabIndex={0} onSelect={() => openPrivacy('gate-privacy')}>
              Privacy &amp; terms
            </FocusButton>
          </footer>
        </div>
      </main>
    );
  }

  // ---- Waiting for approval / Paused ------------------------------------
  if (state.signedIn && (reason === 'awaiting_activation' || reason === 'suspended')) {
    const suspended = reason === 'suspended';
    const statusText = accountStatusLabel(state);
    const checkedLabel = Date.now() - lastCheckedAt < 10_000 ? 'Last checked just now' : 'Checking automatically every minute';

    return (
      <main ref={pageRef} className="gate" data-keyboard-fields="">
        <div className="gate__panel glass-appear">
          <GateMark />
          <div className="gate__state">
            <div className="gate__state-icon" aria-hidden="true">
              {suspended ? <IconAccountPaused /> : <IconClock />}
            </div>
            <h1>{suspended ? 'Your account is paused' : "You're on the list"}</h1>
            <p className="gate__lede">
              {suspended
                ? 'This account has been paused by the owner. Ask them to turn it back on if you still need access.'
                : "The owner checks new accounts by hand. You can close TVM; we'll let you in as soon as yours is switched on."}
            </p>
            <div className="gate__status-pill">
              <span className="gate__status-email">{state.account?.email}</span>
              <span className="gate__status-dot" aria-hidden="true">·</span>
              <span>{statusText}</span>
            </div>
          </div>

          {message !== null && (
            <p className="gate__error" role="alert">
              <IconAlertCircle className="gate__field-error-icon" />
              <span>{message}</span>
            </p>
          )}

          {!suspended && (
            <div className="gate__actions">
              <FocusButton id="recheck" variant="primary" tabIndex={0} disabled={busy} onSelect={() => void checkWaitingAccount(true)}>
                <PrimaryLabel busy={busy} idle="Check again" active="Checking…" />
              </FocusButton>
              <p className="gate__meta gate__meta--center" role="status" aria-live="polite">
                {checkedLabel}
              </p>
            </div>
          )}

          {suspended && (
            <div className="gate__actions">
              <FocusButton id="signout" className="tvm-button--glass gate__plain-full" tabIndex={0} disabled={busy} onSelect={() => void leave()}>
                <PrimaryLabel busy={busy} idle="Sign out" active="Signing out…" />
              </FocusButton>
            </div>
          )}

          <footer className="gate__footer" data-wrap="row">
            {!suspended && (
              <FocusButton id="signout" variant="quiet" className="gate__link" tabIndex={0} disabled={busy} onSelect={() => void leave()}>
                Sign out
              </FocusButton>
            )}
            <FocusButton id="gate-privacy" variant="quiet" className="gate__link" tabIndex={0} onSelect={() => openPrivacy('gate-privacy')}>
              Privacy &amp; terms
            </FocusButton>
          </footer>
        </div>
      </main>
    );
  }

  // ---- Signed out: Create account ---------------------------------------
  if (mode === 'register') {
    return (
      <main ref={pageRef} className="gate" data-keyboard-fields="">
        <div className="gate__panel glass-appear">
          <GateMark />
          <div className="gate__header">
            <h1>Create your account</h1>
            <p className="gate__lede">Request an account. The owner approves new accounts by hand.</p>
          </div>

          {notice !== null && <p className="gate__notice" role="status">{notice}</p>}
          {message !== null && (
            <p className="gate__error" role="alert">
              <IconAlertCircle className="gate__field-error-icon" />
              <span>{message}</span>
            </p>
          )}

          <form
            className="gate__form"
            noValidate
            onKeyDown={confirmFieldOnEnter}
            onSubmit={(event) => { event.preventDefault(); void submitRegister(); }}
          >
            <div className="gate__fields">
              <div className="gate__field">
                <label className="gate__label" htmlFor="gate-name-input">Name</label>
                <FocusField
                  id="gate-name"
                  inputId="gate-name-input"
                  name="name"
                  autoComplete="name"
                  enterKeyHint="next"
                  tabIndex={0}
                  disabled={busy}
                  value={displayName}
                  onChange={setDisplayName}
                  onConfirm={next('gate-email')}
                  afterPasteFocusId="gate-email"
                  placeholder="Your name (optional)"
                />
              </div>

              <div className="gate__field">
                <label className="gate__label" htmlFor="gate-email-input">Email</label>
                <FocusField
                  id="gate-email"
                  inputId="gate-email-input"
                  type="email"
                  name="email"
                  inputMode="email"
                  autoComplete="email"
                  enterKeyHint="next"
                  tabIndex={0}
                  disabled={busy}
                  ariaInvalid={emailError !== null}
                  ariaDescribedBy={emailError !== null ? 'gate-email-error' : undefined}
                  value={email}
                  onChange={(val) => {
                    setEmail(val);
                    if (emailError !== null) setEmailError(null);
                  }}
                  onBlur={() => {
                    const current = typed('gate-email', email).trim();
                    if (current !== '') setEmailError(validateEmailInput(current));
                  }}
                  onConfirm={next('gate-password')}
                  afterPasteFocusId="gate-password"
                  placeholder="you@example.com"
                />
                <FieldError id="gate-email-error" message={emailError} />
              </div>

              <div className="gate__field">
                <label className="gate__label" htmlFor="gate-password-input">Password</label>
                <div className="gate__password-wrap">
                  <FocusField
                    id="gate-password"
                    inputId="gate-password-input"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="new-password"
                    enterKeyHint="go"
                    tabIndex={0}
                    disabled={busy}
                    ariaInvalid={passwordError !== null}
                    ariaDescribedBy={passwordError !== null ? 'gate-password-error' : 'gate-password-hint'}
                    className="gate__password-input"
                    value={password}
                    onChange={(val) => {
                      setPassword(val);
                      if (passwordError !== null) setPasswordError(null);
                    }}
                    onBlur={() => {
                      const current = typed('gate-password', password);
                      if (current !== '') setPasswordError(validatePasswordInput(current, true));
                    }}
                    onConfirm={() => void submitRegister()}
                    afterPasteFocusId="gate-agree-terms"
                    placeholder="Create a password"
                  />
                  <FocusButton
                    id="gate-password-toggle"
                    variant="quiet"
                    className="gate__eye"
                    tabIndex={0}
                    disabled={busy}
                    ariaLabel={showPassword ? 'Hide password' : 'Show password'}
                    ariaPressed={showPassword}
                    onSelect={() => setShowPassword((showing) => !showing)}
                  >
                    {showPassword ? <IconEyeOff className="gate__eye-icon" /> : <IconEye className="gate__eye-icon" />}
                  </FocusButton>
                </div>
                <p id="gate-password-hint" className="gate__helper">Use at least {MIN_PASSWORD_LENGTH} characters.</p>
                <FieldError id="gate-password-error" message={passwordError} />
              </div>

              <div className="gate__field">
                <div className="gate__check-row">
                  <FocusButton
                    id="gate-agree-terms"
                    variant="quiet"
                    role="checkbox"
                    ariaChecked={agreedTerms}
                    ariaLabel="I agree to the Privacy and terms"
                    tabIndex={0}
                    disabled={busy}
                    className={`gate__check${agreedTerms ? ' gate__check--checked' : ''}`}
                    onSelect={() => {
                      setAgreedTerms((prev) => !prev);
                      if (termsError !== null) setTermsError(null);
                    }}
                  >
                    <span className="gate__checkbox-box" aria-hidden="true">
                      {agreedTerms && <IconCheck className="gate__checkbox-tick" />}
                    </span>
                    <span className="gate__checkbox-label">I agree to the terms</span>
                  </FocusButton>
                  <FocusButton
                    id="gate-terms-link"
                    variant="quiet"
                    className="gate__link gate__link--inline"
                    tabIndex={0}
                    disabled={busy}
                    onSelect={() => openPrivacy('gate-terms-link')}
                  >
                    Privacy &amp; terms
                  </FocusButton>
                </div>
                <FieldError id="gate-terms-error" message={termsError} />
              </div>
            </div>

            <div className="gate__actions">
              <FocusButton id="gate-submit" variant="primary" tabIndex={0} disabled={busy} onSelect={() => void submitRegister()}>
                <PrimaryLabel busy={busy} idle="Create account" active="Creating account…" />
              </FocusButton>
            </div>
            <button type="submit" className="gate__implicit-submit" tabIndex={-1} aria-hidden="true" />
          </form>

          <div className="gate__links">
            <FocusButton id="gate-to-signin" variant="quiet" className="gate__link" tabIndex={0} disabled={busy} onSelect={() => switchMode('signin')}>
              I already have an account
            </FocusButton>
          </div>
        </div>
      </main>
    );
  }

  // ---- Signed out: Sign in (Step 2: Password) ---------------------------
  if (step === 'password') {
    return (
      <main ref={pageRef} className="gate" data-keyboard-fields="">
        <div className="gate__panel glass-appear">
          <GateMark />
          <div className="gate__header">
            <h1>Enter your password</h1>
            <div className="gate__chip-row">
              <span className="gate__email-chip">{email}</span>
              <FocusButton
                id="gate-change-email"
                variant="quiet"
                className="gate__link gate__link--inline"
                tabIndex={0}
                disabled={busy}
                onSelect={backToEmail}
              >
                Change
              </FocusButton>
            </div>
          </div>

          {notice !== null && <p className="gate__notice" role="status">{notice}</p>}
          {message !== null && (
            <p className="gate__error" role="alert">
              <IconAlertCircle className="gate__field-error-icon" />
              <span>{message}</span>
            </p>
          )}

          <form
            className="gate__form"
            noValidate
            onKeyDown={confirmFieldOnEnter}
            onSubmit={(event) => { event.preventDefault(); void submitSignIn(); }}
          >
            <div className="gate__field">
              <label className="gate__label" htmlFor="gate-password-input">Password</label>
              <div className="gate__password-wrap">
                <FocusField
                  id="gate-password"
                  inputId="gate-password-input"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  enterKeyHint="go"
                  tabIndex={0}
                  disabled={busy}
                  ariaInvalid={passwordError !== null}
                  ariaDescribedBy={passwordError !== null ? 'gate-password-error' : undefined}
                  className="gate__password-input"
                  value={password}
                  onChange={(val) => {
                    setPassword(val);
                    if (passwordError !== null) setPasswordError(null);
                  }}
                  onConfirm={() => void submitSignIn()}
                  afterPasteFocusId="gate-submit"
                  placeholder="Enter your password"
                />
                <FocusButton
                  id="gate-password-toggle"
                  variant="quiet"
                  className="gate__eye"
                  tabIndex={0}
                  disabled={busy}
                  ariaLabel={showPassword ? 'Hide password' : 'Show password'}
                  ariaPressed={showPassword}
                  onSelect={() => setShowPassword((showing) => !showing)}
                >
                  {showPassword ? <IconEyeOff className="gate__eye-icon" /> : <IconEye className="gate__eye-icon" />}
                </FocusButton>
              </div>
              <FieldError id="gate-password-error" message={passwordError} />
            </div>

            <div className="gate__actions">
              <FocusButton id="gate-submit" variant="primary" tabIndex={0} disabled={busy} onSelect={() => void submitSignIn()}>
                <PrimaryLabel busy={busy} idle="Sign in" active="Signing in…" />
              </FocusButton>
            </div>
            <button type="submit" className="gate__implicit-submit" tabIndex={-1} aria-hidden="true" />
          </form>

          <div className="gate__links">
            <FocusButton
              id="gate-forgot"
              variant="quiet"
              className="gate__link"
              tabIndex={0}
              disabled={busy}
              onSelect={() => setShowForgot((showing) => !showing)}
            >
              Forgot password?
            </FocusButton>
            {showForgot && (
              <p className="gate__helper gate__helper--center" role="status">
                Ask the owner to reset it.
              </p>
            )}
          </div>

          <footer className="gate__footer">
            <FocusButton id="gate-privacy" variant="quiet" className="gate__link" tabIndex={0} onSelect={() => openPrivacy('gate-privacy')}>
              Privacy &amp; terms
            </FocusButton>
          </footer>
        </div>
      </main>
    );
  }

  // ---- Signed out: Sign in (Step 1: Email) ------------------------------
  return (
    <main ref={pageRef} className="gate" data-keyboard-fields="">
      <div className="gate__panel glass-appear">
        <GateMark />
        <div className="gate__header">
          <h1>Sign in to TVM</h1>
        </div>

        {notice !== null && <p className="gate__notice" role="status">{notice}</p>}
        {message !== null && (
          <p className="gate__error" role="alert">
            <IconAlertCircle className="gate__field-error-icon" />
            <span>{message}</span>
          </p>
        )}

        <form
          className="gate__form"
          noValidate
          onKeyDown={confirmFieldOnEnter}
          onSubmit={(event) => { event.preventDefault(); advanceToPassword(); }}
        >
          <div className="gate__field">
            <label className="gate__label" htmlFor="gate-email-input">Email</label>
            <FocusField
              id="gate-email"
              inputId="gate-email-input"
              type="email"
              name="email"
              inputMode="email"
              autoComplete="username"
              enterKeyHint="next"
              tabIndex={0}
              disabled={busy}
              ariaInvalid={emailError !== null}
              ariaDescribedBy={emailError !== null ? 'gate-email-error' : undefined}
              value={email}
              onChange={(val) => {
                setEmail(val);
                if (emailError !== null) setEmailError(null);
              }}
              onBlur={() => {
                const current = typed('gate-email', email).trim();
                if (current !== '') setEmailError(validateEmailInput(current));
              }}
              onConfirm={advanceToPassword}
              afterPasteFocusId="gate-continue"
              placeholder="you@example.com"
            />
            <FieldError id="gate-email-error" message={emailError} />
          </div>

          <div className="gate__actions">
            <FocusButton id="gate-continue" variant="primary" tabIndex={0} disabled={busy} onSelect={advanceToPassword}>
              Continue
            </FocusButton>
          </div>
          <button type="submit" className="gate__implicit-submit" tabIndex={-1} aria-hidden="true" />
        </form>

        <div className="gate__links">
          <FocusButton id="gate-to-register" variant="quiet" className="gate__link" tabIndex={0} disabled={busy} onSelect={() => switchMode('register')}>
            New here? Create an account
          </FocusButton>
        </div>

        <footer className="gate__footer">
          <FocusButton id="gate-privacy" variant="quiet" className="gate__link" tabIndex={0} onSelect={() => openPrivacy('gate-privacy')}>
            Privacy &amp; terms
          </FocusButton>
        </footer>
      </div>
    </main>
  );
}
