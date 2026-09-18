import { useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { announceAccountChange, signInDev } from '../data/account';
import { applyPlanClass, fetchPlan } from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

/** Dev mode comes with the dev account, so unlocking it means switching to that account. */
export function DeveloperUnlock(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (raw?: string): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await signInDev((raw ?? (fieldValue('dev-password') || password)).trim());
      announceAccountChange();
      applyPlanClass(await fetchPlan());
      navigate.replace('developer');
    } catch (error) {
      setMessage(error instanceof Error && error.message !== '' ? error.message : 'That code is not valid.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page--settings">
      <TopBar title="Developer" />
      <p className="stage__kicker">GLogic Studios</p>
      <h1 className="page__heading">Dev account</h1>
      <p className="page__lede">
        Enter the dev code to switch to the dev account. Dev mode stays on until you sign out of it. The code is
        checked by Core and never stored here.
      </p>
      {message !== null && <p className="page__message">{message}</p>}
      <label className="token-field">
        <span>Dev code</span>
        <FocusField
          id="dev-password"
          type="password"
          value={password}
          onChange={setPassword}
          onConfirm={(value) => void submit(value)}
          afterPasteFocusId="dev-unlock"
          placeholder="Code, then press OK"
        />
      </label>
      <div className="hero__actions">
        <FocusButton id="dev-unlock" variant="primary" disabled={busy} onSelect={() => void submit()}>
          {busy ? 'Checking…' : 'Switch to dev account'}
        </FocusButton>
        <FocusButton id="dev-cancel" onSelect={() => navigate.pop()}>
          Back
        </FocusButton>
      </div>
    </main>
  );
}
