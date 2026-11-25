import { useCallback, useEffect, useRef, useState } from 'react';
import { BackButton } from '../components/BackButton';
import { EmptyState } from '../components/EmptyState';
import { FocusButton } from '../components/FocusButton';
import { FocusField } from '../components/FocusField';
import { GlassSegmented } from '../components/GlassSegmented';
import { PageScene } from '../components/PageScene';
import { Ribbon } from '../components/Ribbon';
import {
  activateAccount,
  eraseAccount,
  fetchAdminAccounts,
  setAccountLiveTv,
  setAccountNote,
  setAccountRdKey,
  setAccountVerified,
  shortDate,
  suspendAccount,
  type AccountTier,
  type AdminAccountsResponse,
  type AdminAccountView,
} from '../data/account';
import { bindKeyboardFields } from '../nav/pointerInput';
import { friendlyAccountError } from './accountCopy';
import './billing.css';
import './accounts.css';

/**
 * Everyone who has signed up, and what they get. Dev mode only; Core checks
 * that on every call. Passwords are salted digests, so there is nothing here
 * that could show one.
 */

const STATES = [
  { id: 'all', label: 'Everyone' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'active', label: 'Active' },
  { id: 'suspended', label: 'Paused' },
] as const;

function TierBadge({ account }: { account: AdminAccountView }): React.JSX.Element {
  if (account.suspended) return <span className="acct-badge acct-badge--off">Paused by the owner</span>;
  if (!account.activated) return <span className="acct-badge acct-badge--wait">Waiting for approval</span>;
  return (
    <span className="acct-badge acct-badge--on">
      {account.tier === 'stream-live' ? 'Stream + Live' : 'Stream'}
    </span>
  );
}

