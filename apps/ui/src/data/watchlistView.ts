import { imdbScore } from './playId';
import type { MediaItem } from './media';

export type WatchlistFilter = 'all' | 'movie' | 'series';
export type WatchlistSort = 'saved' | 'title' | 'year' | 'rating';

export function watchlistView(items: readonly MediaItem[], filter: WatchlistFilter, sort: WatchlistSort): MediaItem[] {
  const visible = items.filter((item) => filter === 'all' || (filter === 'series' ? item.kind === 'series' || item.season !== undefined : item.kind !== 'series' && item.season === undefined));
  if (sort === 'saved') return visible;
  const byTitle = (left: MediaItem, right: MediaItem): number => left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: 'base' });
  return visible.sort((left, right) => {
    if (sort === 'year') return (right.year ?? 0) - (left.year ?? 0) || byTitle(left, right);
    if (sort === 'rating') return Number(imdbScore(right.rating) ?? 0) - Number(imdbScore(left.rating) ?? 0) || byTitle(left, right);
    return byTitle(left, right);
  });
}
