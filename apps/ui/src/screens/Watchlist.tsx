import { useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { FocusButton } from '../components/FocusButton';
import { PosterCard } from '../components/PosterCard';
import { Rail } from '../components/Rail';
import { Ribbon } from '../components/Ribbon';
import { asTitle, fetchWatchlist, type MediaItem } from '../data/media';
import { openDetails } from '../data/openDetails';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function Watchlist(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [items, setItems] = useState<MediaItem[]>([]);

  useEffect(() => {
    void fetchWatchlist().then(setItems);
  }, []);

  return (
    <main className="page page--library">
      <Ribbon active="watchlist" />
      <header className="page__toolbar">
        <div>
          <p className="stage__kicker">Saved for later</p>
          <h1 className="page__heading">Watchlist</h1>
        </div>
        <FocusButton id="watchlist-home" variant="quiet" onSelect={() => navigate.home()}>
          Home
        </FocusButton>
      </header>
      {items.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          body="Add a title from its details page. Watchlist stays on this device."
          actions={
            <FocusButton id="watchlist-home" variant="primary" onSelect={() => navigate.home()}>
              Back to Home
            </FocusButton>
          }
        />
      ) : (
        <Rail title="Your list">
          {items.map((item) => (
            <PosterCard
              key={item.id}
              title={asTitle(item)}
              prefix="saved"
              layout="landscape"
              onSelect={() => openDetails(navigate, asTitle(item))}
            />
          ))}
        </Rail>
      )}
    </main>
  );
}
