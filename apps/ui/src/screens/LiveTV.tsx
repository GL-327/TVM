import { useEffect, useMemo, useRef, useState } from 'react';
import { BackButton } from '../components/BackButton';
import { ChannelCard } from '../components/ChannelCard';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { PageScene } from '../components/PageScene';
import { Rail } from '../components/Rail';
import { Ribbon } from '../components/Ribbon';
import { bundledFreeChannels, fetchFreeChannels, filterChannelsByAge, type LiveChannelWithMeta } from '../data/freeLive';
import { fetchLive, saveXtream, type LiveChannel, type LiveStatus } from '../data/media';
import { applyPlanClass, FALLBACK_PLAN, fetchPlan, type PlanStatus } from '../data/plan';
import { fetchProfiles } from '../data/profiles';
import { requestFocus } from '../nav/focusEngine';
import { bindKeyboardFields } from '../nav/pointerInput';
import { useFocusScope, useNavigate } from '../nav/ViewStackContext';
import { livePlayerParams } from '../player/features/LiveOverlay';
import type { ScreenProps } from '../nav/registry';

const EMPTY: LiveStatus = {
  url: null,
  host: null,
  username: null,
  configured: false,
  channels: [],
  error: null,
  picked: 0,
  total: 0,
  groups: [],
  needsPicks: false,
  pickLimit: 48,
};

function groupedChannels<T extends LiveChannel>(channels: readonly T[]): Array<{ name: string; channels: T[] }> {
  const map = new Map<string, T[]>();
  for (const channel of channels) {
    const name = channel.group?.trim() || 'Live';
    const list = map.get(name) ?? [];
    list.push(channel);
    map.set(name, list);
  }
  return [...map.entries()].map(([name, items]) => ({ name, channels: items }));
}

