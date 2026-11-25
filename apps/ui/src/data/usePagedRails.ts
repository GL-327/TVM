import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dedupeMediaItems, fetchMoreRail, type CatalogRail, type MediaItem } from './media';

interface RailPageState {
  items: MediaItem[];
  more: boolean;
  page?: number;
  loading: boolean;
}

export function mergePagedRailItems(existing: readonly MediaItem[], incoming: readonly MediaItem[]): MediaItem[] {
  return dedupeMediaItems(existing, incoming);
}

/**
 * Manages off-screen paging (`GET /api/rails/more`) for category rails so each
 * row can grow past its initial ~40 titles without disturbing scroll position.
 */
export function usePagedRails(sourceRails: readonly CatalogRail[]): {
  rails: CatalogRail[];
  loadMore: (railId: string) => void;
  isLoading: (railId: string) => boolean;
} {
  const [pages, setPages] = useState<Readonly<Record<string, RailPageState>>>({});
  const inFlight = useRef<Set<string>>(new Set());
  const sourceRef = useRef(sourceRails);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  useEffect(() => {
    sourceRef.current = sourceRails;
    inFlight.current.clear();
    setPages({});
  }, [sourceRails]);

  const loadMore = useCallback((railId: string): void => {
    if (inFlight.current.has(railId)) return;
    const base = sourceRef.current.find((rail) => rail.id === railId);
    if (base === undefined) return;
    const state = pagesRef.current[railId];
    const currentMore = state?.more ?? (base.more === true);
    if (!currentMore) return;

    const currentItems = state?.items ?? dedupeMediaItems([], base.items);
    const currentPage = state?.page ?? base.page;

    inFlight.current.add(railId);
    setPages((prev) => ({
      ...prev,
      [railId]: {
        items: prev[railId]?.items ?? currentItems,
        more: true,
        page: currentPage,
        loading: true,
      },
    }));

    const snapshotSource = sourceRef.current;
    void fetchMoreRail(railId, currentItems.length, currentPage)
      .then((res) => {
        if (sourceRef.current !== snapshotSource) return;
        setPages((prev) => {
          const prior = prev[railId]?.items ?? currentItems;
          const merged = dedupeMediaItems(prior, res.items);
          const addedNew = merged.length > prior.length;
          return {
            ...prev,
            [railId]: {
              items: merged,
              more: res.more && addedNew,
              page: res.page,
              loading: false,
            },
          };
        });
      })
      .catch(() => {
        if (sourceRef.current !== snapshotSource) return;
        setPages((prev) => ({
          ...prev,
          [railId]: {
            items: prev[railId]?.items ?? currentItems,
            more: false,
            page: currentPage,
            loading: false,
          },
        }));
      })
      .finally(() => {
        inFlight.current.delete(railId);
      });
  }, []);

  const rails = useMemo<CatalogRail[]>(
    () =>
      sourceRails.map((rail) => {
        const ext = pages[rail.id];
        if (ext === undefined) {
          return { ...rail, items: dedupeMediaItems([], rail.items) };
        }
        return {
          ...rail,
          items: ext.items,
          more: ext.more,
          page: ext.page,
        };
      }),
    [pages, sourceRails],
  );

  const isLoading = useCallback((railId: string): boolean => pages[railId]?.loading === true, [pages]);

  return { rails, loadMore, isLoading };
}
