import { useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { TopBar } from '../components/TopBar';
import { fetchLive, fetchSession } from '../data/media';
import { applyPlanClass, FALLBACK_PLAN, fetchPlan, saveStyle, styleMinPlanLabel, styleUnlocked, type PlanStatus, type StyleId } from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function Settings(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
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

  return (
    <main className="page page--settings">
      <TopBar title="Settings" />
      <p className="stage__kicker">Device and services</p>
      <h1 className="page__heading">Settings</h1>
      <div className="settings-list">
        <FocusButton
          id="plan"
          className="settings-row"
          detail={`${plan.name} · ${plan.price}`}
          onSelect={() => navigate.push('plans')}
        >
          Plan
        </FocusButton>
        {(plan.styles.length > 0 ? plan.styles : FALLBACK_PLAN.styles).map((style) => {
          const unlocked = styleUnlocked(plan, style.id as StyleId);
          return (
            <FocusButton
              key={style.id}
              id={`style-${style.id}`}
              className="settings-row"
              detail={
                !unlocked
                  ? `Locked · ${style.minPlan}`
                  : plan.styleId === style.id
                    ? 'On'
                    : 'Apply'
              }
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
              Style · {style.name}
            </FocusButton>
          );
        })}
        <FocusButton
          id="developer"
          className="settings-row"
          detail={plan.developer ? 'Open' : 'Locked'}
          onSelect={() => navigate.push(plan.developer ? 'developer' : 'developer-unlock')}
        >
          Developer
        </FocusButton>
        <FocusButton id="profiles" className="settings-row" detail="TVM Stream only" onSelect={() => navigate.push('profiles')}>
          Profiles
        </FocusButton>
        <FocusButton id="realdebrid" className="settings-row" detail="Saved on this machine" onSelect={() => navigate.push('realdebrid')}>
          Real-Debrid
        </FocusButton>
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
          id="livetv"
          className="settings-row"
          detail={liveDetail}
          onSelect={() => navigate.push('live-playlist')}
        >
          Live TV playlist
        </FocusButton>
        <FocusButton id="updates" className="settings-row" detail="GLogic Studios" onSelect={() => navigate.push('updates')}>
          Updates
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
      </div>
    </main>
  );
}
