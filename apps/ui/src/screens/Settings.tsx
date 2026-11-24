import { useEffect, useRef, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { PageScene } from '../components/PageScene';
import { Ribbon } from '../components/Ribbon';
import { clearCache, fetchLive, fetchRdStatus, type RdStatus } from '../data/media';
import { applyPlanClass, displayMaxLabel, FALLBACK_PLAN, fetchPlan, type PlanStatus } from '../data/plan';
import { fetchAccount, isDevAccount } from '../data/account';
import { fetchAppBuild, type AppBuild } from '../data/appBuild';
import { hydratePrefs, readPrefs, savePrefs } from '../data/prefs';
import { languageName, nextLanguage } from '../i18n/locale';
import { playbackMaxHeight, readDeviceChrome } from '../nav/deviceChrome';
import { bindKeyboardFields } from '../nav/pointerInput';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import { applyTheme, readStoredTheme } from '../theme/apply';
import { THEMES, type ThemeId } from '../theme/registry';
import { applyMotionPreference, applyPerformanceMode, readMotionPreference, readPerformanceMode } from '../theme/motion';

export function Settings(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [liveDetail, setLiveDetail] = useState('Loading…');
  const [plan, setPlan] = useState<PlanStatus>(FALLBACK_PLAN);
  const [accessDetail, setAccessDetail] = useState('Loading…');
  const [theme, setTheme] = useState<ThemeId>(readStoredTheme);
  const [motion, setMotion] = useState(readMotionPreference);
  const [performance, setPerformance] = useState(readPerformanceMode);
  const [language, setLanguage] = useState(() => readPrefs().language);
  const [autoUpdate, setAutoUpdate] = useState(() => readPrefs().autoUpdate);
  const [isDevRole, setIsDevRole] = useState(false);
  const [appBuild, setAppBuild] = useState<AppBuild | null>(null);
  const [rdStatus, setRdStatus] = useState<RdStatus | null>(null);
  const [refreshingCache, setRefreshingCache] = useState(false);
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => bindKeyboardFields(pageRef.current), []);

  useEffect(() => {
    void hydratePrefs().then((prefs) => {
      setLanguage(prefs.language);
      setAutoUpdate(prefs.autoUpdate);
    });
    void fetchLive()
      .then((status) => {
        if (status === null) {
          setLiveDetail('Not added');
          return;
        }
        if (status.configured === true && status.host) setLiveDetail(status.username ?? status.host);
        else if (status.url === null) setLiveDetail('Not added');
        else if (status.error !== null) setLiveDetail('Playlist error');
        else if ((status.total ?? 0) > 0) setLiveDetail(`${status.picked ?? 0} of ${status.total} on Live TV`);
        else setLiveDetail(`${status.channels.length} channels`);
      })
      .catch(() => setLiveDetail('Not added'));
    void fetchPlan().then((status) => {
      applyPlanClass(status);
      setPlan(status);
      setTheme(readStoredTheme());
    });
    void fetchAccount().then((state) => {
      const devRole = isDevAccount(state);
      setIsDevRole(devRole);
      setAccessDetail(state.account?.activated
        ? state.account.tier === 'stream-live' ? 'TVM Stream + Live TV' : 'TVM Stream'
        : 'Waiting for activation');
      if (devRole) {
        void fetchAppBuild().then(setAppBuild);
        void fetchRdStatus().then(setRdStatus);
      }
    }).catch(() => setAccessDetail('View access'));
  }, []);

  useEffect(() => {
    if (!plan.developer && !isDevRole) return;
    if (appBuild === null) void fetchAppBuild().then(setAppBuild);
    if (rdStatus === null) void fetchRdStatus().then(setRdStatus);
  }, [appBuild, isDevRole, plan.developer, rdStatus]);

  return (
    <main ref={pageRef} className="page page--settings page--docked" data-keyboard-fields="">
      <PageScene />
      <Ribbon active="settings" />
      <header className="page__toolbar">
        <div>
          <p className="stage__kicker">Device and services</p>
          <h1 className="page__heading">Settings</h1>
        </div>
      </header>
      <div className="settings-list" data-wrap="y">
        <section className="settings-group">
          <h2 className="settings-group__title">Picture</h2>
          <FocusButton id="motion" className="settings-row" detail={motion === 'reduced' ? 'Reduced · freeze decorative loops' : 'Auto · UI animates'} onSelect={() => {
            const next = motion === 'reduced' ? 'auto' : 'reduced';
            applyMotionPreference(next);
            setMotion(next);
          }}>Motion</FocusButton>
          <FocusButton
            id="performance"
            className="settings-row"
            detail={performance ? 'On · simpler effects and motion' : 'Off · full UI motion'}
            onSelect={() => {
              const next = !performance;
              applyPerformanceMode(next);
              setPerformance(next);
            }}
          >
            Performance mode
          </FocusButton>
        </section>
        <section className="settings-group">
          <h2 className="settings-group__title">Look</h2>
        {THEMES.map((spec) => {
          return (
            <FocusButton
              key={spec.id}
              id={`theme-${spec.id}`}
              className="settings-row"
              detail={theme === spec.id ? 'On' : 'Apply'}
              onSelect={() => {
                setTheme(applyTheme(spec.id));
              }}
            >
              Theme · {spec.name}
            </FocusButton>
          );
        })}
        </section>
        <section className="settings-group">
          <h2 className="settings-group__title">Language</h2>
        <FocusButton
          id="language"
          className="settings-row"
          detail={languageName(language)}
          onSelect={() => {
            const next = nextLanguage(language);
            setLanguage(next);
            void savePrefs({ language: next });
          }}
        >
          App language
        </FocusButton>
        </section>
        <section className="settings-group">
          <h2 className="settings-group__title">Account</h2>
        <FocusButton id="privacy" className="settings-row" detail="Terms, data export and deletion" onSelect={() => navigate.push('legal')}>Privacy & terms</FocusButton>
        <FocusButton
          id="plan"
          className="settings-row"
          detail={accessDetail}
          onSelect={() => navigate.push('plans')}
        >
          Plan
        </FocusButton>
        {plan.developer ? (
        <FocusButton
          id="developer"
          className="settings-row"
          detail="Open"
          onSelect={() => navigate.push('developer')}
        >
          Developer
        </FocusButton>
        ) : null}
        <FocusButton id="profiles" className="settings-row" detail="TVM Stream only" onSelect={() => navigate.push('profiles')}>
          Profiles
        </FocusButton>
        <FocusButton id="realdebrid" className="settings-row" detail="Your token" onSelect={() => navigate.push('realdebrid')}>
          Real-Debrid
        </FocusButton>
        </section>
        <section className="settings-group">
          <h2 className="settings-group__title">Device</h2>
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
          detail={`${displayMaxLabel(playbackMaxHeight(plan.maxHeight, readDeviceChrome().maxHeight))} · ${readDeviceChrome().model}`}
          onSelect={() => navigate.push('system-info', { params: { section: 'display' } })}
        >
          Display
        </FocusButton>
        <FocusButton
          id="livetv"
          className="settings-row"
          detail={liveDetail}
          onSelect={() => navigate.push('live-xtream')}
        >
          Live TV login
        </FocusButton>
        <FocusButton
          id="live-playlist"
          className="settings-row"
          detail="M3U / M3U8"
          onSelect={() => navigate.push('live-playlist')}
        >
          Live TV playlist
        </FocusButton>
        <FocusButton id="updates" className="settings-row" detail="GLogic Studios" onSelect={() => navigate.push('updates')}>
          Updates
        </FocusButton>
        <FocusButton
          id="auto-update"
          className="settings-row"
          detail={autoUpdate ? 'On · apply when this app opens' : 'Off · check from Updates'}
          onSelect={() => {
            const next = !autoUpdate;
            setAutoUpdate(next);
            void savePrefs({ autoUpdate: next });
          }}
        >
          Automatic updates
        </FocusButton>
        <FocusButton id="diagnostics" className="settings-row" onSelect={() => navigate.pushModal('diagnostics')}>
          Diagnostics
        </FocusButton>
        </section>
        <section className="settings-group">
          <h2 className="settings-group__title">Maintenance</h2>
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
        </section>
        {plan.developer || isDevRole ? (
          <section className="settings-group settings-dev-card" aria-label="Developer Diagnostics">
            <h2 className="settings-group__title">Developer Diagnostics</h2>
            <dl className="panel__rows settings-dev-card__rows">
              <div className="panel__row">
                <dt>Build</dt>
                <dd>
                  {appBuild === null
                    ? 'Checking…'
                    : appBuild.kind === 'known'
                      ? appBuild.build
                      : appBuild.kind === 'desktop'
                        ? 'Desktop checkout'
                        : 'Legacy shell'}
                </dd>
              </div>
              <div className="panel__row">
                <dt>Real-Debrid key source</dt>
                <dd>
                  {rdStatus === null
                    ? 'Checking…'
                    : !rdStatus.configured
                      ? 'Not configured'
                      : rdStatus.source === 'account'
                        ? 'Account (remote)'
                        : 'Device (local)'}
                </dd>
              </div>
              <div className="panel__row">
                <dt>Theme & motion</dt>
                <dd>
                  {theme} · motion:{motion} · perf:{performance ? 'on' : 'off'}
                </dd>
              </div>
            </dl>
            <FocusButton
              id="dev-refresh-cache"
              className="settings-row settings-dev-card__action"
              disabled={refreshingCache}
              detail={refreshingCache ? 'Refreshing…' : 'Reload UI'}
              onSelect={() => {
                setRefreshingCache(true);
                void clearCache().finally(() => window.location.reload());
              }}
            >
              Clear cache & reload
            </FocusButton>
          </section>
        ) : null}
      </div>
    </main>
  );
}
