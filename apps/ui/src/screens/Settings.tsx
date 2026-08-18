import { useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { TopBar } from '../components/TopBar';
import { fetchLive, fetchSession } from '../data/media';
import {
  applyPlanClass,
  FALLBACK_PLAN,
  fetchPlan,
  saveStyle,
  styleMinPlanLabel,
  styleUnlocked,
  type PlanStatus,
  type StyleId,
} from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

type SettingsSection = 'hub' | 'appearance' | 'account' | 'livetv' | 'device' | 'system';

function sectionOf(params: Readonly<Record<string, unknown>>): SettingsSection {
  const raw = params['section'];
  if (
    raw === 'appearance' ||
    raw === 'account' ||
    raw === 'livetv' ||
    raw === 'device' ||
    raw === 'system'
  ) {
    return raw;
  }
  return 'hub';
}

function openSection(
  navigate: ReturnType<typeof useNavigate>,
  section: Exclude<SettingsSection, 'hub'>,
): void {
  navigate.push('settings', { params: { section } });
}

export function Settings({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const section = sectionOf(params);
  const [liveDetail, setLiveDetail] = useState('M3U / M3U8');
  const [desktopDetail, setDesktopDetail] = useState('TVM stick only');
  const [appliance, setAppliance] = useState(false);
  const [plan, setPlan] = useState<PlanStatus>(FALLBACK_PLAN);

  useEffect(() => {
    void fetchLive().then((status) => {
      if (status === null) return;
      if (status.url === null) setLiveDetail('Not added');
      else if (status.error !== null) setLiveDetail('Playlist error');
      else setLiveDetail(`${status.channels.length} channels`);
    });
    void fetchSession().then((status) => {
      setAppliance(status.appliance);
      if (status.appliance) setDesktopDetail(status.mode === 'desktop' ? 'Open now' : 'Leave TVM');
      else setDesktopDetail('TVM stick only');
    });
    void fetchPlan().then((status) => {
      applyPlanClass(status);
      setPlan(status);
    });
  }, []);

  const currentStyle =
    (plan.styles.length > 0 ? plan.styles : FALLBACK_PLAN.styles).find((style) => style.id === plan.styleId)?.name ??
    'Classic';

  return (
    <main className="page page--settings">
      <TopBar title={section === 'hub' ? 'Settings' : sectionTitle(section)} />
      <p className="stage__kicker">{section === 'hub' ? 'Device and services' : 'Settings'}</p>
      <h1 className="page__heading">{sectionTitle(section)}</h1>
      {section === 'hub' && (
        <div className="settings-hub">
          <FocusButton
            id="cat-appearance"
            className="settings-row settings-cat"
            detail={currentStyle}
            onSelect={() => openSection(navigate, 'appearance')}
          >
            <span className="settings-cat__kicker">Look</span>
            Appearance
          </FocusButton>
          <FocusButton
            id="cat-account"
            className="settings-row settings-cat"
            detail={plan.name}
            onSelect={() => openSection(navigate, 'account')}
          >
            <span className="settings-cat__kicker">Plan</span>
            Account
          </FocusButton>
          <FocusButton
            id="cat-livetv"
            className="settings-row settings-cat"
            detail={liveDetail}
            onSelect={() => openSection(navigate, 'livetv')}
          >
            <span className="settings-cat__kicker">Channels</span>
            Live TV
          </FocusButton>
          <FocusButton
            id="cat-device"
            className="settings-row settings-cat"
            detail={`${window.innerWidth} × ${window.innerHeight}`}
            onSelect={() => openSection(navigate, 'device')}
          >
            <span className="settings-cat__kicker">This box</span>
            Device
          </FocusButton>
          <FocusButton
            id="cat-system"
            className="settings-row settings-cat"
            detail="Updates and recovery"
            onSelect={() => openSection(navigate, 'system')}
          >
            <span className="settings-cat__kicker">Maintain</span>
            System
          </FocusButton>
        </div>
      )}
      {section === 'appearance' && <AppearanceSettings plan={plan} setPlan={setPlan} />}
      {section === 'account' && <AccountSettings plan={plan} />}
      {section === 'livetv' && <LiveTvSettings liveDetail={liveDetail} />}
      {section === 'device' && (
        <DeviceSettings appliance={appliance} desktopDetail={desktopDetail} />
      )}
      {section === 'system' && <SystemSettings />}
    </main>
  );
}

function sectionTitle(section: SettingsSection): string {
  if (section === 'appearance') return 'Appearance';
  if (section === 'account') return 'Account';
  if (section === 'livetv') return 'Live TV';
  if (section === 'device') return 'Device';
  if (section === 'system') return 'System';
  return 'Settings';
}

function AppearanceSettings({
  plan,
  setPlan,
}: {
  plan: PlanStatus;
  setPlan: (plan: PlanStatus) => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const styles = plan.styles.length > 0 ? plan.styles : FALLBACK_PLAN.styles;

  return (
    <div className="settings-list">
      <p className="page__lede">Themes tint the chrome. Artwork stays as shot. Eagles is mint on navy.</p>
      <div className="theme-grid">
        {styles.map((style) => {
          const unlocked = styleUnlocked(plan, style.id as StyleId);
          const on = plan.styleId === style.id;
          return (
            <FocusButton
              key={style.id}
              id={`style-${style.id}`}
              className={`theme-card${on ? ' theme-card--on' : ''}`}
              detail={!unlocked ? `Locked · ${style.minPlan}` : on ? 'On' : 'Apply'}
              onSelect={() => {
                if (!unlocked) {
                  navigate.pushModal('notice', {
                    params: {
                      title: style.name,
                      body: `This style unlocks on ${styleMinPlanLabel(style.minPlan)}.`,
                    },
                  });
                  return;
                }
                void saveStyle(style.id as StyleId).then((status) => {
                  applyPlanClass(status);
                  setPlan(status);
                });
              }}
            >
              <span className="theme-swatch" data-theme={style.id} aria-hidden="true" />
              {style.name}
            </FocusButton>
          );
        })}
      </div>
      <FocusButton id="back" className="settings-row" onSelect={() => navigate.pop()}>
        Back
      </FocusButton>
    </div>
  );
}

function AccountSettings({ plan }: { plan: PlanStatus }): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <div className="settings-list">
      <FocusButton
        id="plan"
        className="settings-row"
        detail={`${plan.name} · ${plan.price}`}
        onSelect={() => navigate.push('plans')}
      >
        Plan
      </FocusButton>
      <FocusButton id="profiles" className="settings-row" detail="TVM Stream only" onSelect={() => navigate.push('profiles')}>
        Profiles
      </FocusButton>
      <FocusButton
        id="realdebrid"
        className="settings-row"
        detail="Saved on this machine"
        onSelect={() => navigate.push('realdebrid')}
      >
        Real-Debrid
      </FocusButton>
      <FocusButton
        id="developer"
        className="settings-row"
        detail={plan.developer ? 'Open' : 'Locked'}
        onSelect={() => navigate.push(plan.developer ? 'developer' : 'developer-unlock')}
      >
        Developer
      </FocusButton>
      <FocusButton id="back" className="settings-row" onSelect={() => navigate.pop()}>
        Back
      </FocusButton>
    </div>
  );
}

function LiveTvSettings({ liveDetail }: { liveDetail: string }): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <div className="settings-list">
      <FocusButton
        id="livetv"
        className="settings-row"
        detail={liveDetail}
        onSelect={() => navigate.push('live-playlist')}
      >
        Playlist
      </FocusButton>
      <FocusButton id="open-live" className="settings-row" onSelect={() => navigate.push('live')}>
        Open Live TV
      </FocusButton>
      <FocusButton id="back" className="settings-row" onSelect={() => navigate.pop()}>
        Back
      </FocusButton>
    </div>
  );
}

