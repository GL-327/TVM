import { useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { TopBar } from '../components/TopBar';
import { PatchNotesSheet } from '../components/PatchNotesPopup';
import { announceAccountChange, signOut } from '../data/account';
import { fetchReleaseChangelog } from '../data/changelog';
import type { ChangelogRelease } from '../data/content';
import { clearLocalCaches, collectDiagnostics, copyText, readLayoutGrid, setLayoutGrid } from '../data/devTools';
import {
  applyPlanClass,
  FALLBACK_PLAN,
  fetchPlan,
  resetUsage,
  saveOverrides,
  savePlan,
  type PlanId,
  type PlanStatus,
} from '../data/plan';
import { FranchiseIntro, INTROS, type IntroPick, type IntroStyle } from '../intros';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import './devTools.css';

const ORDER: PlanId[] = ['free', 'basic', 'premium', 'ultra', 'max'];

/** A pick for the franchise intro overlay without going through a title match. */
function introPick(style: IntroStyle): IntroPick | null {
  const intro = INTROS.find((def) => def.style === style);
  if (intro === undefined) return null;
  const title = Object.values(intro.titles)[0] ?? '';
  return { intro, titleKey: `dev-replay-${intro.id}`, title };
}

export function Developer(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PlanStatus>(FALLBACK_PLAN);
  const [message, setMessage] = useState<string | null>(null);
  const [replay, setReplay] = useState<IntroPick | null>(null);
  const [notes, setNotes] = useState<ChangelogRelease | null>(null);
  const [grid, setGrid] = useState(readLayoutGrid);

  const refresh = (status: PlanStatus): void => {
    applyPlanClass(status);
    setPlan(status);
  };

  useEffect(() => {
    void fetchPlan().then((status) => {
      if (!status.developer) {
        navigate.home();
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

  const say = (text: string): void => setMessage(text);
  const copyDiagnostics = (): void => {
    void collectDiagnostics().then(copyText).then((ok) => say(ok ? 'Diagnostics copied.' : 'Could not copy. Select the text in System information instead.'));
  };
  const clearCaches = (): void => {
    void clearLocalCaches().then((count) => say(`Cleared ${count} cached item${count === 1 ? '' : 's'} on this device.`));
  };
  const replayIntro = (style: IntroStyle): void => {
    const pick = introPick(style);
    if (pick === null) say('That intro is not installed.');
    else setReplay(pick);
  };
  const toggleGrid = (): void => {
    const next = !grid;
    setLayoutGrid(next);
    setGrid(next);
  };
  const forcePatchNotes = (): void => {
    void fetchReleaseChangelog().then((payload) => {
      const newest = payload.releases[0] ?? null;
      if (newest === null) say('No release notes are available.');
      else setNotes(newest);
    }).catch(() => say('Could not load the release notes.'));
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
        <FocusButton
          id="dev-accounts"
          className="settings-row"
          detail="View, search and activate"
          onSelect={() => navigate.push('accounts')}
        >
          Accounts
        </FocusButton>
        <FocusButton
          id="dev-mail"
          className="settings-row"
          detail="Sends the sign-up codes"
          onSelect={() => navigate.push('mail-settings')}
        >
          Email
        </FocusButton>
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
        <FocusButton id="dev-trailer" className="settings-row" detail="Plays the explainer" onSelect={() => navigate.pushModal('trailer')}>
          Watch the TVM trailer
        </FocusButton>
        <FocusButton id="dev-diagnostics" className="settings-row" detail="Version, commit, device, FPS" onSelect={copyDiagnostics}>
          Copy diagnostics
        </FocusButton>
        <FocusButton id="dev-clear-caches" className="settings-row" detail="Keeps profiles and progress" onSelect={clearCaches}>
          Clear local caches
        </FocusButton>
        <FocusButton id="dev-replay-hg" className="settings-row" detail="Hunger Games" onSelect={() => replayIntro('mockingjay')}>
          Replay intro animation
        </FocusButton>
        <FocusButton id="dev-replay-doom" className="settings-row" detail="Doomsday" onSelect={() => replayIntro('doom')}>
          Replay intro animation
        </FocusButton>
        <FocusButton id="dev-grid" className="settings-row" detail={grid ? 'On' : 'Off'} ariaPressed={grid} onSelect={toggleGrid}>
          Show layout grid
        </FocusButton>
        <FocusButton id="dev-patch-notes" className="settings-row" detail="Shows the newest notes now" onSelect={forcePatchNotes}>
          Force patch notes pop-up
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
          detail="Turns dev mode off"
          onSelect={() => void signOut().finally(announceAccountChange)}
        >
          Sign out of the dev account
        </FocusButton>
      </div>
      {replay !== null && (
        <div className="dev-replay">
          <FranchiseIntro key={replay.titleKey} pick={replay} onRelease={() => undefined} onDone={() => setReplay(null)} />
        </div>
      )}
      {notes !== null && <PatchNotesSheet release={notes} onClose={() => setNotes(null)} />}
    </main>
  );
}
