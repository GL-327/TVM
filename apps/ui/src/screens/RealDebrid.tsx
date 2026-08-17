import { useCallback, useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { clearRdToken, fetchRdStatus, saveRdToken, type RdStatus } from '../data/media';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const EMPTY: RdStatus = { configured: false, username: null, premium: false, error: null };

export function RealDebrid(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<RdStatus>(EMPTY);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const next = await fetchRdStatus();
    if (next !== null) setStatus(next);
  }, []);

  useEffect(() => {
    void refresh().catch(() => setMessage('Core did not answer.'));
  }, [refresh]);

  const save = async (raw?: string): Promise<void> => {
    const next = (raw ?? token).trim();
    setBusy(true);
    setMessage(null);
    try {
      const body = await saveRdToken(next);
      setStatus(body);
      setToken('');
      if (body.error === 'needs-auth') setMessage('Real-Debrid rejected that token.');
      else if (body.username !== null) setMessage(`Signed in as ${body.username}.`);
      else setMessage('Token stored on this machine.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The token was not stored.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page--settings">
      <TopBar title="Real-Debrid" />
      <p className="stage__kicker">Account and cloud</p>
      <h1 className="page__heading">Real-Debrid</h1>
      <p className="page__lede">
        Paste an API token from real-debrid.com/apitoken. TVM stores it on this machine until you replace it here
        or fully reset the app.
      </p>
      <dl className="panel__rows settings-summary">
        <div className="panel__row">
          <dt>Account</dt>
          <dd>{status.configured ? (status.username ?? 'Configured') : 'Not configured'}</dd>
        </div>
        <div className="panel__row">
          <dt>Premium</dt>
          <dd>{status.premium ? 'Yes' : 'No'}</dd>
        </div>
        <div className="panel__row">
          <dt>Status</dt>
          <dd>{status.error === null ? 'Ready' : status.error === 'needs-auth' ? 'Token rejected' : 'Unavailable'}</dd>
        </div>
      </dl>
      {message !== null && <p className="page__message">{message}</p>}
      <label className="token-field">
        <span>API token from real-debrid.com/apitoken</span>
        <FocusField
          id="token"
          type="password"
          value={token}
          onChange={setToken}
          onConfirm={(value) => void save(value)}
          afterPasteFocusId="save"
          placeholder="Paste token, then press OK"
        />
      </label>
      <div className="hero__actions">
        <FocusButton id="save" variant="primary" disabled={busy} onSelect={() => void save(fieldValue('token'))}>
          {busy ? 'Saving…' : 'Save token'}
        </FocusButton>
        {status.configured && (
          <FocusButton
            id="disconnect"
            className="tvm-button--glass"
            disabled={busy}
            onSelect={() => {
              setBusy(true);
              void clearRdToken()
                .then((body) => {
                  setStatus(body);
                  setMessage('Token cleared. TVM Stream will ask for it again.');
                })
                .catch((error: unknown) => {
                  setMessage(error instanceof Error ? error.message : 'The token was not cleared.');
                })
                .finally(() => setBusy(false));
            }}
          >
            Disconnect
          </FocusButton>
        )}
        <FocusButton id="back" onSelect={() => navigate.pop()}>
          Back
        </FocusButton>
      </div>
    </main>
  );
}
