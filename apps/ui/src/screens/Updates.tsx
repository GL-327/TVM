import { useCallback, useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import { formatAppDate } from '../i18n/locale';
import { readAutoUpdate, savePrefs } from '../data/prefs';
import { rememberPendingChangelog, type ChangelogEntry, type ChangelogRecord, parseChangelogRecord } from '../data/changelog';

interface UpdateStatus {
  current: string;
  channel: string;
  lastCheck: string | null;
  available: { version: string; notes: string; changelog?: ChangelogEntry[] } | null;
  configured: boolean;
  applyAllowed: boolean;
  applyReason: string | null;
  kind?: 'idle' | 'no_release' | 'up_to_date' | 'available' | 'auth_required' | 'rate_limited';
  notice?: string | null;
  autoUpdate?: boolean;
  changelog?: ChangelogRecord | null;
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
  changelog: null,
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
      rememberPendingChangelog({
        version: status.available?.version ?? 'github',
        entries: status.available?.changelog,
        notes: status.available?.notes,
      });
      setMessage('Applied. Reloading…');
      window.setTimeout(() => window.location.reload(), 400);
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
        Builds come from GitHub ({status.channel}). When automatic updates are on, this app checks as
        soon as it opens and applies the latest interface. Turn that off in Settings to stay on this
        copy until you tap Apply.
      </p>

      <dl className="panel__rows settings-summary">
        <div className="panel__row">
          <dt>This box</dt>
          <dd>v{status.current}</dd>
        </div>
        <div className="panel__row">
          <dt>Last check</dt>
          <dd>{status.lastCheck === null ? 'Never' : formatAppDate(status.lastCheck)}</dd>
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
      <ChangelogList
        heading={status.available !== null ? "What's coming" : "What's new"}
        entries={
          status.available?.changelog ??
          parseChangelogRecord(status.changelog)?.entries ??
          []
        }
        fallback={status.available?.notes}
      />

      <div className="hero__actions">
        <FocusButton id="check" variant="primary" disabled={busy !== null} onSelect={() => void check()}>
          {busy === 'check' ? 'Checking…' : 'Check now'}
        </FocusButton>
        <FocusButton
          id="apply"
          disabled={busy !== null || status.available === null || !status.applyAllowed}
          onSelect={() => void apply()}
        >
          {status.applyAllowed ? 'Apply now' : 'Apply (disabled here)'}
        </FocusButton>
        <FocusButton
          id="auto-update"
          disabled={busy !== null}
          onSelect={() => {
            const next = !readAutoUpdate();
            void savePrefs({ autoUpdate: next }).then(() => {
              setMessage(next ? 'Automatic updates on. The next open will apply GitHub.' : 'Automatic updates off.');
            });
          }}
        >
          {readAutoUpdate() ? 'Automatic updates on' : 'Automatic updates off'}
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

function ChangelogList({
  heading,
  entries,
  fallback,
}: {
  heading: string;
  entries: ChangelogEntry[];
  fallback?: string;
}): React.JSX.Element | null {
  if (entries.length > 0) {
    return (
      <section className="changelog-block" aria-label={heading}>
        <h2 className="settings-group__title">{heading}</h2>
        <ol className="changelog">
          {entries.map((entry) => (
            <li key={`${entry.sha}-${entry.title}`} className="changelog__item">
              <p className="changelog__title">{entry.title}</p>
              {entry.body !== '' ? <p className="changelog__body">{entry.body}</p> : null}
            </li>
          ))}
        </ol>
      </section>
    );
  }
  if (fallback !== undefined && fallback !== '') {
    return <p className="page__lede">{fallback}</p>;
  }
  return null;
}
