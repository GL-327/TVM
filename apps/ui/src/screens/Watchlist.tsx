import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { FocusButton } from '../components/FocusButton';
import { LoadingScreen } from '../components/LoadingScreen';
import { PageScene } from '../components/PageScene';
import { PosterCard } from '../components/PosterCard';
import { Ribbon } from '../components/Ribbon';
import { asTitle, fetchWatchlist, type MediaItem } from '../data/media';
import { openDetails } from '../data/openDetails';
import { requestFocus } from '../nav/focusEngine';
import { useFocusScope, useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function Watchlist(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const scope = useFocusScope();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchWatchlist()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    const id = items[0] !== undefined ? `saved-${items[0].id}-0` : 'watchlist-browse';
    const timer = window.setTimeout(() => requestFocus(`${scope}/${id}`), 0);
    return () => window.clearTimeout(timer);
  }, [items, loading, scope]);

  const openTitle = useCallback(
    (item: MediaItem): void => {
      openDetails(navigate, asTitle(item));
    },
    [navigate],
  );

  return (
    <main className="page page--library page--docked">
      <PageScene />
      <Ribbon active="watchlist" />
      <header className="page__toolbar">
        <div>
          <p className="stage__kicker">Saved for later</p>
          <h1 className="page__heading">Watchlist</h1>
        </div>
      </header>
      {loading ? (
        <LoadingScreen
          eyebrow="Watchlist"
          title="Loading watchlist…"
          body="Reading titles saved on this device."
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          body="Add a title from its details page. Watchlist stays on this device."
          actions={
            <FocusButton id="watchlist-browse" variant="primary" onSelect={() => navigate.home()}>
              Back to Home
            </FocusButton>
          }
        />
      ) : (
        <div className="poster-grid" data-wrap="grid" aria-label="Watchlist">
          {items.map((item, index) => (
            <PosterCard
              key={`${item.id}-${index}`}
              title={asTitle(item)}
              prefix="saved"
              index={index}
              onSelect={() => openTitle(item)}
            />
          ))}
        </div>
      )}
    </main>
  );
}