export function Accounts(): React.JSX.Element {
  const [data, setData] = useState<AdminAccountsResponse | null>(null);
  const [search, setSearch] = useState('');
  const [state, setState] = useState<(typeof STATES)[number]['id']>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [rdKey, setRdKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmErase, setConfirmErase] = useState<string | null>(null);
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => bindKeyboardFields(pageRef.current), [openId]);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setData(await fetchAdminAccounts({ search, state }));
    } catch (caught) {
      setError(friendlyAccountError(caught, 'admin'));
    }
  }, [search, state]);

  useEffect(() => { void load(); }, [load]);

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await run();
      await load();
    } catch (caught) {
      setError(friendlyAccountError(caught, 'admin'));
    } finally {
      setBusy(false);
    }
  };

  const open = data?.accounts.find((account) => account.id === openId) ?? null;

  return (
    <main ref={pageRef} className="page page--settings accounts-page" data-keyboard-fields="">
      <PageScene />
      <Ribbon active="settings" />

      <header className="page__toolbar">
        <div className="page__toolbar-lead">
          <BackButton id="accounts-back" />
          <div>
            <p className="stage__kicker">Developer</p>
            <h1 className="page__heading">Accounts</h1>
          </div>
        </div>
        <div className="hero__actions">
          <FocusButton id="accounts-refresh" className="tvm-button--glass acct-btn" disabled={busy} onSelect={() => void load()}>
            Refresh
          </FocusButton>
        </div>
      </header>

      {data !== null && (
        <dl className="acct-summary">
          <div><dt>Everyone</dt><dd>{data.summary.total}</dd></div>
          <div><dt>Waiting</dt><dd>{data.summary.waiting}</dd></div>
          <div><dt>Active</dt><dd>{data.summary.active}</dd></div>
          <div><dt>Paused</dt><dd>{data.summary.suspended}</dd></div>
        </dl>
      )}

      <section className="acct-controls">
        <label className="acct-search">
          <span>Search</span>
          <FocusField id="accounts-search" value={search} onChange={setSearch} onConfirm={setSearch} placeholder="Email or name" />
        </label>
        <div className="acct-filters">
          <GlassSegmented
            idPrefix="accounts-state"
            ariaLabel="Filter accounts"
            options={STATES}
            value={state}
            onChange={setState}
          />
        </div>
      </section>

      {error !== null && <p className="billing-message billing-message--error" role="alert">{error}</p>}

      {data === null ? (
        <p role="status">Loading accounts…</p>
      ) : data.accounts.length === 0 ? (
        <EmptyState title="No accounts here" body="Nobody matches that filter yet." />
      ) : (
        <ul className="acct-list">
          {data.accounts.map((account) => (
            <li key={account.id} className={`glass glass--card acct-row${openId === account.id ? ' acct-row--open' : ''}`}>
              <button
                type="button"
                className="acct-row__head"
                data-focus-id={`account-${account.id}`}
                onClick={() => { setOpenId(openId === account.id ? null : account.id); setNote(account.note ?? ''); setRdKey(''); setConfirmErase(null); }}
              >
                <span className="acct-row__who">
                  <span className="acct-row__name">{account.displayName}</span>
                  <span className="acct-row__email">{account.email}</span>
                </span>
                <TierBadge account={account} />
              </button>

              {openId === account.id && (
                <div className="acct-detail">
                  <dl className="acct-facts">
                    <div><dt>Signed up</dt><dd>{shortDate(account.createdAt)}</dd></div>
                    <div><dt>Activated</dt><dd>{shortDate(account.activatedAt)}</dd></div>
                    <div><dt>Last seen</dt><dd>{shortDate(account.lastSeenAt)}</dd></div>
                    <div><dt>Sign-ins</dt><dd>{account.signIns}</dd></div>
                    <div><dt>Open sessions</dt><dd>{account.activeSessions}</dd></div>
                    <div><dt>Terms</dt><dd>{account.termsAcceptedAt === null ? 'Not agreed' : `v${account.termsVersion ?? '?'}`}</dd></div>
                    <div><dt>Email</dt><dd>{account.emailVerified ? `Verified ${shortDate(account.emailVerifiedAt)}` : account.emailCodeSent ? 'Code sent' : 'Not verified'}</dd></div>
                    <div><dt>Real-Debrid</dt><dd>{account.rdKeyHint ?? "This machine's key"}</dd></div>
                    <div className="acct-facts__wide"><dt>Last device</dt><dd>{account.lastClient ?? '—'}</dd></div>
                  </dl>

                  <label className="acct-note">
                    <span>Your note (private)</span>
                    <FocusField
                      id={`note-${account.id}`}
                      value={note}
                      onChange={setNote}
                      onConfirm={(value) => void act(() => setAccountNote(account.id, value === '' ? null : value))}
                      placeholder="How you know them, what they paid"
                    />
                  </label>

                  <div className="acct-actions">
                    {account.activated ? (
                      <FocusButton
                        id={`live-tv-${account.id}`}
                        className="tvm-button--glass acct-btn"
                        disabled={busy}
                        onSelect={() => void act(() => setAccountLiveTv(account.id, account.tier !== 'stream-live'))}
                      >
                        {account.tier === 'stream-live' ? 'Live TV: on' : 'Live TV: off'}
                      </FocusButton>
                    ) : (
                      <>
                        <FocusButton
                          id={`grant-stream-${account.id}`}
                          variant="primary"
                          className="acct-btn"
                          disabled={busy}
                          onSelect={() => void act(() => activateAccount({ id: account.id, tier: 'stream' as AccountTier, note: note || undefined }))}
                        >
                          Switch on · Stream
                        </FocusButton>
                        <FocusButton
                          id={`grant-live-${account.id}`}
                          className="tvm-button--glass acct-btn"
                          disabled={busy}
                          onSelect={() => void act(() => activateAccount({ id: account.id, tier: 'stream-live' as AccountTier, note: note || undefined }))}
                        >
                          Switch on · Stream + Live
                        </FocusButton>
                      </>
                    )}
                    <FocusButton
                      id={`verify-${account.id}`}
                      className="tvm-button--glass acct-btn"
                      disabled={busy}
                      onSelect={() => void act(() => setAccountVerified(account.id, !account.emailVerified))}
                    >
                      {account.emailVerified ? 'Mark email unverified' : 'Mark email verified'}
                    </FocusButton>
                    <FocusButton
                      id={`suspend-${account.id}`}
                      className="tvm-button--glass acct-btn"
                      disabled={busy}
                      onSelect={() => void act(() => suspendAccount(account.id, !account.suspended))}
                    >
                      {account.suspended ? 'Restore' : 'Pause'}
                    </FocusButton>
                  </div>

                  <label className="acct-note">
                    <span>Real-Debrid key for this account</span>
                    <FocusField
                      id={`rd-${account.id}`}
                      type="password"
                      value={rdKey}
                      onChange={setRdKey}
                      onConfirm={(value) => void act(async () => { await setAccountRdKey(account.id, value); setRdKey(''); })}
                      afterPasteFocusId={`rd-save-${account.id}`}
                      placeholder={account.rdKey ? 'Paste a new key to replace it' : "Empty uses this machine's key"}
                    />
                  </label>
                  <div className="acct-actions">
                    <FocusButton
                      id={`rd-save-${account.id}`}
                      className="tvm-button--glass acct-btn"
                      disabled={busy || rdKey.trim() === ''}
                      onSelect={() => void act(async () => { await setAccountRdKey(account.id, rdKey); setRdKey(''); })}
                    >
                      Save key
                    </FocusButton>
                    {account.rdKey && (
                      <FocusButton
                        id={`rd-remove-${account.id}`}
                        className="tvm-button--glass acct-btn"
                        disabled={busy}
                        onSelect={() => void act(() => setAccountRdKey(account.id, ''))}
                      >
                        Remove key
                      </FocusButton>
                    )}
                  </div>

                  {/* Erasure is irreversible, so it asks once rather than
                      sitting one stray click away from a real person's data. */}
                  <div className="acct-actions acct-actions--danger">
                    {confirmErase === account.id ? (
                      <>
                        <span className="acct-danger__ask">Erase {account.email} and everything held about them?</span>
                        <FocusButton
                          id={`erase-yes-${account.id}`}
                          className="tvm-button--glass acct-btn acct-btn--danger"
                          disabled={busy}
                          onSelect={() => void act(async () => { await eraseAccount(account.id); setOpenId(null); setConfirmErase(null); })}
                        >
                          Yes, erase permanently
                        </FocusButton>
                        <FocusButton
                          id={`erase-no-${account.id}`}
                          className="tvm-button--glass acct-btn"
                          disabled={busy}
                          onSelect={() => setConfirmErase(null)}
                        >
                          Keep
                        </FocusButton>
                      </>
                    ) : (
                      <FocusButton
                        id={`erase-${account.id}`}
                        className="tvm-button--glass acct-btn acct-btn--danger"
                        disabled={busy}
                        onSelect={() => setConfirmErase(account.id)}
                      >
                        Erase account (GDPR)
                      </FocusButton>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {open === null && data !== null && data.accounts.length > 0 && (
        <p className="acct-hint">Select someone to see their details and switch them on.</p>
      )}
    </main>
  );
}
