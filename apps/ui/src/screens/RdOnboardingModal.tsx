import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountState } from '../data/account';
import { fetchRdStatus, saveRdToken, type RdStatus } from '../data/media';

export const RD_PROMPT_SKIPPED_KEY = 'tvm.rd.prompt.skipped';

export function shouldShowRdOnboarding(input: {
  account: AccountState | undefined;
  rdStatus: RdStatus | null;
  skipped: boolean;
}): boolean {
  const { account, rdStatus, skipped } = input;
  if (account === undefined || !account.usable.ok) return false;
  if (account.account?.rdKey === true) return false;
  if (skipped) return false;
  if (rdStatus === null || rdStatus.configured === true) return false;
  return true;
}

function readSkipped(): boolean {
  try {
    return sessionStorage.getItem(RD_PROMPT_SKIPPED_KEY) === '1';
  } catch {
    return false;
  }
}

function markSkipped(): void {
  try {
    sessionStorage.setItem(RD_PROMPT_SKIPPED_KEY, '1');
  } catch {
    // Private browsing or blocked storage: close for this mount anyway.
  }
}

export function RdOnboardingModal({ account }: { account: AccountState }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedUser, setConfirmedUser] = useState<string | null | undefined>(undefined);
  const closeTimerRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  useEffect(() => {
    if (!account.usable.ok || account.account?.rdKey === true || readSkipped()) {
      setOpen(false);
      return undefined;
    }
    let cancelled = false;
    void fetchRdStatus().then((status) => {
      if (cancelled) return;
      if (shouldShowRdOnboarding({ account, rdStatus: status, skipped: readSkipped() })) {
        setOpen(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [account]);

  const skip = useCallback((): void => {
    window.clearTimeout(closeTimerRef.current);
    markSkipped();
    setOpen(false);
  }, []);

  const connect = useCallback(async (): Promise<void> => {
    const trimmed = token.trim();
    if (trimmed === '') {
      setError('Paste your Real-Debrid API token to continue.');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await saveRdToken(trimmed);
      if (status.error === 'needs-auth') {
        setError('Real-Debrid rejected that token. Check it and try again.');
        return;
      }
      if (!status.configured) {
        setError('Could not verify your Real-Debrid key. Please try again.');
        return;
      }
      setConfirmedUser(status.username ?? null);
      closeTimerRef.current = window.setTimeout(() => {
        setOpen(false);
      }, 950);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that token.');
    } finally {
      setBusy(false);
    }
  }, [busy, token]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        skip();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, skip]);

  if (!open) return null;

  const connected = confirmedUser !== undefined;

  return (
    <div
      className="panel-scrim rd-onboarding"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rd-onboarding-title"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <section className="panel rd-onboarding__panel">
        <p className="stage__kicker rd-onboarding__kicker">First-time setup</p>
        <h2 id="rd-onboarding-title" className="panel__title rd-onboarding__title">
          Connect Real-Debrid
        </h2>

        {connected ? (
          <div className="rd-onboarding__success" role="status">
            <span className="rd-onboarding__check" aria-hidden="true">✓</span>
            <div>
              <strong>Real-Debrid connected</strong>
              <p>
                {confirmedUser !== null
                  ? `Signed in as ${confirmedUser}. Your key is saved securely.`
                  : 'Your API key is saved securely on this device.'}
              </p>
            </div>
            <div className="rd-onboarding__actions">
              <button
                type="button"
                className="tvm-button tvm-button--primary"
                onClick={() => {
                  window.clearTimeout(closeTimerRef.current);
                  setOpen(false);
                }}
              >
                Start watching
              </button>
            </div>
          </div>
        ) : (
          <form
            className="rd-onboarding__form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
          >
            <p className="rd-onboarding__lede">
              Paste your API token from <strong>real-debrid.com/apitoken</strong> to unlock instant streaming. Your
              key is encrypted in your device vault.
            </p>
            {error !== null && (
              <p className="gate__error rd-onboarding__error" role="alert">
                {error}
              </p>
            )}
            <label className="token-field rd-onboarding__field">
              <span>Real-Debrid API token</span>
              <input
                ref={inputRef}
                id="rd-onboarding-token"
                type="password"
                className="token-field__input"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
                placeholder="Paste your API token"
              />
            </label>
            <div className="rd-onboarding__actions">
              <button type="submit" className="tvm-button tvm-button--primary" disabled={busy}>
                {busy ? 'Connecting…' : 'Connect'}
              </button>
              <button type="button" className="tvm-button tvm-button--glass" disabled={busy} onClick={skip}>
                Skip for now
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
