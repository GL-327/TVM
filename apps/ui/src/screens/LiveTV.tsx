import { useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { FocusButton } from '../components/FocusButton';
import { Ribbon } from '../components/Ribbon';
import { Skeleton } from '../components/Skeleton';
import { fetchLive, type LiveStatus } from '../data/media';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const EMPTY: LiveStatus = { url: null, channels: [], error: null };

export function LiveTV(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<LiveStatus>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = (): void => {
    setLoading(true);
    void fetchLive().then((next) => {
      setStatus(next ?? { url: null, channels: [], error: 'unreachable' });
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="page page--library">
      <Ribbon active="live" />
      <header className="page__toolbar">
        <div>
          <p className="stage__kicker">Live TV</p>
          <h1 className="page__heading">Channels</h1>
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
      ) : status.error === 'unreachable' ? (
        <ErrorState
          title="Playlist could not be loaded"
          body="TVM could not fetch the M3U address saved in Settings. Check the URL and the network, then retry."
          onRetry={load}
          onBack={() => navigate.pop()}
        />
      ) : status.channels.length === 0 ? (
        <EmptyState
          eyebrow="No live source connected"
          title="Add a playlist you are allowed to use"
          body="TVM only shows channels from an official service or an M3U/M3U8 playlist you supply. It does not scrape BBC or sports streams."
          actions={
            <>
              <FocusButton id="add-playlist" variant="primary" onSelect={() => navigate.push('live-playlist')}>
                Add a playlist
              </FocusButton>
              <FocusButton id="open-iplayer" onSelect={() => navigate.push('service', { params: { id: 'iplayer' } })}>
                Open BBC iPlayer
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
            {status.channels.length} channels from your playlist. Now/next appears only when the playlist includes it.
          </p>
          <div className="channel-grid" aria-label="Live channels">
            {status.channels.map((channel) => (
              <FocusButton
                key={channel.id}
                id={channel.id.replace(':', '-')}
                className="app-tile"
                onSelect={() => navigate.pushModal('player', { params: { id: channel.id } })}
              >
                <span className="app-tile__mark" style={{ background: '#7c6cff' }} />
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
