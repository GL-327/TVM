import { useCallback, useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import { formatAppDate } from '../i18n/locale';
import { readAutoUpdate, savePrefs } from '../data/prefs';
import { rememberPendingChangelog, type ChangelogEntry, type ChangelogRecord, parseChangelogRecord } from '../data/changelog';

type UpdateKind =
  | 'idle'
  | 'no_release'
  | 'up_to_date'
  | 'available'
  | 'auth_required'
  | 'rate_limited'
  | 'app_update_required'
  | 'failed';

interface UpdateStatus {
  current: string;
  /** The build this copy is running, when the core knows it. */
  currentCommit?: string | null;
  /** The build the installed app was made from. Phones only; see the row below. */
  appBuild?: string | null;
  /** checkout: a git clone; package: a downloaded bundle; phone cores leave it out. */
  install?: 'checkout' | 'package';
  channel: string;
  lastCheck: string | null;
  available: { version: string; commit?: string; notes: string; changelog?: ChangelogEntry[] } | null;
  configured: boolean;
  applyAllowed: boolean;
  applyReason: string | null;
  kind?: UpdateKind;
  notice?: string | null;
  autoUpdate?: boolean;
  changelog?: ChangelogRecord | null;
}

interface ApplyResult {
  version?: string;
  changed?: boolean;
  restart?: 'automatic' | 'self' | 'manual' | 'reload';
  error?: string;
  reason?: string;
}

/** "v1.0.0 · 90a7563" — the version alone never changes, so the commit is what tells builds apart. */
export function describeBuild(version: string, commit: string | null | undefined): string {
  const short = typeof commit === 'string' ? commit.trim().slice(0, 7) : '';
  return short === '' ? `v${version}` : `v${version} · ${short}`;
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
      const body = (await response.json()) as ApplyResult;
      if (!response.ok) {
        setMessage(body.reason ?? body.error ?? 'Apply was refused');
        return;
      }
      if (body.changed === false) {
        setMessage('This copy is already on that build.');
        await refresh().catch(() => undefined);
        return;
      }
      rememberPendingChangelog({
        version: body.version ?? status.available?.version ?? 'github',
        from: status.currentCommit?.slice(0, 7) ?? null,
        entries: status.available?.changelog,
        notes: status.available?.notes,
      });
      if (body.restart === 'manual') {
        setMessage('Updated. Close TVM and open it again to finish.');
        await refresh().catch(() => undefined);
        return;
      }
      // A desktop Core restarts to load the new build; a phone only swaps the page.
      const restarting = body.restart === 'self' || body.restart === 'automatic';
      setMessage(restarting ? 'Updated. TVM is restarting…' : 'Applied. Reloading…');
      window.setTimeout(() => window.location.reload(), restarting ? 2500 : 400);
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

  const appBuild = typeof status.appBuild === 'string' && status.appBuild !== 'unknown'
    ? status.appBuild.slice(0, 7)
    : null;

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
          <dd>{describeBuild(status.current, status.currentCommit)}</dd>
        </div>
        {/* The interface above updates itself; the app around it only changes
            when a new IPA or APK is installed, so the two builds can differ. */}
        {appBuild !== null && (
          <div className="panel__row">
            <dt>Installed app</dt>
            <dd>{appBuild}</dd>
          </div>
        )}
        <div className="panel__row">
          <dt>Last check</dt>
          <dd>{status.lastCheck === null ? 'Never' : formatAppDate(status.lastCheck)}</dd>
        </div>
        <div className="panel__row">
          <dt>Available</dt>
          <dd>
            {status.available !== null
              ? `Build ${status.available.version}`
              : status.kind === 'app_update_required'
                ? 'Needs the new app'
                : 'None'}
          </dd>
        </div>
        <div className="panel__row">
          <dt>GitHub login</dt>
          <dd>{status.configured ? 'Private-fork token stored' : 'Not required'}</dd>
        </div>
      </dl>

      {message !== null && <p className="page__message">{message}</p>}
      {message === null && status.notice != null && status.notice !== '' && status.kind !== 'idle' && (
        <p className="page__message">{status.notice}</p>
      )}
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
