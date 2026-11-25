import { useCallback, useEffect, useRef, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { apiFetch } from '../data/media';
import { bindKeyboardFields } from '../nav/pointerInput';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

/*
 * Keeps a sideloaded Roku up to date from this computer. Core saves the
 * Roku's address and developer password, checks TVM Downloads every six
 * hours and uploads each new TVM-roku.zip to the Roku's developer page.
 * Core only accepts these requests from this computer itself.
 */

interface RokuStatus {
  paired: boolean;
  host: string | null;
  autoUpdate: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  lastCheck: string | null;
  lastResult: string | null;
  busy: boolean;
  message?: string;
  error?: string;
}

async function rokuCall(path: string, body?: unknown): Promise<RokuStatus> {
  const response = await apiFetch(path, body === undefined
    ? {}
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await response.json()) as RokuStatus;
  if (!response.ok) {
    throw new Error(json.error === 'roku_local_only'
      ? 'Roku updates can only be set up on the computer running TVM.'
      : json.error ?? 'The Roku settings were not saved.');
  }
  return json;
}

function when(iso: string | null): string {
  if (iso === null) return 'Not yet';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Not yet' : date.toLocaleString();
}

export function RokuUpdates(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<RokuStatus | null>(null);
  const [host, setHost] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pageRef = useRef<HTMLElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setStatus(await rokuCall('/api/roku'));
  }, []);

  useEffect(() => {
    void refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Core did not answer.'));
  }, [refresh]);

  useEffect(() => bindKeyboardFields(pageRef.current), []);

  const run = async (work: () => Promise<RokuStatus>, done?: (next: RokuStatus) => string | null): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await work();
      setStatus(next);
      setMessage(done?.(next) ?? next.message ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const pair = (): Promise<void> =>
    run(
      () => rokuCall('/api/roku/pair', { host: (fieldValue('roku-host') || host).trim(), password: fieldValue('roku-password') || password, autoUpdate: true }),
      () => {
        setPassword('');
        return 'Paired. TVM will install new versions on this Roku.';
      },
    );

  const paired = status?.paired === true;

  return (
    <main ref={pageRef} className="page page--settings" data-keyboard-fields="">
      <TopBar title="Roku updates" />
      <p className="stage__kicker">Updates</p>
      <h1 className="page__heading">Keep your Roku up to date</h1>
      <p className="page__lede">
        A Roku in developer mode cannot update TVM by itself. Pair it here and this computer installs each new
        version for you. You need the Roku’s address (Settings &gt; Network &gt; About) and the developer password
        you chose when you turned on developer mode.
      </p>
      <dl className="panel__rows settings-summary">
        <div className="panel__row">
          <dt>Roku</dt>
          <dd>{paired ? status?.host : 'Not paired'}</dd>
        </div>
        <div className="panel__row">
          <dt>On the Roku</dt>
          <dd>{status?.installedVersion ?? 'Unknown'}</dd>
        </div>
        <div className="panel__row">
          <dt>Latest</dt>
          <dd>{status?.latestVersion ?? 'Not checked yet'}</dd>
        </div>
        <div className="panel__row">
          <dt>Last check</dt>
          <dd>{when(status?.lastCheck ?? null)}{status?.lastResult ? ` · ${status.lastResult}` : ''}</dd>
        </div>
      </dl>
      {message !== null && <p className="page__message">{message}</p>}
      {!paired && (
        <>
          <label className="token-field">
            <span>Roku address</span>
            <FocusField id="roku-host" value={host} onChange={setHost} onConfirm={() => undefined} placeholder="192.168.1.50" inputMode="decimal" afterPasteFocusId="roku-password" />
          </label>
          <label className="token-field">
            <span>Developer password</span>
            <FocusField id="roku-password" type="password" value={password} onChange={setPassword} onConfirm={() => void pair()} afterPasteFocusId="roku-pair" />
          </label>
        </>
      )}
      <div className="hero__actions">
        {!paired && (
          <FocusButton id="roku-pair" variant="primary" disabled={busy} onSelect={() => void pair()}>
            {busy ? 'Pairing…' : 'Pair Roku'}
          </FocusButton>
        )}
        {paired && (
          <FocusButton id="roku-install" variant="primary" disabled={busy || status?.busy === true} onSelect={() => void run(() => rokuCall('/api/roku/install', { force: false }))}>
            {busy ? 'Checking…' : 'Check and install now'}
          </FocusButton>
        )}
        {paired && (
          <FocusButton
            id="roku-auto"
            disabled={busy}
            onSelect={() => void run(() => rokuCall('/api/roku/auto', { enabled: !(status?.autoUpdate ?? false) }), (next) =>
              next.autoUpdate ? 'TVM will check every six hours.' : 'Automatic installs are off.')}
          >
            {status?.autoUpdate ? 'Automatic: on' : 'Automatic: off'}
          </FocusButton>
        )}
        {paired && (
          <FocusButton id="roku-forget" className="tvm-button--glass" disabled={busy} onSelect={() => void run(() => rokuCall('/api/roku/forget', {}), () => 'Roku forgotten.')}>
            Forget this Roku
          </FocusButton>
        )}
        <FocusButton id="roku-back" onSelect={() => navigate.pop()}>Back</FocusButton>
      </div>
    </main>
  );
}