export function LiveTV(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const scope = useFocusScope();
  const [status, setStatus] = useState<LiveStatus>(EMPTY);
  const [plan, setPlan] = useState<PlanStatus>(FALLBACK_PLAN);
  const [maxAge, setMaxAge] = useState<number>(18);
  const [freeChannels, setFreeChannels] = useState<LiveChannelWithMeta[]>(() => bundledFreeChannels(18));
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<string | null>(null);
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pageRef = useRef<HTMLElement>(null);
  const needsLogin = status.configured !== true && status.channels.length === 0;

  const load = (): void => {
    setLoading(true);
    void fetchProfiles().then((registry) => {
      const active = registry.profiles.find((p) => p.id === registry.activeId) ?? registry.profiles[0];
      const profileWithMeta = active as (typeof active & { maxAge?: number; kind?: string }) | undefined;
      const resolvedAge = profileWithMeta?.maxAge ?? (profileWithMeta?.kind === 'kids' ? 7 : 18);
      setMaxAge(resolvedAge);
      setFreeChannels(bundledFreeChannels(resolvedAge));
      void fetchFreeChannels(resolvedAge).then((list) => setFreeChannels(list));
    });
    void Promise.all([fetchLive(), fetchPlan()]).then(([next, nextPlan]) => {
      applyPlanClass(nextPlan);
      setPlan(nextPlan);
      const statusBody = next ?? { ...EMPTY, error: 'unreachable', configured: false };
      setStatus(statusBody);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => bindKeyboardFields(pageRef.current), []);

  useEffect(() => {
    const firstFree = freeChannels[0];
    if (firstFree !== undefined) {
      const timer = window.setTimeout(() => requestFocus(`${scope}/${firstFree.id.replaceAll(':', '-')}`), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => requestFocus(`${scope}/live-back`), 0);
    return () => window.clearTimeout(timer);
  }, [freeChannels, scope]);

  const connect = async (): Promise<void> => {
    const nextHost = (fieldValue('host') || host).trim();
    const nextUser = (fieldValue('username') || username).trim();
    const nextPass = fieldValue('password') || password;
    if (nextHost === '' || nextUser === '' || nextPass.trim() === '') {
      setMessage('Enter the server, username and password, then press OK.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const body = await saveXtream({ host: nextHost, username: nextUser, password: nextPass });
      setStatus(body);
      setPassword('');
      if (body.error === 'needs-auth') setMessage('That login was rejected. Check the server, username and password.');
      else if (body.error === 'unreachable') setMessage('TVM could not reach that server. Check the address and the network.');
      else if (body.error === 'invalid') setMessage('Enter a server URL, username and password.');
      else if (body.configured !== true) setMessage('The login was not stored.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The login was not stored.');
    } finally {
      setBusy(false);
    }
  };

  const freeGroups = useMemo(() => groupedChannels(freeChannels), [freeChannels]);
  const freeQueue = useMemo(
    () =>
      freeChannels.map((ch) => ({
        id: ch.id,
        name: ch.name,
        url: ch.url ?? '',
        geo: ch.geo ?? null,
      })),
    [freeChannels],
  );

  const channels = useMemo(() => filterChannelsByAge(status.channels, maxAge), [maxAge, status.channels]);
  const groups = useMemo(() => groupedChannels(channels), [channels]);
  const visibleGroups = group === null ? groups : groups.filter((entry) => entry.name === group);
  const picked = status.picked ?? 0;
  const total = status.total ?? 0;
  const pickLimit = status.pickLimit ?? 48;

  return (
    <main ref={pageRef} className="page page--library page--docked page--live home" data-keyboard-fields="">
      <PageScene />
      <Ribbon active="live" />
      <header className="page__toolbar">
        <div className="page__toolbar-lead">
          <BackButton id="live-back" />
          <div>
            <p className="stage__kicker">Live TV</p>
            <h1 className="page__heading">{status.needsPicks === true ? 'Choose channels' : 'Live TV'}</h1>
          </div>
        </div>
        <div className="hero__actions">
          <FocusButton id="live-picks" className="tvm-button--glass" onSelect={() => navigate.push('live-picks')}>
            Choose channels
          </FocusButton>
          {plan.developer ? (
            <FocusButton id="live-check" variant="quiet" onSelect={() => navigate.push('live-check')}>
              Check channels
            </FocusButton>
          ) : null}
          <FocusButton id="live-settings" variant="quiet" onSelect={() => navigate.push('live-xtream')}>
            Login
          </FocusButton>
        </div>
      </header>

      <section className="live-section" aria-label="Free channels">
        <h2 className="live-section__title">Free channels</h2>
        <p className="page__lede">
          Free official broadcasts that work right away with no login or playlist.
        </p>
        {freeGroups.length === 0 ? (
          <p className="page__lede">No free channels match your current profile age limit.</p>
        ) : (
          <div className="live-shelf">
            {freeGroups.map((entry) => (
              <Rail
                key={`free-${entry.name}`}
                id={`live-free-${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                title={entry.name}
              >
                {entry.channels.map((channel) => (
                  <ChannelCard
                    key={channel.id}
                    channel={channel}
                    focusId={channel.id.replaceAll(':', '-')}
                    onSelect={() =>
                      navigate.pushModal('player', {
                        params: {
                          ...livePlayerParams(channel),
                          link: channel.url ?? '',
                          channelGeo: channel.geo ?? null,
                          freeQueue,
                        },
                      })
                    }
                  />
                ))}
              </Rail>
            ))}
          </div>
        )}
      </section>

      <section className="live-section" aria-label="Your channels">
        <h2 className="live-section__title">Your playlist and login</h2>
        {loading || busy ? (
          <p className="page__lede">{busy ? 'Signing in and checking your channels…' : 'Checking saved Live TV login or playlist…'}</p>
        ) : !plan.liveTv && channels.length === 0 && total === 0 ? (
          <div className="live-inline-card glass glass--card">
            <p className="page__lede">Add an M3U playlist or upgrade for your own Live TV login.</p>
            <div className="hero__actions">
              <FocusButton id="add-playlist" variant="primary" onSelect={() => navigate.push('live-playlist')}>
                Add a playlist
              </FocusButton>
              <FocusButton id="live-upgrade" className="tvm-button--glass" onSelect={() => navigate.push('plans')}>
                View plans
              </FocusButton>
            </div>
          </div>
        ) : status.error === 'unreachable' ? (
          <div className="live-inline-card glass glass--card">
            <p className="page__lede">Could not load your saved playlist right now. Free channels above are still available.</p>
            <div className="hero__actions">
              <FocusButton id="live-retry" variant="primary" onSelect={load}>
                Retry playlist
              </FocusButton>
              <FocusButton id="add-playlist" className="tvm-button--glass" onSelect={() => navigate.push('live-playlist')}>
                Edit playlist
              </FocusButton>
            </div>
          </div>
        ) : needsLogin ? (
          <div className="live-inline-card glass glass--card" role="region" aria-labelledby="live-setup-title">
            <h3 id="live-setup-title" className="live-section__title">
              Enter your Live TV login
            </h3>
            <p className="page__lede">
              Optional: paste your Xtream login or add an M3U playlist. Your credentials stay on this machine only.
            </p>
            {message !== null && <p className="page__message">{message}</p>}
            <label className="token-field">
              <span>Server URL</span>
              <FocusField
                id="host"
                type="url"
                enterKeyHint="next"
                value={host}
                onChange={setHost}
                onConfirm={() => void connect()}
                afterPasteFocusId="username"
                placeholder="http://host:port"
              />
            </label>
            <label className="token-field">
              <span>Username</span>
              <FocusField
                id="username"
                autoCapitalize="none"
                enterKeyHint="next"
                value={username}
                onChange={setUsername}
                onConfirm={() => void connect()}
                afterPasteFocusId="password"
                placeholder="Username"
              />
            </label>
            <label className="token-field">
              <span>Password</span>
              <FocusField
                id="password"
                type="password"
                value={password}
                onChange={setPassword}
                onConfirm={() => void connect()}
                afterPasteFocusId="save"
                placeholder="Password"
              />
            </label>
            <div className="hero__actions">
              <FocusButton id="save" variant="primary" disabled={busy} onSelect={() => void connect()}>
                {busy ? 'Connecting…' : 'Continue'}
              </FocusButton>
              <FocusButton id="add-playlist" className="tvm-button--glass" onSelect={() => navigate.push('live-playlist')}>
                Add a playlist
              </FocusButton>
            </div>
          </div>
        ) : status.needsPicks === true && channels.length === 0 ? (
          <div className="live-inline-card glass glass--card">
            <p className="page__lede">
              Choose up to {pickLimit} channels from your {total}-channel playlist.
            </p>
            <div className="hero__actions">
              <FocusButton id="choose-channels" variant="primary" onSelect={() => navigate.push('live-picks')}>
                Choose channels
              </FocusButton>
              <FocusButton id="add-playlist" className="tvm-button--glass" onSelect={() => navigate.push('live-playlist')}>
                Playlist
              </FocusButton>
            </div>
          </div>
        ) : channels.length === 0 ? (
          <div className="live-inline-card glass glass--card">
            <p className="page__lede">Add an M3U or M3U8 playlist to show your own channels below the free channels.</p>
            <div className="hero__actions">
              <FocusButton id="add-playlist" variant="primary" onSelect={() => navigate.push('live-playlist')}>
                Add a playlist
              </FocusButton>
            </div>
          </div>
        ) : (
          <>
            <p className="page__lede">
              {total > 0 ? `${picked || channels.length} of ${total} channels on Live TV.` : `${channels.length} channels.`}
            </p>
            {groups.length > 1 ? (
              <div className="channel-chips" data-wrap="row" aria-label="Groups">
                <FocusButton
                  id="live-group-all"
                  className={`channel-chip${group === null ? ' channel-chip--on' : ''}`}
                  onSelect={() => setGroup(null)}
                >
                  All
                </FocusButton>
                {groups.map((entry) => (
                  <FocusButton
                    key={entry.name}
                    id={`live-group-${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    className={`channel-chip${group === entry.name ? ' channel-chip--on' : ''}`}
                    onSelect={() => setGroup(entry.name)}
                  >
                    {entry.name}
                  </FocusButton>
                ))}
              </div>
            ) : null}
            <div className="live-shelf">
              {visibleGroups.map((entry) => (
                <Rail
                  key={entry.name}
                  id={`live-${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  title={visibleGroups.length > 1 || group !== null ? entry.name : undefined}
                >
                  {entry.channels.map((channel) => (
                    <ChannelCard
                      key={channel.id}
                      channel={channel}
                      focusId={channel.id.replaceAll(':', '-')}
                      onSelect={() => navigate.pushModal('player', { params: livePlayerParams(channel) })}
                    />
                  ))}
                </Rail>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
