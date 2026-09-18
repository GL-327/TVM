import { useEffect, useState } from 'react';
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

const EMPTY_RD: RdStatus = { configured: false, username: null, premium: false, error: null };

function accessLabel(state: AccountState): string {
  if (state.account?.tier === 'stream-live') return 'Movies, TV shows and Live TV';
  if (state.account?.tier === 'stream') return 'Movies and TV shows';
  return 'Not switched on';
}

function rdLabel(rd: RdStatus): string {
  if (!rd.configured) return 'Not connected';
  if (rd.error === 'needs-auth') return 'Key rejected';
  const who = rd.username ?? 'Connected';
  if (rd.source === 'account') return `${who} · your key`;
  if (rd.source === 'device') return `${who} · this machine's key`;
  return who;
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
        <div>
          <p className="stage__kicker">{dev ? 'Dev account' : 'Your account'}</p>
          <h1 className="page__heading">{account?.displayName ?? 'Account'}</h1>
        </div>
      </header>
      <p className="page__lede">
        {dev
          ? 'Dev mode is on for as long as you are signed in here. Signing out turns it off.'
          : account !== null
            ? `Signed in as ${account.email}.`
            : 'Loading your account…'}
      </p>

      {state !== null && account !== null && (
        <dl className="panel__rows settings-summary">
          {!dev && (
            <div className="panel__row">
              <dt>Email</dt>
              <dd>{account.emailVerified ? 'Verified' : 'Not verified'}</dd>
            </div>
          )}
          <div className="panel__row">
            <dt>Access</dt>
            <dd>{dev ? 'Everything, with dev mode on' : accessLabel(state)}</dd>
          </div>
          {!dev && (
            <div className="panel__row">
              <dt>Member since</dt>
              <dd>{shortDate(account.createdAt)}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="settings-list" data-wrap="y">
        <FocusButton
          id="realdebrid"
          className="settings-row"
          detail={rdLabel(rd)}
          onSelect={() => navigate.push('realdebrid')}
        >
          Real-Debrid
        </FocusButton>
        <FocusButton
          id="profiles"
          className="settings-row"
          detail="TVM Stream only"
          onSelect={() => navigate.push('profiles')}
        >
          Stream profiles
        </FocusButton>
        {dev && (
          <>
            <FocusButton
              id="account-accounts"
              className="settings-row"
              detail="Switch people on, Live TV, keys"
              onSelect={() => navigate.push('accounts')}
            >
              Accounts
            </FocusButton>
            <FocusButton
              id="account-mail"
              className="settings-row"
              detail="Sends the sign-up codes"
              onSelect={() => navigate.push('mail-settings')}
            >
              Email
            </FocusButton>
            <FocusButton
              id="account-developer"
              className="settings-row"
              detail="Open"
              onSelect={() => navigate.push('developer')}
            >
              Developer
            </FocusButton>
          </>
        )}
        <FocusButton
          id="account-signout"
          className="settings-row"
          detail={dev ? 'Turns dev mode off' : undefined}
          disabled={leaving || account === null}
          onSelect={() => void leave()}
        >
          {leaving ? 'Signing out…' : 'Sign out'}
        </FocusButton>
      </div>
    </main>
  );
}
