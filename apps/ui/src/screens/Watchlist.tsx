import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { FocusButton } from '../components/FocusButton';
import { LoadingScreen } from '../components/LoadingScreen';
import { PageScene } from '../components/PageScene';
import { PosterCard } from '../components/PosterCard';
import { Ribbon } from '../components/Ribbon';
import { asTitle, fetchWatchlist, type MediaItem } from '../data/media';
import { openDetails } from '../data/openDetails';
import { watchlistView, type WatchlistFilter, type WatchlistSort } from '../data/watchlistView';
import { requestFocus } from '../nav/focusEngine';
import { useFocusScope, useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function Watchlist(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const scope = useFocusScope();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<WatchlistFilter>('all');
  const [sort, setSort] = useState<WatchlistSort>('saved');
  const visible = useMemo(() => watchlistView(items, filter, sort).map((item) => ({ item, title: asTitle(item) })), [items, filter, sort]);
  const sorts: WatchlistSort[] = ['saved', 'title', 'year', 'rating'];
  const sortLabels = { saved: 'Recently saved', title: 'Title A–Z', year: 'Newest release', rating: 'Highest rated' };

  useEffect(() => {
    let active = true;
    void fetchWatchlist()
      .then((next) => { if (active) setItems(next); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
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
      {!loading && items.length > 0 && (
        <div className="collection-controls" aria-label="Watchlist controls">
          <div className="collection-controls__filters" data-wrap="row" aria-label="Filter titles">
            {(['all', 'movie', 'series'] as const).map((value) => (
              <FocusButton key={value} id={`filter-${value}`} variant={filter === value ? 'primary' : 'standard'} onSelect={() => setFilter(value)}>
                {value === 'all' ? 'All titles' : value === 'movie' ? 'Movies' : 'Series'}
              </FocusButton>
            ))}
          </div>
          <FocusButton id="watchlist-sort" detail={sortLabels[sort]} onSelect={() => setSort(sorts[(sorts.indexOf(sort) + 1) % sorts.length]!)}>Sort by</FocusButton>
          <p className="collection-controls__count" role="status">{visible.length} {visible.length === 1 ? 'title' : 'titles'}</p>
        </div>
      )}
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
      ) : visible.length === 0 ? (
        <EmptyState title={filter === 'series' ? 'No series saved yet' : 'No movies saved yet'} body="Your other saved titles are still here. Switch the filter to see them." actions={<FocusButton id="watchlist-show-all" onSelect={() => setFilter('all')}>Show all titles</FocusButton>} />
      ) : (
        <div className="poster-grid" data-wrap="grid" aria-label="Watchlist">
          {visible.map(({ item, title }, index) => (
            <PosterCard
              key={`${item.id}-${index}`}
              title={title}
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