function DeviceSettings({
  appliance,
  desktopDetail,
}: {
  appliance: boolean;
  desktopDetail: string;
}): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <div className="settings-list">
      <FocusButton
        id="network"
        className="settings-row"
        detail={navigator.onLine ? 'Connected' : 'Offline'}
        onSelect={() => navigate.push('system-info', { params: { section: 'network' } })}
      >
        Network
      </FocusButton>
      <FocusButton
        id="display"
        className="settings-row"
        detail={`${window.innerWidth} × ${window.innerHeight}`}
        onSelect={() => navigate.push('system-info', { params: { section: 'display' } })}
      >
        Display
      </FocusButton>
      <FocusButton
        id="linux-desktop"
        className="settings-row"
        detail={desktopDetail}
        onSelect={() => {
          if (!appliance) {
            navigate.pushModal('notice', {
              params: {
                title: 'Linux desktop',
                body: 'The Linux desktop lives on the TVM USB stick. TVM still boots fullscreen; this setting opens the OS behind it when you need files or a terminal. On this Windows PC the stick is prepared with os/scripts/prepare-usb.ps1.',
              },
            });
            return;
          }
          navigate.pushModal('confirm', {
            params: {
              title: 'Open the Linux desktop?',
              body: 'TVM closes and the Linux desktop behind it opens. Use Return to TVM on that desktop to come back in fullscreen.',
              confirmLabel: 'Open desktop',
              action: 'linux-desktop',
            },
          });
        }}
      >
        Linux desktop
      </FocusButton>
      <FocusButton id="back" className="settings-row" onSelect={() => navigate.pop()}>
        Back
      </FocusButton>
    </div>
  );
}

function SystemSettings(): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <div className="settings-list">
      <FocusButton id="updates" className="settings-row" detail="GLogic Studios" onSelect={() => navigate.push('updates')}>
        Updates
      </FocusButton>
      <FocusButton id="diagnostics" className="settings-row" onSelect={() => navigate.pushModal('diagnostics')}>
        Diagnostics
      </FocusButton>
      <FocusButton
        id="clear-cache"
        className="settings-row"
        detail="Artwork and catalogs"
        onSelect={() =>
          navigate.pushModal('confirm', {
            params: {
              title: 'Clear cache?',
              body: 'Artwork and catalog caches are deleted. Your Real-Debrid token, profiles and watch history stay.',
              confirmLabel: 'Clear cache',
              action: 'clear-cache',
            },
          })
        }
      >
        Clear cache
      </FocusButton>
      <FocusButton
        id="factory-reset"
        className="settings-row"
        detail="Including the Real-Debrid token"
        onSelect={() =>
          navigate.pushModal('confirm', {
            params: {
              title: 'Fully reset TVM?',
              body: 'Profiles, watch history, My List, Live TV playlist, caches and the Real-Debrid token are removed. You will need to paste the token again.',
              confirmLabel: 'Fully reset',
              action: 'factory-reset',
            },
          })
        }
      >
        Fully reset
      </FocusButton>
      <FocusButton
        id="restart"
        className="settings-row"
        onSelect={() =>
          navigate.pushModal('confirm', {
            params: {
              title: 'Restart TVM?',
              body: 'The interface reloads. Nothing on disk is changed.',
              confirmLabel: 'Restart',
              action: 'restart',
            },
          })
        }
      >
        Restart
      </FocusButton>
      <FocusButton id="back" className="settings-row" onSelect={() => navigate.pop()}>
        Back
      </FocusButton>
    </div>
  );
}
