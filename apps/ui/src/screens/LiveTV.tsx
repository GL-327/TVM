import { useEffect, useMemo, useState } from 'react';
import { ChannelCard } from '../components/ChannelCard';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { LoadingScreen } from '../components/LoadingScreen';
import { PageScene } from '../components/PageScene';
import { Rail } from '../components/Rail';
import { Ribbon } from '../components/Ribbon';
import { fetchLive, saveXtream, type LiveChannel, type LiveStatus } from '../data/media';
import { applyPlanClass, FALLBACK_PLAN, fetchPlan, type PlanStatus } from '../data/plan';
import { requestFocus } from '../nav/focusEngine';
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

function groupedChannels(channels: LiveChannel[]): Array<{ name: string; channels: LiveChannel[] }> {
  const map = new Map<string, LiveChannel[]>();
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
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<string | null>(null);
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = (): void => {
    setLoading(true);
    void Promise.all([fetchLive(), fetchPlan()]).then(([next, nextPlan]) => {
      applyPlanClass(nextPlan);
      setPlan(nextPlan);
      const statusBody = next ?? { ...EMPTY, error: 'unreachable', configured: true };
      setStatus(statusBody);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (loading || busy) {
      const timer = window.setTimeout(() => requestFocus(`${scope}/live-loading-back`), 0);
      return () => window.clearTimeout(timer);
    }
    const id = status.configured === true ? 'live-picks' : 'host';
    const timer = window.setTimeout(() => requestFocus(`${scope}/${id}`), 0);
    return () => window.clearTimeout(timer);
  }, [busy, loading, status.configured, scope]);

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

  const channels = status.channels;
  const gated = !loading && status.configured !== true;
  const locked = !gated && !plan.liveTv && channels.length === 0 && (status.total ?? 0) === 0;
  const groups = useMemo(() => groupedChannels(channels), [channels]);
  const visibleGroups = group === null ? groups : groups.filter((entry) => entry.name === group);
  const liveOnPrice =
    plan.liveTvAddonPence > 0
      ? `£${((plan.basePricePence + plan.liveTvAddonPence) / 100).toFixed(2)}`
      : 'a paid plan';
  const picked = status.picked ?? 0;
  const total = status.total ?? 0;
  const pickLimit = status.pickLimit ?? 48;

  return (
    <main className={`page page--library page--docked page--live home${gated ? ' page--setup' : ''}`}>
      <PageScene />
      <Ribbon active="live" />
      {!gated && !loading && !busy && (
      <header className="page__toolbar">
        <div>
          <p className="stage__kicker">Live TV</p>
          <h1 className="page__heading">{status.needsPicks === true ? 'Choose channels' : 'Your channels'}</h1>
        </div>
        <div className="hero__actions">
          <FocusButton id="live-picks" variant="primary" onSelect={() => navigate.push('live-picks')}>
            Choose channels
          </FocusButton>
          <FocusButton id="live-settings" variant="quiet" onSelect={() => navigate.push('live-xtream')}>
            Login
          </FocusButton>
        </div>
      </header>
      )}

      {loading || busy ? (
        <LoadingScreen
          eyebrow="Live TV"
          title={busy ? 'Signing in…' : 'Loading Live TV…'}
          body={
            busy
              ? 'Checking the login and loading your channels. This stays on this machine.'
              : 'Checking whether a Live TV login or playlist is already on this machine.'
          }
          actions={
            <FocusButton id="live-loading-back" className="tvm-button--glass" onSelect={() => navigate.pop()}>
              Back
            </FocusButton>
          }
        />
      ) : gated ? (
        <>
          <div className="setup-scrim" aria-hidden="true" />
          <section className="setup-card" role="dialog" aria-modal="true" aria-labelledby="live-setup-title">
            <p className="stage__kicker">Live TV</p>
            <h1 id="live-setup-title" className="page__heading">
              Enter your Live TV login
            </h1>
            <p className="page__lede">
              Paste the server, username and password for a live TV panel you are allowed to use, then press OK. Home
              and the other apps stay open without this. It stays on this machine only.
            </p>
            {message !== null && <p className="page__message">{message}</p>}
            <label className="token-field">
              <span>Server URL</span>
              <FocusField
                id="host"
                type="url"
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
              <FocusButton id="live-back" className="tvm-button--glass" onSelect={() => navigate.pop()}>
                Back
              </FocusButton>
            </div>
          </section>
        </>
      ) : locked ? (
        <EmptyState
          eyebrow={plan.liveTvOptional ? 'Add-on' : 'Paid plans'}
          title="Live TV is a paid add-on"
          body={
            plan.liveTvOptional
              ? `Turn Live TV on in Settings to restore the included pack at ${liveOnPrice}. You can also paste an M3U playlist you are allowed to use.`
              : 'Basic and up include a Live TV pack. You can remove it at checkout or in Settings to keep the previous price. You can still add a playlist you are allowed to use.'
          }
          actions={
            <>
              {plan.liveTvOptional ? (
                <FocusButton id="live-enable" variant="primary" onSelect={() => navigate.push('settings')}>
                  Open Settings
                </FocusButton>
              ) : (
                <FocusButton id="live-upgrade" variant="primary" onSelect={() => navigate.push('plans')}>
                  View plans
                </FocusButton>
              )}
              <FocusButton id="add-playlist" onSelect={() => navigate.push('live-playlist')}>
                Add a playlist
              </FocusButton>
              <FocusButton id="back" onSelect={() => navigate.pop()}>
                Back
              </FocusButton>
            </>
          }
        />
      ) : status.error === 'unreachable' ? (
        <ErrorState
          title="Playlist could not be loaded"
          body="TVM could not fetch the M3U address saved in Settings. Check the URL and the network, then retry."
          onRetry={load}
          onBack={() => navigate.pop()}
        />
      ) : status.needsPicks === true && channels.length === 0 ? (
        <EmptyState
          eyebrow={`${total} channels in playlist`}
          title="Pick the channels you watch"
          body={`This playlist is too large to show at once. Choose up to ${pickLimit} channels. The same lineup appears on this computer and on Roku.`}
          actions={
            <>
              <FocusButton id="choose-channels" variant="primary" onSelect={() => navigate.push('live-picks')}>
                Choose channels
              </FocusButton>
              <FocusButton id="add-playlist" onSelect={() => navigate.push('live-playlist')}>
                Playlist
              </FocusButton>
            </>
          }
        />
      ) : channels.length === 0 ? (
        <EmptyState
          eyebrow="No live source connected"
          title="Add a playlist you are allowed to use"
          body="TVM plays channels from an M3U or M3U8 playlist you supply, plus a sample layout pack when Live TV is on your plan. It does not scrape BBC, Sky, or sports streams."
          actions={
            <>
              <FocusButton id="add-playlist" variant="primary" onSelect={() => navigate.push('live-playlist')}>
                Add a playlist
              </FocusButton>
              <FocusButton id="back" onSelect={() => navigate.pop()}>
                Back
              </FocusButton>
            </>
          }
        />
      ) : (
        <>
          <p className="page__lede">
            {total > 0 ? `${picked || channels.length} of ${total} channels on Live TV.` : `${channels.length} channels.`}
            {status.needsPicks === true ? ' Choose which channels to keep on this screen.' : ''}
            {plan.liveTv && status.needsPicks !== true
              ? ' Sample tiles use licensed demo streams for layout only — they are not Sky, TNT, or USA Network.'
              : ''}
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
    </main>
  );
}
