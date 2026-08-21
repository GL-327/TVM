import { useCallback, useEffect, useState } from 'react';
import { activeEntry } from '@tvm/nav';
import { FocusButton } from '../../components/FocusButton';
import { IconWatchlist } from '../../components/Icons';
import { titleById } from '../../data/catalog';
import {
  addWatchlist,
  apiFetch,
  fetchMedia,
  fetchWatchlist,
  removeWatchlist,
  toMediaItem,
  type MediaItem,
} from '../../data/media';
import { useViewStack } from '../../nav/ViewStackContext';
import { usePlayerSession, type PlayerOverlay, type PlayerSession } from '../PlayerRoot';

/** Stable spatial-nav id for the stream-chrome Add/Remove control. */
export const WATCHLIST_FOCUS_ID = 'player-watchlist';

/**
 * Existing watchlist API this control uses:
 * - `fetchWatchlist` → GET `/api/watchlist`
 * - `addWatchlist` → PUT `/api/watchlist`
 * - `removeWatchlist` → POST `/api/watchlist/remove`
 */
export const WATCHLIST_API = {
  read: 'fetchWatchlist',
  add: 'addWatchlist',
  remove: 'removeWatchlist',
  get: '/api/watchlist',
  put: '/api/watchlist',
  removePath: '/api/watchlist/remove',
} as const;

export interface WatchlistActionProps {
  mediaId?: string;
  id?: string;
  title?: string;
  season?: number;
  episode?: number;
  controlsVisible?: boolean;
  overlay?: PlayerOverlay;
  showControls?: () => void;
}

type ReadyState =
  | { kind: 'hidden' }
  | { kind: 'ready'; item: MediaItem; saved: boolean; busy: boolean };

const STYLE_ID = 'tvm-player-watchlist-css';

const CSS = `
.player-watchlist {
  position: relative;
  z-index: 5;
  display: flex;
  justify-content: flex-end;
  padding: 0;
  pointer-events: none;
  opacity: 1;
  transition: opacity var(--tvm-motion-base, 200ms) var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
}
.player-watchlist--hidden {
  opacity: 0;
  pointer-events: none;
}
.player-watchlist__btn {
  pointer-events: auto;
  min-height: 2.5rem;
  padding: 0.35rem 0.9rem;
  border: 1px solid color-mix(in srgb, var(--tvm-text, #fff) 18%, transparent);
  background: color-mix(in srgb, var(--tvm-surface-glass, rgba(28, 28, 28, 0.78)) 82%, transparent);
  color: var(--tvm-text, #f5f5f5);
  box-shadow: 0 0.2rem 0.8rem rgba(0, 0, 0, 0.35);
}
.player-watchlist__btn .tvm-button__label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.player-watchlist__glyph {
  width: 1.15rem;
  height: 1.15rem;
  flex: 0 0 auto;
}
.player-watchlist[data-saved='true'] .player-watchlist__glyph path {
  fill: currentColor;
}
.player-watchlist__btn[data-focused='true'] {
  border-color: #fff;
  background: color-mix(in srgb, var(--tvm-text, #fff) 16%, transparent);
  box-shadow: 0 0 0 0.14rem #fff;
}
`;

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function watchlistApiPresent(): boolean {
  return (
    typeof fetchWatchlist === 'function' &&
    typeof addWatchlist === 'function' &&
    typeof removeWatchlist === 'function'
  );
}

/** GET `/api/watchlist` must succeed — `fetchWatchlist` swallows a missing route. */
export async function watchlistRouteAlive(): Promise<boolean> {
  try {
    const response = await apiFetch(WATCHLIST_API.get);
    return response.ok;
  } catch {
    return false;
  }
}

export function watchlistWorkId(id: string): string | null {
  const trimmed = id.trim();
  if (trimmed === '' || trimmed.startsWith('live:')) return null;
  const episode = trimmed.match(/^(.+):(\d+):(\d+)$/);
  return episode?.[1] ?? trimmed;
}

