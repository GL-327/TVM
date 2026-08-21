import { useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { TopBar } from '../components/TopBar';
import {
  applyPlanClass,
  FALLBACK_PLAN,
  fetchPlan,
  lockDeveloper,
  resetUsage,
  saveOverrides,
  savePlan,
  type PlanId,
  type PlanStatus,
} from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const ORDER: PlanId[] = ['free', 'basic', 'premium', 'ultra', 'max'];

export function Developer(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PlanStatus>(FALLBACK_PLAN);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = (status: PlanStatus): void => {
    applyPlanClass(status);
    setPlan(status);
  };

  useEffect(() => {
    void fetchPlan().then((status) => {
      if (!status.developer) {
        navigate.replace('developer-unlock');
        return;
      }
      refresh(status);
    });
    // Unlock is checked once when this panel mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async (work: () => Promise<PlanStatus>): Promise<void> => {
    try {
      refresh(await work());
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Developer action failed.');
    }
  };

  return (
    <main className="page page--settings">
      <TopBar title="Developer" />
      <p className="stage__kicker">Studio panel</p>
      <h1 className="page__heading">Developer</h1>
      <p className="page__lede">
        Current plan {plan.name}. These switches override gating on this machine without a mock payment.
      </p>
      {message !== null && <p className="page__message">{message}</p>}
      <div className="settings-list" data-wrap="y">
        {ORDER.map((id) => (
          <FocusButton
            key={id}
            id={`dev-${id}`}
            className="settings-row"
            detail={plan.id === id ? 'Selected' : 'Set'}
            onSelect={() => void apply(() => savePlan(id))}
          >
            Force {id}
          </FocusButton>
        ))}
        <FocusButton
          id="dev-ads"
          className="settings-row"
          detail={plan.ads ? 'On' : 'Off'}
          onSelect={() => void apply(() => saveOverrides({ ads: !plan.ads }))}
        >
          Ads
        </FocusButton>
        <FocusButton
          id="dev-queue"
          className="settings-row"
          detail={plan.queueMs > 0 ? 'On' : 'Off'}
          onSelect={() => void apply(() => saveOverrides({ queue: plan.queueMs === 0 }))}
        >
          Queue
        </FocusButton>
        <FocusButton
          id="dev-mocks"
          className="settings-row"
          detail={plan.mocks ? 'On' : 'Off'}
          onSelect={() => void apply(() => saveOverrides({ mocks: !plan.mocks }))}
        >
          Mock streamers
        </FocusButton>
        <FocusButton
          id="dev-live"
          className="settings-row"
          detail={plan.liveTv ? 'On' : 'Off'}
          onSelect={() => void apply(() => saveOverrides({ liveTv: !plan.liveTv }))}
        >
          Live TV pack
        </FocusButton>
        <FocusButton
          id="dev-quality"
          className="settings-row"
          detail={`${plan.maxHeight}p`}
          onSelect={() => {
            const next = plan.maxHeight === 720 ? 1080 : plan.maxHeight === 1080 ? 2160 : 720;
            void apply(() => saveOverrides({ maxHeight: next }));
          }}
        >
          Quality cap
        </FocusButton>
        <FocusButton id="dev-hours" className="settings-row" onSelect={() => void apply(() => resetUsage())}>
          Reset weekly hours
        </FocusButton>
        <FocusButton id="dev-home" className="settings-row" onSelect={() => navigate.home()}>
          Jump Home
        </FocusButton>
        <FocusButton id="dev-live-jump" className="settings-row" onSelect={() => navigate.push('live')}>
          Jump Live TV
        </FocusButton>
        <FocusButton id="dev-apps" className="settings-row" onSelect={() => navigate.push('apps')}>
          Jump Apps
        </FocusButton>
        <FocusButton
          id="dev-lock"
          className="settings-row"
          onSelect={() => {
            void lockDeveloper().then(() => navigate.home());
          }}
        >
          Leave developer mode
        </FocusButton>
      </div>
    </main>
  );
}
