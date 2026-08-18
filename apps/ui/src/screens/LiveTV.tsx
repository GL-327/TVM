import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { FocusButton } from '../components/FocusButton';
import { LoopingRow } from '../components/LoopingRow';
import { Ribbon } from '../components/Ribbon';
import { Skeleton } from '../components/Skeleton';
import { fetchLive, liveGroups, type LiveStatus } from '../data/media';
import { applyPlanClass, FALLBACK_PLAN, fetchPlan, type PlanStatus } from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const EMPTY: LiveStatus = { url: null, channels: [], error: null };

export function LiveTV(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<LiveStatus>(EMPTY);
  const [plan, setPlan] = useState<PlanStatus>(FALLBACK_PLAN);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState('All');

  const load = (): void => {
    setLoading(true);
    void Promise.all([fetchLive(), fetchPlan()]).then(([next, nextPlan]) => {
      applyPlanClass(nextPlan);
      setPlan(nextPlan);
      setStatus(next ?? { url: null, channels: [], error: 'unreachable' });
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  const channels = status.channels;
  const groups = useMemo(() => liveGroups(channels), [channels]);
  const visible = useMemo(
    () => (group === 'All' ? channels : channels.filter((channel) => (channel.group ?? '').trim() === group)),
    [channels, group],
  );
  const locked = !plan.liveTv && channels.length === 0;

  useEffect(() => {
    if (!groups.includes(group)) setGroup('All');
  }, [group, groups]);

  return (
    <main className="page page--library">
      <Ribbon active="live" />
      <header className="page__toolbar">
        <div>
          <p className="stage__kicker">Live TV</p>
          <h1 className="page__heading">{plan.liveTv ? 'Sports and live' : 'Channels'}</h1>
        </div>
        <FocusButton id="live-settings" variant="quiet" onSelect={() => navigate.push('live-playlist')}>
          Playlist
        </FocusButton>
      </header>

      {loading ? (
        <div className="channel-grid">
          <Skeleton className="skeleton--landscape" />
          <Skeleton className="skeleton--landscape" />
          <Skeleton className="skeleton--landscape" />
        </div>
      ) : locked ? (
        <EmptyState
          eyebrow="TVM MAX"
          title="Live TV is on TVM MAX"
          body="Sky Sports, TNT Sports, beIN Sports and USA Network are a mock live pack on MAX, using licensed sample streams. Lower plans can still add a playlist you are allowed to use."
          actions={
            <>
              <FocusButton id="live-upgrade" variant="primary" onSelect={() => navigate.push('plans')}>
                View plans
              </FocusButton>
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
      ) : channels.length === 0 ? (
        <EmptyState
          eyebrow="No live source connected"
          title="Add a playlist you are allowed to use"
          body="TVM only shows channels from an official service or an M3U/M3U8 playlist you supply. It does not scrape BBC or sports streams."
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
            {visible.length} of {channels.length} channels
            {plan.liveTv ? ' including the MAX sports pack. Sample streams are for layout, not licensed matches.' : '.'}
          </p>
          {groups.length > 1 && (
            <LoopingRow className="live-cats" label="Categories">
              {groups.map((name) => (
                <FocusButton
                  key={name}
                  id={`live-cat-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  className={`live-cats__chip${group === name ? ' live-cats__chip--on' : ''}`}
                  onFocus={() => setGroup(name)}
                  onSelect={() => setGroup(name)}
                >
                  {name}
                </FocusButton>
              ))}
            </LoopingRow>
          )}
          <div className="channel-grid" aria-label="Live channels">
            {visible.map((channel) => (
              <FocusButton
                key={channel.id}
                id={channel.id.replaceAll(':', '-')}
                className="app-tile"
                onSelect={() => navigate.pushModal('player', { params: { id: channel.id } })}
              >
                {channel.logo !== undefined && channel.logo !== '' ? (
                  <img className="app-tile__logo" src={channel.logo} alt="" />
                ) : (
                  <span
                    className="app-tile__mark"
                    style={{ background: channel.group === 'Sports' ? 'var(--tvm-danger)' : 'var(--tvm-accent-blue)' }}
                  />
                )}
                <strong>{channel.name}</strong>
                <span>{channel.group ?? 'Live'}</span>
              </FocusButton>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