export function isOnWatchlist(items: readonly MediaItem[], workId: string): boolean {
  return items.some((item) => item.id === workId || item.id.startsWith(`${workId}:`));
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asSeason(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function resolveItem(
  workId: string,
  title: string,
  season: number | undefined,
  episode: number | undefined,
  fetched: MediaItem | null,
): MediaItem | null {
  const catalog = titleById(workId);
  if (catalog !== undefined) return toMediaItem({ ...catalog, id: workId });
  if (fetched !== null) {
    return {
      ...fetched,
      id: workId,
      title: fetched.showTitle ?? fetched.title,
      kind: season !== undefined || fetched.kind === 'series' ? 'series' : fetched.kind,
    };
  }
  if (title === '' || title === 'Loading') return null;
  return {
    id: workId,
    title,
    year: null,
    kind: season !== undefined && episode !== undefined ? 'series' : 'movie',
    synopsis: '',
    poster: '',
    backdrop: '',
    genres: [],
    rating: '',
    playable: true,
    hue: 220,
  };
}

function readFields(
  props: WatchlistActionProps,
  session: PlayerSession | null,
  params: Readonly<Record<string, unknown>>,
): {
  mediaId: string;
  title: string;
  season?: number;
  episode?: number;
  controlsVisible: boolean;
  overlay: PlayerOverlay;
  showControls?: () => void;
} {
  return {
    mediaId: asText(props.mediaId) || asText(props.id) || asText(session?.mediaId) || asText(params['id']),
    title: asText(props.title) || asText(session?.title) || asText(params['title']),
    season: props.season ?? session?.season ?? asSeason(params['season']),
    episode: props.episode ?? session?.episode ?? asSeason(params['episode']),
    controlsVisible: props.controlsVisible ?? session?.controlsVisible ?? true,
    overlay: props.overlay ?? session?.overlay ?? null,
    showControls: props.showControls ?? session?.showControls,
  };
}

/**
 * Focusable Add/Remove on the stream chrome. Hidden when the watchlist API
 * is missing, the title is live, or there is nothing persistable.
 */
export function WatchlistAction(props: WatchlistActionProps = {}): React.JSX.Element | null {
  const session = usePlayerSession();
  const params = activeEntry(useViewStack()).params;
  const { mediaId, title, season, episode, controlsVisible, overlay, showControls } = readFields(
    props,
    session,
    params,
  );
  const [state, setState] = useState<ReadyState>({ kind: 'hidden' });

  useEffect(() => {
    ensureStyles();
  }, []);

  useEffect(() => {
    const workId = watchlistWorkId(mediaId);
    if (workId === null || !watchlistApiPresent() || overlay === 'queue' || overlay === 'ad') {
      setState({ kind: 'hidden' });
      return;
    }

    let cancelled = false;
    void (async () => {
      const catalog = titleById(workId);
      const [alive, items, fetched] = await Promise.all([
        watchlistRouteAlive(),
        fetchWatchlist(),
        catalog === undefined ? fetchMedia(workId) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (!alive) {
        setState({ kind: 'hidden' });
        return;
      }
      const item = resolveItem(workId, title, season, episode, fetched);
      if (item === null) {
        setState({ kind: 'hidden' });
        return;
      }
      setState({ kind: 'ready', item, saved: isOnWatchlist(items, workId), busy: false });
    })();

    return () => {
      cancelled = true;
    };
  }, [episode, mediaId, overlay, season, title]);

  const toggle = useCallback((): void => {
    if (state.kind !== 'ready' || state.busy) return;
    showControls?.();
    const { item, saved } = state;
    setState({ kind: 'ready', item, saved, busy: true });
    const run = saved ? removeWatchlist(item.id) : addWatchlist(item);
    void run
      .then((items) => {
        setState({ kind: 'ready', item, saved: isOnWatchlist(items, item.id), busy: false });
      })
      .catch(() => {
        setState({ kind: 'ready', item, saved, busy: false });
      });
  }, [showControls, state]);

  if (state.kind !== 'ready') return null;

  return (
    <div
      className={`player-watchlist${controlsVisible ? '' : ' player-watchlist--hidden'}`}
      data-player-watchlist="true"
      data-saved={state.saved ? 'true' : undefined}
    >
      <FocusButton
        id={WATCHLIST_FOCUS_ID}
        className="player-watchlist__btn"
        disabled={state.busy}
        onSelect={toggle}
      >
        <IconWatchlist className="player-watchlist__glyph" />
        {state.saved ? 'Remove' : 'Add'}
      </FocusButton>
    </div>
  );
}

export default WatchlistAction;
