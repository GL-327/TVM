import { useCallback, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { saveRdToken } from '../data/media';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function Setup(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = useCallback(
    async (raw?: string): Promise<void> => {
      const trimmed = (raw ?? token).trim();
      if (trimmed === '') {
        setMessage('Paste a token, then press OK.');
        return;
      }
      setBusy(true);
      setMessage(null);
      try {
        const status = await saveRdToken(trimmed);
        if (status.error === 'needs-auth') {
          setMessage('Real-Debrid rejected that token.');
          return;
        }
        if (!status.configured) {
          setMessage('The token was not stored.');
          return;
        }
        navigate.reset('library');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'The token was not stored.');
      } finally {
        setBusy(false);
      }
    },
    [navigate, token],
  );

  return (
    <main className="page page--setup">
      <div className="setup-scrim" aria-hidden="true" />
      <section className="setup-card" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <p className="stage__kicker">TVM</p>
        <h1 id="setup-title" className="page__heading">
          Enter your Real-Debrid token
        </h1>
        <p className="page__lede">
          Paste the API token from real-debrid.com/apitoken, then press OK. This unlocks TVM Stream only. Home and the
          other apps stay available. It stays on this machine only.
        </p>
        {message !== null && <p className="page__message">{message}</p>}
        <label className="token-field">
          <span>Real-Debrid API token</span>
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
            {busy ? 'Connecting…' : 'Continue'}
          </FocusButton>
        </div>
      </section>
    </main>
  );
}
