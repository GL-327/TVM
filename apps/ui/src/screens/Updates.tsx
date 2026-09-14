import { useCallback, useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

interface UpdateStatus {
  current: string;
  channel: string;
  lastCheck: string | null;
  available: { version: string; notes: string } | null;
  configured: boolean;
  applyAllowed: boolean;
  applyReason: string | null;
  kind?: 'idle' | 'no_release' | 'up_to_date' | 'available' | 'auth_required' | 'rate_limited';
  notice?: string | null;
}

const EMPTY: UpdateStatus = {
  current: __TVM_UI_VERSION__,
  channel: 'github:GL-327/TVM',
  lastCheck: null,
  available: null,
  configured: false,
  applyAllowed: false,
  applyReason: null,
  kind: 'idle',
  notice: null,
};

export function Updates(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<UpdateStatus>(EMPTY);
  const [busy, setBusy] = useState<'check' | 'apply' | 'token' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState('');

  const refresh = useCallback(async (): Promise<UpdateStatus> => {
    const response = await fetch('/api/update/status');
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = (await response.json()) as UpdateStatus;
    setStatus(body);
    return body;
  }, []);

  useEffect(() => {
    void refresh().catch(() => setMessage('Core did not answer. Updates need the local service.'));
  }, [refresh]);

  const check = async (): Promise<void> => {
    setBusy('check');
    setMessage(null);
    try {
      const response = await fetch('/api/update/check', { method: 'POST' });
      const body = (await response.json()) as UpdateStatus & { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? 'Check failed');
        return;
      }
      setStatus(body);
      setMessage(
        body.notice ??
          (body.available === null ? 'You are on the latest published app build.' : `Version ${body.available.version} is available.`),
      );
    } catch {
      setMessage('Check failed. Confirm this PC can reach GitHub.');
    } finally {
      setBusy(null);
    }
  };

  const apply = async (): Promise<void> => {
    setBusy('apply');
    setMessage(null);
    try {
      const response = await fetch('/api/update/apply', { method: 'POST' });
      const body = (await response.json()) as { error?: string; reason?: string };
      if (!response.ok) {
        setMessage(body.reason ?? body.error ?? 'Apply was refused');
        return;
      }
      setMessage('Applied. The service will restart.');
    } catch {
      setMessage('Apply failed.');
    } finally {
      setBusy(null);
    }
  };

  const saveToken = async (raw?: string): Promise<void> => {
    const next = (raw ?? token).trim();
    setBusy('token');
    setMessage(null);
    try {
      const response = await fetch('/api/update/token', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: next }),
      });
      if (!response.ok) {
        setMessage('The token was not stored.');
        return;
      }
      setToken('');
      await refresh();
      setMessage('Token stored by core. It never enters the interface bundle.');
    } catch {
      setMessage('The token was not stored.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="page page--settings">
      <TopBar title="Updates" />
      <p className="stage__kicker">GLogic Studios</p>
      <h1 className="page__heading">Updates</h1>
      <p className="page__lede">
        App builds come from the public GitHub Releases feed ({status.channel}). This device does not need a GitHub
        login. Check works here; Apply is for a production appliance, not this development checkout. A token is only
        for a private fork. The operating system image is a separate update.
      </p>

      <dl className="panel__rows settings-summary">
        <div className="panel__row">
          <dt>This box</dt>
          <dd>v{status.current}</dd>
        </div>
        <div className="panel__row">
          <dt>Last check</dt>
          <dd>{status.lastCheck === null ? 'Never' : new Date(status.lastCheck).toLocaleString()}</dd>
        </div>
        <div className="panel__row">
          <dt>Available</dt>
          <dd>{status.available === null ? 'None' : `v${status.available.version}`}</dd>
        </div>
        <div className="panel__row">
          <dt>GitHub login</dt>
          <dd>{status.configured ? 'Private-fork token stored' : 'Not required'}</dd>
        </div>
      </dl>

      {message !== null && <p className="page__message">{message}</p>}
      {status.available?.notes !== undefined && status.available.notes !== '' && (
        <p className="page__lede">{status.available.notes}</p>
      )}

      <div className="hero__actions">
        <FocusButton id="check" variant="primary" disabled={busy !== null} onSelect={() => void check()}>
          {busy === 'check' ? 'Checking…' : 'Check now'}
        </FocusButton>
        <FocusButton
          id="apply"
          disabled={busy !== null || status.available === null || !status.applyAllowed}
          onSelect={() => void apply()}
        >
          {status.applyAllowed ? 'Apply' : 'Apply (disabled here)'}
        </FocusButton>
        <FocusButton id="back" onSelect={() => navigate.pop()}>
          Back
        </FocusButton>
      </div>

      {!status.applyAllowed && status.applyReason !== null && <p className="page__lede">{status.applyReason}</p>}

      <label className="token-field">
        <span>Private-fork token (optional)</span>
        <FocusField
          id="token"
          type="password"
          value={token}
          onChange={setToken}
          onConfirm={(value) => void saveToken(value)}
          afterPasteFocusId="save-token"
          placeholder="Paste token, then press OK"
        />
      </label>
      <FocusButton id="save-token" disabled={busy !== null} onSelect={() => void saveToken(fieldValue('token'))}>
        Save token
      </FocusButton>
    </main>
  );
}
