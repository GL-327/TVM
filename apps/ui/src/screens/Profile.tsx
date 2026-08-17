import { useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { TopBar } from '../components/TopBar';
import { fetchRdStatus, type RdStatus } from '../data/media';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const EMPTY: RdStatus = { configured: false, username: null, premium: false, error: null };

export function Profile(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [rd, setRd] = useState<RdStatus>(EMPTY);

  useEffect(() => {
    void fetchRdStatus().then((status) => {
      if (status !== null) setRd(status);
    });
  }, []);

  return (
    <main className="page page--settings">
      <TopBar title="Household" />
      <p className="stage__kicker">Local profile</p>
      <h1 className="page__heading">Household</h1>
      <p className="page__lede">
        TVM currently has one local household. Watch progress and settings belong to this device and are never
        uploaded by TVM.
      </p>
      <dl className="panel__rows settings-summary">
        <div className="panel__row">
          <dt>Profile</dt>
          <dd>Household</dd>
        </div>
        <div className="panel__row">
          <dt>Real-Debrid</dt>
          <dd>{rd.username ?? (rd.configured ? 'Connected' : 'Not connected')}</dd>
        </div>
        <div className="panel__row">
          <dt>Premium</dt>
          <dd>{rd.premium ? 'Active' : 'No'}</dd>
        </div>
      </dl>
      <div className="hero__actions">
        <FocusButton id="realdebrid" variant="primary" onSelect={() => navigate.push('realdebrid')}>
          Manage Real-Debrid
        </FocusButton>
        <FocusButton id="back" onSelect={() => navigate.pop()}>
          Back
        </FocusButton>
      </div>
    </main>
  );
}
