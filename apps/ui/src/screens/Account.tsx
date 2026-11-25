import { useEffect, useState } from 'react';
import { BackButton } from '../components/BackButton';
import { FocusButton } from '../components/FocusButton';
import { PageScene } from '../components/PageScene';
import { Ribbon } from '../components/Ribbon';
import {
  announceAccountChange,
  fetchAccount,
  shortDate,
  signOut,
  type AccountState,
} from '../data/account';
import { fetchRdStatus, type RdStatus } from '../data/media';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import { accountStatusLabel, friendlyPlanName } from './accountCopy';
import './billing.css';

const EMPTY_RD: RdStatus = { configured: false, username: null, premium: false, error: null };

function rdDetail(rd: RdStatus): string {
  if (!rd.configured) return 'Connect';
  if (rd.error === 'needs-auth') return 'Key rejected · Connect';
  return rd.username !== null ? `Connected · ${rd.username}` : 'Connected';
}

function initialFor(name: string | undefined, email: string | undefined): string {
  const source = (name ?? email ?? 'T').trim();
  return (source[0] ?? 'T').toUpperCase();
}

/** Who is signed in, what they can use, and the way out. */
export function Account(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [state, setState] = useState<AccountState | null>(null);
  const [rd, setRd] = useState<RdStatus>(EMPTY_RD);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchAccount().then((next) => { if (!cancelled) setState(next); });
    void fetchRdStatus().then((status) => { if (!cancelled && status !== null) setRd(status); });
    return () => { cancelled = true; };
  }, []);

  const account = state?.account ?? null;
  const dev = account?.role === 'dev';
  const liveTvOn = dev || (account?.activated === true && account.tier === 'stream-live');
  const statusText = state === null ? 'Loading…' : dev ? 'Active' : accountStatusLabel(state);

  const leave = async (): Promise<void> => {
    if (leaving) return;
    setLeaving(true);
    try {
      await signOut();
    } finally {
      // The app shell asks again and puts the sign-in screen back.
      announceAccountChange();
    }
  };

  return (
    <main className="page page--settings page--docked page--account">
      <PageScene />
      <Ribbon active="profile" />
      <header className="page__toolbar">
        <div className="page__toolbar-lead">
          <BackButton id="account-back" />
          <div>
            <h1 className="page__heading">Account</h1>
          </div>
        </div>
      </header>

      <div className="account-shell">
        <section className="glass glass--sheet account-card" aria-label="Account overview">
          <div className="account-header">
            <div className="account-avatar" aria-hidden="true">
              {initialFor(account?.displayName, account?.email)}
            </div>
            <div className="account-identity">
              <h2 className="account-identity__name">{account?.displayName ?? 'Account'}</h2>
              <p className="account-identity__email">
                {dev
                  ? 'Developer mode is active for this session.'
                  : account !== null
                    ? account.email
                    : 'Loading your account…'}
              </p>
            </div>
          </div>

          <div className="settings-list account-rows" data-wrap="y">
            <FocusButton
              id="account-plan"
              className="settings-row account-row"
              detail={dev ? 'All features · Change' : `${friendlyPlanName(account?.tier)} · Change`}
              onSelect={() => navigate.push('plans')}
            >
              Plan
            </FocusButton>
            <FocusButton
              id="realdebrid"
              className="settings-row account-row"
              detail={rdDetail(rd)}
              onSelect={() => navigate.push('realdebrid')}
            >
              Real-Debrid
            </FocusButton>
            <FocusButton
              id="account-livetv"
              className="settings-row account-row"
              detail={liveTvOn ? 'On' : 'Off'}
              onSelect={() => navigate.push(liveTvOn ? 'live' : 'plans')}
            >
              Live TV
            </FocusButton>
            <div className="account-info-row">
              <span className="account-info-row__label">Status</span>
              <span className="account-info-row__value">{statusText}</span>
            </div>
            {!dev && account !== null && (
              <div className="account-info-row">
                <span className="account-info-row__label">Member since</span>
                <span className="account-info-row__value">{shortDate(account.createdAt)}</span>
              </div>
            )}
            <FocusButton
              id="profiles"
              className="settings-row account-row"
              detail="Manage"
              onSelect={() => navigate.push('profiles')}
            >
              Stream profiles
            </FocusButton>
            {dev && (
              <>
                <FocusButton
                  id="account-accounts"
                  className="settings-row account-row"
                  detail="Switch people on, Live TV, keys"
                  onSelect={() => navigate.push('accounts')}
                >
                  Accounts
                </FocusButton>
                <FocusButton
                  id="account-mail"
                  className="settings-row account-row"
                  detail="Sends the sign-up codes"
                  onSelect={() => navigate.push('mail-settings')}
                >
                  Email
                </FocusButton>
                <FocusButton
                  id="account-developer"
                  className="settings-row account-row"
                  detail="Open"
                  onSelect={() => navigate.push('developer')}
                >
                  Developer
                </FocusButton>
              </>
            )}
          </div>

          <footer className="account-footer">
            <FocusButton
              id="account-signout"
              className="tvm-button--glass account-signout"
              disabled={leaving || account === null}
              onSelect={() => void leave()}
            >
              {leaving ? 'Signing out…' : 'Sign out'}
            </FocusButton>
            <FocusButton
              id="account-privacy"
              variant="quiet"
              className="account-footer__link"
              onSelect={() => navigate.push('legal')}
            >
              Privacy &amp; terms
            </FocusButton>
          </footer>
        </section>
      </div>
    </main>
  );
}
