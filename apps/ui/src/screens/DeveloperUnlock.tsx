import { useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { applyPlanClass, fetchPlan, unlockDeveloper } from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function DeveloperUnlock(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (raw?: string): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await unlockDeveloper((raw ?? fieldValue('dev-password') ?? password).trim());
      if (!result.unlocked) {
        setMessage('That code is not valid.');
        return;
      }
      const plan = await fetchPlan();
      applyPlanClass(plan);
      navigate.replace('developer');
    } catch {
      setMessage('That code is not valid.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page--settings">
      <TopBar title="Developer" />
      <p className="stage__kicker">GLogic Studios</p>
      <h1 className="page__heading">Developer</h1>
      <p className="page__lede">Enter the studio code. It is checked as a hash on this machine and is never shown again.</p>
      {message !== null && <p className="page__message">{message}</p>}
      <label className="token-field">
        <span>Studio code</span>
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
          Unlock
        </FocusButton>
        <FocusButton id="dev-cancel" onSelect={() => navigate.pop()}>
          Back
        </FocusButton>
      </div>
    </main>
  );
}
