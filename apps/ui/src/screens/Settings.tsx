import { ANIME_SCENES, setAnimeScene, useAnimeScene } from '../theme/anime/catalog';
import { useEffect, useRef, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { PageScene } from '../components/PageScene';
import { Ribbon } from '../components/Ribbon';
import { fetchLive, fetchSession } from '../data/media';
import { applyPlanClass, displayMaxLabel, FALLBACK_PLAN, fetchPlan, saveLiveTv, saveStyle, styleMinPlanLabel, styleUnlocked, themeUnlocked, type PlanStatus, type StyleId } from '../data/plan';
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
  const animeScene = useAnimeScene();
  const [liveDetail, setLiveDetail] = useState('Loading…');
  const [desktopDetail, setDesktopDetail] = useState('Loading…');
  const [appliance, setAppliance] = useState(false);
  const [plan, setPlan] = useState<PlanStatus>(FALLBACK_PLAN);
  const [theme, setTheme] = useState<ThemeId>(readStoredTheme);
  const [motion, setMotion] = useState(readMotionPreference);
  const [performance, setPerformance] = useState(readPerformanceMode);
  const [language, setLanguage] = useState(() => readPrefs().language);
  const [autoUpdate, setAutoUpdate] = useState(() => readPrefs().autoUpdate);
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
    void fetchSession()
      .then((status) => {
        setAppliance(status.appliance);
        if (status.appliance) setDesktopDetail(status.mode === 'desktop' ? 'Open now' : 'Leave TVM');
        else setDesktopDetail('TVM stick only');
      })
      .catch(() => setDesktopDetail('TVM stick only'));
    void fetchPlan().then((status) => {
      applyPlanClass(status);
      setPlan(status);
      if (!themeUnlocked(status, readStoredTheme())) {
        setTheme(applyTheme('default'));
      }
    });
  }, []);

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
          <FocusButton id="motion" className="settings-row" detail={motion === 'reduced' ? 'Reduced · freeze decorative loops' : 'Auto · Retro and UI animate'} onSelect={() => {
            const next = motion === 'reduced' ? 'auto' : 'reduced';
            applyMotionPreference(next);
            setMotion(next);
          }}>Motion</FocusButton>
          <FocusButton
            id="performance"
            className="settings-row"
            detail={performance ? 'On · hide Retro loops, snap motion' : 'Off · Retro and UI keep animating'}
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
        <FocusButton id="theme-bundle" className="settings-row" detail={plan.bundle ? 'Owned · includes future paid packs' : '£9.99 · all paid themes, including future packs'} onSelect={() => navigate.push('checkout', { params: { pack: 'theme-bundle' } })}>All paid themes bundle</FocusButton>
        {THEMES.map((spec) => {
          const locked = spec.premium === true && !themeUnlocked(plan, spec.id);
          return (
            <FocusButton
              key={spec.id}
              id={`theme-${spec.id}`}
              className="settings-row"
              detail={
                locked
                  ? `£${((spec.id === 'anime' ? plan.animeAddonPence : plan.synthwaveAddonPence) / 100).toFixed(2)} · Unlock`
                  : theme === spec.id
                    ? 'On'
                    : 'Apply'
              }
              onSelect={() => {
                if (locked) {
                  navigate.push('checkout', {
                    params: { planId: plan.id, name: plan.name, pack: spec.id },
                  });
                  return;
                }
                setTheme(applyTheme(spec.id));
              }}
            >
              Theme · {spec.name}
            </FocusButton>
          );
        })}
        {theme === 'anime' && <section className="anime-scene-picker" aria-label="Anime scenes">{ANIME_SCENES.map(scene => <FocusButton key={scene.id} id={`anime-scene-${scene.id}`} className="settings-row" detail={scene.id === animeScene.id ? 'On · ' + scene.hook : scene.summary} onSelect={() => setAnimeScene(scene.id)}>{scene.title}</FocusButton>)}</section>}
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
          detail={`${plan.name} · ${plan.price}`}
          onSelect={() => navigate.push('plans')}
        >
          Plan
        </FocusButton>
        {plan.liveTvOptional ? (
          <FocusButton
            id="live-tv-addon"
            className="settings-row"
            detail={plan.liveTv ? `On · ${plan.price}` : `Off · ${plan.basePrice}`}
            onSelect={() => {
              void saveLiveTv(!plan.liveTv)
                .then((status) => {
                  applyPlanClass(status);
                  setPlan(status);
                })
                .catch((error: unknown) => {
                  navigate.pushModal('notice', {
                    params: {
                      title: 'Live TV',
                      body: error instanceof Error ? error.message : 'Live TV was not updated.',
                    },
                  });
                });
            }}
          >
            Live TV pack
          </FocusButton>
        ) : null}
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
      </div>
    </main>
  );
}
