import { useCallback, useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { LoadingScreen } from '../components/LoadingScreen';
import { TopBar } from '../components/TopBar';
import { clearXtream, fetchLive, saveXtream, type LiveStatus } from '../data/media';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const EMPTY: LiveStatus = {
  url: null,
  host: null,
  username: null,
  configured: false,
  channels: [],
  error: null,
};

export function LiveXtream(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<LiveStatus>(EMPTY);
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const next = await fetchLive();
    if (next === null) {
      setLoading(false);
      return;
    }
    setStatus(next);
    if (typeof next.host === 'string' && next.host !== '') setHost(next.host);
    if (typeof next.username === 'string' && next.username !== '') setUsername(next.username);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh().catch(() => {
      setMessage('Core did not answer.');
      setLoading(false);
    });
  }, [refresh]);

  const save = async (): Promise<void> => {
    const nextHost = (fieldValue('host') || host).trim();
    const nextUser = (fieldValue('username') || username).trim();
    const nextPass = fieldValue('password') || password;
    if (nextHost === '' || nextUser === '' || nextPass.trim() === '') {
      setMessage('Enter the server, username and password, then press OK.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const body = await saveXtream({ host: nextHost, username: nextUser, password: nextPass });
      setStatus(body);
      setPassword('');
      if (body.host !== null && body.host !== undefined) setHost(body.host);
      if (body.username !== null && body.username !== undefined) setUsername(body.username);
      if (body.error === 'needs-auth') setMessage('That login was rejected. Check the server, username and password.');
      else if (body.error === 'unreachable') setMessage('TVM could not reach that server. Check the address and the network.');
      else if (body.error === 'invalid') setMessage('Enter a server URL, username and password.');
      else if (body.configured === true) {
        const count = body.total ?? body.channels.length;
        setMessage(count > 0 ? `${count} channels ready.` : 'Signed in. Channels will appear on Live TV.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The login was not stored.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page--settings">
      <TopBar title="Live TV login" />
      <p className="stage__kicker">Your source</p>
      <h1 className="page__heading">Live TV login</h1>
      <p className="page__lede">
        Enter the server, username and password for a live TV panel you are allowed to use. TVM stores them on this
        machine only. The interface never keeps the password.
      </p>
      {loading || busy ? (
        <LoadingScreen
          eyebrow="Live TV"
          title={busy ? 'Saving login…' : 'Loading login…'}
          body={
            busy
              ? 'Checking the panel and storing the login on this machine.'
              : 'Reading whether a Live TV login is already saved.'
          }
        />
      ) : (
        <>
      <dl className="panel__rows settings-summary">
        <div className="panel__row">
          <dt>Server</dt>
          <dd>{status.host ?? 'Not added'}</dd>
        </div>
        <div className="panel__row">
          <dt>Account</dt>
          <dd>{status.configured === true ? (status.username ?? 'Configured') : 'Not configured'}</dd>
        </div>
        <div className="panel__row">
          <dt>Channels</dt>
          <dd>{status.total ?? status.channels.length}</dd>
        </div>
      </dl>
      {message !== null && <p className="page__message">{message}</p>}
      <label className="token-field">
        <span>Server URL</span>
        <FocusField
          id="host"
          type="url"
          value={host}
          onChange={setHost}
          onConfirm={() => void save()}
          afterPasteFocusId="username"
          placeholder="http://host:port"
        />
      </label>
      <label className="token-field">
        <span>Username</span>
        <FocusField
          id="username"
          value={username}
          onChange={setUsername}
          onConfirm={() => void save()}
          afterPasteFocusId="password"
          placeholder="Username"
        />
      </label>
      <label className="token-field">
        <span>Password</span>
        <FocusField
          id="password"
          type="password"
          value={password}
          onChange={setPassword}
          onConfirm={() => void save()}
          afterPasteFocusId="save"
          placeholder="Password"
        />
      </label>
      <div className="hero__actions">
        <FocusButton id="save" variant="primary" disabled={busy} onSelect={() => void save()}>
          {busy ? 'Saving…' : 'Save login'}
        </FocusButton>
        {status.configured === true && status.host !== null && status.host !== undefined && (
          <FocusButton
            id="disconnect"
            className="tvm-button--glass"
            disabled={busy}
            onSelect={() => {
              setBusy(true);
              void clearXtream()
                .then((body) => {
                  setStatus(body);
                  setPassword('');
                  setMessage('Login cleared. Live TV will ask for it again.');
                })
                .catch((error: unknown) => {
                  setMessage(error instanceof Error ? error.message : 'The login was not cleared.');
                })
                .finally(() => setBusy(false));
            }}
          >
            Disconnect
          </FocusButton>
        )}
        <FocusButton id="playlist" onSelect={() => navigate.push('live-playlist')}>
          Playlist
        </FocusButton>
        <FocusButton id="back" onSelect={() => navigate.pop()}>
          Back
        </FocusButton>
      </div>
        </>
      )}
    </main>
  );
}
