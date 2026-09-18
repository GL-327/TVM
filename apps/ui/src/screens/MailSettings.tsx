import { useEffect, useRef, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { clearMail, fetchMail, saveMail, sendTestMail, type MailSecurity, type MailStatus } from '../data/account';
import { bindKeyboardFields } from '../nav/pointerInput';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const PRESETS = [
  { id: 'icloud', label: 'iCloud Mail', host: 'smtp.mail.me.com', port: 587, security: 'starttls' },
  { id: 'gmail', label: 'Gmail', host: 'smtp.gmail.com', port: 465, security: 'tls' },
] as const;

const SECURITY: ReadonlyArray<{ id: MailSecurity; label: string }> = [
  { id: 'starttls', label: 'STARTTLS' },
  { id: 'tls', label: 'TLS' },
];

/** Where the sign-up codes are sent from. Dev mode only. */
export function MailSettings(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [security, setSecurity] = useState<MailSecurity>('starttls');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [from, setFrom] = useState('');
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => bindKeyboardFields(pageRef.current), [status?.supported]);

  const show = (next: MailStatus): void => {
    setStatus(next);
    if (!next.configured) return;
    setHost(next.host ?? '');
    setPort(String(next.port ?? 587));
    setSecurity(next.security === 'tls' ? 'tls' : 'starttls');
    setUsername(next.username ?? '');
    setFrom(next.from ?? '');
  };

  useEffect(() => {
    void fetchMail()
      .then(show)
      .catch((error: unknown) => setMessage(error instanceof Error && error.message !== 'developer_required'
        ? error.message
        : 'Sign in to the dev account to change this.'));
  }, []);

  const act = async (work: () => Promise<string>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await work());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const save = (): Promise<void> => act(async () => {
    show(await saveMail({ host, port: Number(port), security, username, password, from }));
    setPassword('');
    return 'Saved. Send a test to make sure it works.';
  });

  const test = (): Promise<void> => act(async () => {
    const to = testTo.trim() !== '' ? testTo.trim() : from;
    await sendTestMail(to);
    return `Sent. Check the inbox for ${to}.`;
  });

  const remove = (): Promise<void> => act(async () => {
    const next = await clearMail();
    setStatus(next);
    setHost('');
    setUsername('');
    setPassword('');
    setFrom('');
    return 'Removed. New accounts will not be asked for a code.';
  });

  if (status !== null && !status.supported) {
    return (
      <main className="page page--settings">
        <TopBar title="Email" />
        <p className="stage__kicker">Sign-up codes</p>
        <h1 className="page__heading">Email</h1>
        <p className="page__lede">
          This phone does not send email, so it never asks for a code. Set email up on the desktop TVM. You can
          still mark an address as verified from Accounts.
        </p>
        <div className="hero__actions">
          <FocusButton id="mail-host" onSelect={() => navigate.pop()}>Back</FocusButton>
        </div>
      </main>
    );
  }

  return (
    <main ref={pageRef} className="page page--settings" data-keyboard-fields="">
      <TopBar title="Email" />
      <p className="stage__kicker">Sign-up codes</p>
      <h1 className="page__heading">Email</h1>
      <p className="page__lede">
        When this is set up, everyone who signs up is emailed a six-digit code and cannot use TVM until they type
        it in. Use an app password, not your normal one. It stays on this machine.
      </p>
      <dl className="panel__rows settings-summary">
        <div className="panel__row">
          <dt>Status</dt>
          <dd>{status === null ? 'Loading…' : status.configured ? `On · from ${status.from ?? ''}` : 'Off'}</dd>
        </div>
      </dl>
      {message !== null && <p className="page__message">{message}</p>}

      <div className="hero__actions">
        {PRESETS.map((preset) => (
          <FocusButton
            key={preset.id}
            id={`mail-preset-${preset.id}`}
            disabled={busy}
            onSelect={() => {
              setHost(preset.host);
              setPort(String(preset.port));
              setSecurity(preset.security);
            }}
          >
            {preset.label}
          </FocusButton>
        ))}
      </div>

      <label className="token-field">
        <span>Mail server</span>
        <FocusField id="mail-host" type="url" value={host} onChange={setHost} onConfirm={() => void save()} afterPasteFocusId="mail-port" placeholder="smtp.mail.me.com" />
      </label>
      <label className="token-field">
        <span>Port</span>
        <FocusField id="mail-port" inputMode="numeric" value={port} onChange={setPort} onConfirm={() => void save()} afterPasteFocusId="mail-user" placeholder="587" />
      </label>
      <div className="hero__actions">
        {SECURITY.map((option) => (
          <FocusButton
            key={option.id}
            id={`mail-security-${option.id}`}
            className={`billing-option${security === option.id ? ' billing-option--selected' : ''}`}
            disabled={busy}
            onSelect={() => setSecurity(option.id)}
          >
            {option.label}
          </FocusButton>
        ))}
      </div>
      <label className="token-field">
        <span>Username</span>
        <FocusField id="mail-user" inputMode="email" autoComplete="off" value={username} onChange={setUsername} onConfirm={() => void save()} afterPasteFocusId="mail-password" placeholder="you@icloud.com" />
      </label>
      <label className="token-field">
        <span>App password</span>
        <FocusField
          id="mail-password"
          type="password"
          autoComplete="off"
          value={password}
          onChange={setPassword}
          onConfirm={() => void save()}
          afterPasteFocusId="mail-from"
          placeholder={status?.configured === true ? 'Saved. Leave empty to keep it' : 'App password'}
        />
      </label>
      <label className="token-field">
        <span>Send codes from</span>
        <FocusField id="mail-from" inputMode="email" value={from} onChange={setFrom} onConfirm={() => void save()} afterPasteFocusId="mail-save" placeholder="you@icloud.com" />
      </label>
      <div className="hero__actions">
        <FocusButton id="mail-save" variant="primary" disabled={busy} onSelect={() => void save()}>
          {busy ? 'Working…' : 'Save'}
        </FocusButton>
        {status?.configured === true && (
          <FocusButton id="mail-remove" className="tvm-button--glass" disabled={busy} onSelect={() => void remove()}>
            Turn off
          </FocusButton>
        )}
        <FocusButton id="mail-back" onSelect={() => navigate.pop()}>Back</FocusButton>
      </div>

      {status?.configured === true && (
        <>
          <label className="token-field">
            <span>Send a test to</span>
            <FocusField id="mail-test-to" inputMode="email" value={testTo} onChange={setTestTo} onConfirm={() => void test()} afterPasteFocusId="mail-test" placeholder={from} />
          </label>
          <div className="hero__actions">
            <FocusButton id="mail-test" disabled={busy} onSelect={() => void test()}>Send test email</FocusButton>
          </div>
        </>
      )}
    </main>
  );
}
