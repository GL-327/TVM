import { useEffect, useRef, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { FocusField } from '../components/FocusField';
import { TvmMark } from '../brand/TvmMark';
import {
  acceptTerms,
  fetchTerms,
  fetchTiers,
  registerAccount,
  signIn,
  type AccountState,
  type TermsDocument,
  type TiersResponse,
} from '../data/account';
import { formatBillingMoney } from '../data/plan';
import { bindKeyboardFields } from '../nav/pointerInput';
import './accountGate.css';

/**
 * The door.
 *
 * Nothing in TVM works until an account exists, has been switched on by the
 * owner, and has agreed to the terms. This screen covers all four states that
 * can stand between someone and the app, and says which one they are in rather
 * than failing generically:
 *
 *   signed out            sign in, or ask for an account
 *   awaiting activation   the owner has not switched them on yet
 *   terms required        current terms have not been agreed
 *   suspended             switched off
 *
 * "Awaiting activation" is the common one and the one worth getting right. It
 * is not an error and must not read like a fault in the app — the person has
 * done everything correctly and is waiting on a human.
 */

type Mode = 'signin' | 'register';

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
                {/* Both tiers cost the same monthly figure, so without this the first
                    screen anyone sees quoted one price for two different things. */}
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [terms, setTerms] = useState<TermsDocument | null>(null);
  const [tiers, setTiers] = useState<TiersResponse | null>(null);
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => bindKeyboardFields(pageRef.current), [state.usable.reason, mode]);

  useEffect(() => {
    let cancelled = false;
    void fetchTerms().then((doc) => { if (!cancelled) setTerms(doc); });
    void fetchTiers().then((list) => { if (!cancelled) setTiers(list); });
    return () => { cancelled = true; };
  }, []);

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setNotice(null);
    try {
      if (mode === 'register') {
        await registerAccount({ email, password, displayName });
        // Sign straight in so they land on "waiting to be switched on" rather
        // than a form they have just filled in.
        onChanged(await signIn({ email, password }));
        setNotice('Account created. It needs to be switched on by the app owner before you can watch anything.');
      } else {
        onChanged(await signIn({ email, password }));
      }
      setPassword('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const agree = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      onChanged(await acceptTerms());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That could not be recorded. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const reason = state.usable.reason;

  // ---- Terms ------------------------------------------------------------
  if (state.signedIn && reason === 'terms_required' && terms !== null) {
    return (
      <main ref={pageRef} className="gate" data-keyboard-fields="">
        <div className="gate__panel gate__panel--wide">
          <TvmMark size="md" className="gate__mark" />
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

  // ---- Waiting on the owner ---------------------------------------------
  if (state.signedIn && (reason === 'awaiting_activation' || reason === 'suspended')) {
    const suspended = reason === 'suspended';
    return (
      <main ref={pageRef} className="gate">
        <div className="gate__panel">
          <TvmMark size="md" className="gate__mark" />
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
          {tiers !== null && !suspended && <Prices tiers={tiers} />}
          <div className="gate__actions">
            <FocusButton id="recheck" variant="primary" disabled={busy} onSelect={() => { void (async () => { const { fetchAccount } = await import('../data/account'); onChanged(await fetchAccount()); })(); }}>
              Check again
            </FocusButton>
            <FocusButton id="signout" onSelect={() => { void (async () => { const { signOut, fetchAccount } = await import('../data/account'); await signOut(); onChanged(await fetchAccount()); })(); }}>
              Sign out
            </FocusButton>
          </div>
        </div>
      </main>
    );
  }

  // ---- Signed out --------------------------------------------------------
  return (
    <main ref={pageRef} className="gate" data-keyboard-fields="">
      <div className="gate__panel">
        <TvmMark size="md" className="gate__mark" />
        <h1>{mode === 'signin' ? 'Sign in to TVM' : 'Ask for an account'}</h1>
        <p className="gate__lede">
          {mode === 'signin'
            ? 'TVM is not open to the public. Sign in with the account the app owner set up for you.'
            : 'Creating an account does not give you access on its own. The app owner switches accounts on by hand.'}
        </p>

        {notice !== null && <p className="gate__notice" role="status">{notice}</p>}
        {message !== null && <p className="gate__error" role="alert">{message}</p>}

        {mode === 'register' && (
          <label className="gate__field">
            <span>Your name</span>
            <FocusField id="gate-name" value={displayName} onChange={setDisplayName} onConfirm={setDisplayName} afterPasteFocusId="gate-email" placeholder="What should the owner call you?" />
          </label>
        )}
        <label className="gate__field">
          <span>Email</span>
          <FocusField id="gate-email" value={email} onChange={setEmail} onConfirm={setEmail} afterPasteFocusId="gate-password" placeholder="you@example.com" />
        </label>
        <label className="gate__field">
          <span>Password</span>
          <FocusField id="gate-password" type="password" value={password} onChange={setPassword} onConfirm={setPassword} afterPasteFocusId="gate-submit" placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'} />
        </label>

        <div className="gate__actions">
          <FocusButton id="gate-submit" variant="primary" disabled={busy} onSelect={() => void submit()}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </FocusButton>
          <FocusButton
            id="gate-switch"
            disabled={busy}
            onSelect={() => { setMode(mode === 'signin' ? 'register' : 'signin'); setMessage(null); setNotice(null); }}
          >
            {mode === 'signin' ? 'I need an account' : 'I already have an account'}
          </FocusButton>
        </div>

        {tiers !== null && <Prices tiers={tiers} />}
      </div>
    </main>
  );
}
