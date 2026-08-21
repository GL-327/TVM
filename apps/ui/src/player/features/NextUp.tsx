import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { activeEntry } from '@tvm/nav';
import { Artwork } from '../../components/Artwork';
import { FocusButton } from '../../components/FocusButton';
import { IconPlay } from '../../components/Icons';
import { episodeHeading } from '../../data/episodes';
import {
  asTitle,
  fetchChildren,
  fetchMedia,
  looksLikePack,
  sortEpisodes,
  type MediaItem,
} from '../../data/media';
import { imdbIdFrom, playIdFor } from '../../data/playId';
import { requestFocus } from '../../nav/focusEngine';
import { useNavigate, useScopedFocusKey, useViewStack } from '../../nav/ViewStackContext';
import { usePlayerSession, type PlayerOverlay } from '../PlayerRoot';
import { isLivePlayback } from './LiveOverlay';

/** Show in the last 30–60s when duration is known. Prefer 45s. */
export const NEXT_UP_MIN_SECONDS = 30;
export const NEXT_UP_MAX_SECONDS = 60;
export const NEXT_UP_PREFERRED_SECONDS = 45;

const SHORT_TITLE_CAP = 0.2;
const PLAY_FOCUS_ID = 'player-next-up';
const DISMISS_FOCUS_ID = 'player-next-up-dismiss';

export interface NextUpProps {
  position?: number;
  duration?: number;
  id?: string;
  mediaId?: string;
  title?: string;
  season?: number;
  episode?: number;
  video?: HTMLVideoElement | null;
  videoRef?: { readonly current: HTMLVideoElement | null };
  hidden?: boolean;
  busy?: boolean;
  error?: string | null;
  overlay?: PlayerOverlay;
}

interface PlaybackIdentity {
  playId: string;
  showId: string;
  title: string;
  season?: number;
  episode?: number;
  live: boolean;
}

export function nextUpWindowSeconds(duration: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const preferred = Math.min(NEXT_UP_MAX_SECONDS, Math.max(NEXT_UP_MIN_SECONDS, NEXT_UP_PREFERRED_SECONDS));
  return Math.min(preferred, Math.max(1, duration * SHORT_TITLE_CAP));
}

export function shouldShowNextUp(position: number, duration: number): boolean {
  const window = nextUpWindowSeconds(duration);
  if (window === null || !Number.isFinite(position) || position < 0) return false;
  const remaining = duration - position;
  return remaining <= window && remaining >= -0.25;
}

export function showIdFromPlayId(id: string): string {
  if (id === '' || id.startsWith('live:')) return id;
  const imdbEpisode = id.match(/^(tt\d+):(\d+):(\d+)$/i);
  if (imdbEpisode?.[1] !== undefined) return imdbEpisode[1].toLowerCase();
  if (id.startsWith('rd:')) return id;
  const catalogEpisode = id.match(/^([^:]+):(\d+):(\d+)$/);
  if (catalogEpisode?.[1] !== undefined) return catalogEpisode[1];
  return id;
}

export function episodeFromPlayId(id: string): { season?: number; episode?: number } {
  if (id.startsWith('rd:') || id.startsWith('live:')) return {};
  const match = id.match(/^[^:]+:(\d+):(\d+)$/);
  if (match?.[1] === undefined || match?.[2] === undefined) return {};
  return { season: Number(match[1]), episode: Number(match[2]) };
}

export function pickNextEpisode(
  items: readonly MediaItem[],
  current: { id?: string; season?: number; episode?: number },
): MediaItem | null {
  const playable = sortEpisodes(
    items.filter((item) => item.playable && !looksLikePack(item.title, item.filename ?? '')),
  );
  const season = current.season;
  const episode = current.episode;
  if (season !== undefined && episode !== undefined) {
    return (
      playable.find((item) => {
        const nextSeason = item.season;
        const nextEpisode = item.episode;
        if (nextSeason === undefined || nextEpisode === undefined) return false;
        return nextSeason > season || (nextSeason === season && nextEpisode > episode);
      }) ?? null
    );
  }
  if (current.id !== undefined && current.id !== '') {
    const index = playable.findIndex((item) => item.id === current.id);
    if (index !== -1) return playable[index + 1] ?? null;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatRemain(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function episodeCode(item: MediaItem): string | null {
  if (item.season === undefined || item.episode === undefined) return null;
  return `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`;
}

function findPlayerVideo(explicit?: HTMLVideoElement | null): HTMLVideoElement | null {
  if (explicit !== null && explicit !== undefined) return explicit;
  return document.querySelector('.player video, video.player__video, .player__video');
}

function playerBlocksNextUp(): boolean {
  return (
    document.querySelector('.player__queue, .player__ad, .player__error, .player__error-block') !== null ||
    document.querySelector('.player.player--busy') !== null
  );
}

function readClock(
  video: HTMLVideoElement | null,
  native: { position: number; duration: number } | null,
  props: NextUpProps,
): { position: number; duration: number } {
  if (video !== null && Number.isFinite(video.duration) && video.duration > 0) {
    return { position: video.currentTime, duration: video.duration };
  }
  if (native !== null) return native;
  return {
    position: asNumber(props.position) ?? 0,
    duration: asNumber(props.duration) ?? 0,
  };
}

function sessionBlocksNextUp(props: NextUpProps): boolean {
  if (props.hidden === true) return true;
  if (props.overlay === 'queue' || props.overlay === 'ad') return true;
  if (props.busy === true) return true;
  if (props.error !== undefined && props.error !== null && props.error !== '') return true;
  if (props.overlay !== undefined || props.busy !== undefined || props.error !== undefined) return false;
  return playerBlocksNextUp();
}

export function NextUp(props: NextUpProps = {}): React.JSX.Element | null {
  const session = usePlayerSession();
  const mediaId = props.mediaId ?? props.id ?? session?.mediaId ?? '';
  const title = props.title ?? session?.title ?? '';
  const season = props.season ?? session?.season;
  const episode = props.episode ?? session?.episode;
  const position = props.position ?? session?.position;
  const duration = props.duration ?? session?.duration;
  const overlay = props.overlay ?? session?.overlay;
  const busy = props.busy ?? session?.busy;
  const error = props.error ?? session?.error ?? null;
  const videoRef = props.videoRef ?? session?.videoRef;
  const explicitVideo = props.video ?? videoRef?.current ?? null;

  const navigate = useNavigate();
  const stack = useViewStack();
  const playFocusKey = useScopedFocusKey(PLAY_FOCUS_ID);
  const jumping = useRef(false);
  const [native, setNative] = useState<{ position: number; duration: number } | null>(null);
  const [fallbackClock, setFallbackClock] = useState({ position: 0, duration: 0 });
  const [domBlocked, setDomBlocked] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [next, setNext] = useState<MediaItem | null>(null);

  const entry = activeEntry(stack);
  const params = entry.name === 'player' ? entry.params : {};
  const paramId = asString(params['id']);
  const paramTitle = asString(params['title']);
  const paramSeason = asNumber(params['season']);
  const paramEpisode = asNumber(params['episode']);

  const identity = useMemo<PlaybackIdentity>(() => {
    const playId = mediaId || paramId;
    const parsed = episodeFromPlayId(playId);
    const nextSeason = season ?? paramSeason ?? parsed.season;
    const nextEpisode = episode ?? paramEpisode ?? parsed.episode;
    return {
      playId,
      showId: showIdFromPlayId(playId),
      title: title || paramTitle,
      ...(nextSeason !== undefined ? { season: nextSeason } : {}),
      ...(nextEpisode !== undefined ? { episode: nextEpisode } : {}),
      live: isLivePlayback(playId),
    };
  }, [episode, mediaId, paramEpisode, paramId, paramSeason, paramTitle, season, title]);

  const clock =
    native ??
    (fallbackClock.duration > 0 || fallbackClock.position > 0
      ? fallbackClock
      : { position: position ?? 0, duration: duration ?? 0 });
  const blocked = sessionBlocksNextUp({ hidden: props.hidden, overlay, busy, error }) || domBlocked;

  useEffect(() => {
    setDismissed(false);
    setNext(null);
    jumping.current = false;
  }, [identity.playId]);

  useEffect(() => {
    const bridge = window.tvmNativePlayer;
    if (bridge === undefined) return;
    return bridge.onEvent((event) => {
      if (event.type === 'state' && Number.isFinite(event.duration) && event.duration > 0) {
        setNative({ position: event.position, duration: event.duration });
      }
    });
  }, []);

  useEffect(() => {
    const sessionHasBlockers = overlay !== undefined || busy !== undefined || error !== null;

    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      const video = findPlayerVideo(explicitVideo);
      setFallbackClock(readClock(video, native, { position, duration }));
      if (!sessionHasBlockers) setDomBlocked(playerBlocksNextUp());
    };
    tick();
    const video = findPlayerVideo(explicitVideo);
    video?.addEventListener('timeupdate', tick);
    video?.addEventListener('durationchange', tick);
    const timer = window.setInterval(tick, 400);
    return () => {
      cancelled = true;
      video?.removeEventListener('timeupdate', tick);
      video?.removeEventListener('durationchange', tick);
      window.clearInterval(timer);
    };
  }, [busy, duration, error, explicitVideo, native, overlay, position]);

  useEffect(() => {
    if (identity.live || identity.playId === '') {
      setNext(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const attempts = [identity.showId];
      if (identity.playId !== identity.showId) attempts.push(identity.playId);
      const imdb = imdbIdFrom(identity.playId);
      if (imdb !== null && !attempts.includes(imdb)) attempts.push(imdb);

      let siblings: MediaItem[] = [];
      for (const id of attempts) {
        const items = await fetchChildren(id);
        if (cancelled) return;
        if (items.length > 0) {
          siblings = items;
          break;
        }
      }
      if (siblings.length === 0) {
        const media = await fetchMedia(identity.playId);
        if (cancelled) return;
        if (media !== null) {
          const fromMedia = showIdFromPlayId(media.id);
          if (!attempts.includes(fromMedia)) siblings = await fetchChildren(fromMedia);
          if (
            identity.season === undefined &&
            media.season !== undefined &&
            media.episode !== undefined &&
            siblings.length > 0
          ) {
            const picked = pickNextEpisode(siblings, {
              id: identity.playId,
              season: media.season,
              episode: media.episode,
            });
            if (!cancelled) setNext(picked);
            return;
          }
        }
      }
      if (cancelled) return;
      setNext(pickNextEpisode(siblings, identity));
    })();
    return () => {
      cancelled = true;
    };
  }, [identity]);

  const playNext = useCallback((): void => {
    if (next === null || jumping.current) return;
    jumping.current = true;
    const showTitle = next.showTitle ?? (identity.title || next.title);
    const seed = next.id.startsWith('tt') ? next.id : identity.showId || next.id;
    const playId =
      next.season !== undefined && next.episode !== undefined ? playIdFor(seed, next.season, next.episode) : next.id;
    navigate.pop();
    navigate.pushModal('player', {
      params: {
        id: playId,
        title: showTitle,
        ...(next.season !== undefined ? { season: next.season } : {}),
        ...(next.episode !== undefined ? { episode: next.episode } : {}),
      },
    });
  }, [identity.showId, identity.title, navigate, next]);

  useEffect(() => {
    const onIntent = (raw: Event): void => {
      if ((raw as CustomEvent<string>).detail !== 'next') return;
      if (next === null) return;
      playNext();
    };
    window.addEventListener('tvm:media-intent', onIntent);
    return () => window.removeEventListener('tvm:media-intent', onIntent);
  }, [next, playNext]);

  const inWindow = shouldShowNextUp(clock.position, clock.duration);
  const visible = !identity.live && !blocked && !dismissed && next !== null && inWindow;

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => requestFocus(playFocusKey), 40);
    return () => window.clearTimeout(timer);
  }, [playFocusKey, visible]);

  if (!visible || next === null) return null;

  const windowSeconds = nextUpWindowSeconds(clock.duration) ?? NEXT_UP_PREFERRED_SECONDS;
  const remaining = Math.max(0, clock.duration - clock.position);
  const drain = Math.min(1, remaining / windowSeconds);
  const code = episodeCode(next);
  const heading = episodeHeading(next);
  const showName = next.showTitle ?? (identity.title || next.title);
  const art = asTitle(next);

  return (
    <div className="next-up-layer" data-next-up="true">
      <style>{NEXT_UP_STYLES}</style>
      <aside className="next-up" aria-label="Next episode">
        <span className="next-up__drain" style={{ transform: `scaleX(${drain})` }} aria-hidden="true" />
        <Artwork title={art} kind="backdrop" className="next-up__still" eager />
        <div className="next-up__body">
          <p className="next-up__kicker">
            Up next
            <span className="next-up__remain">{formatRemain(remaining)}</span>
          </p>
          <p className="next-up__show">{showName}</p>
          <p className="next-up__episode">
            {code !== null ? <span className="next-up__code">{code}</span> : null}
            {heading}
          </p>
          <div className="next-up__actions" data-wrap="row">
            <FocusButton id={PLAY_FOCUS_ID} variant="primary" className="next-up__play" onSelect={playNext}>
              <IconPlay className="next-up__play-icon" />
              Play next
            </FocusButton>
            <FocusButton
              id={DISMISS_FOCUS_ID}
              variant="quiet"
              className="next-up__dismiss"
              onSelect={() => setDismissed(true)}
            >
              Watch credits
            </FocusButton>
          </div>
        </div>
      </aside>
    </div>
  );
}

const NEXT_UP_STYLES = `
.next-up-layer {
  position: absolute;
  inset: 0;
  z-index: 6;
  pointer-events: none;
}
.next-up {
  pointer-events: auto;
  position: absolute;
  right: var(--tvm-safe-x, 2.2rem);
  bottom: 7.2rem;
  display: flex;
  width: min(34rem, 46vw);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--tvm-text, #fff) 16%, transparent);
  border-radius: 1rem;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--tvm-bg, #101018) 72%, transparent), color-mix(in srgb, #050508 88%, transparent));
  box-shadow:
    0 1.2rem 2.8rem rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  backdrop-filter: blur(18px);
  color: var(--tvm-text, #fff);
  animation: next-up-in 420ms var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)) both;
}
.next-up__drain {
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
  height: 0.16rem;
  transform-origin: left center;
  background: var(--tvm-accent-strong, #e50914);
  box-shadow: 0 0 0.7rem color-mix(in srgb, var(--tvm-accent-strong, #e50914) 70%, transparent);
}
.next-up__still {
  display: block;
  flex: 0 0 10.2rem;
  width: 10.2rem;
  min-height: 8.4rem;
  overflow: hidden;
  background:
    radial-gradient(70% 80% at 50% 30%, hsl(var(--poster-hue, 260) 45% 32%), #14141c);
}
.next-up__still img,
.next-up__still .art__card {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.next-up__body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.28rem;
  padding: 0.85rem 1rem 0.9rem;
}
.next-up__kicker {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 0;
  color: var(--tvm-accent-strong, #e50914);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.next-up__remain {
  color: var(--tvm-text-muted, rgba(255, 255, 255, 0.7));
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}
.next-up__show {
  margin: 0;
  overflow: hidden;
  font-size: 1.05rem;
  font-weight: 750;
  letter-spacing: -0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.next-up__episode {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 0.45rem;
  overflow: hidden;
  color: var(--tvm-text-muted, rgba(255, 255, 255, 0.72));
  font-size: 0.92rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.next-up__code {
  flex: 0 0 auto;
  color: var(--tvm-text, #fff);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.next-up__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  margin-top: auto;
}
.next-up__play {
  min-height: 2.6rem;
  padding-inline: 1rem;
}
.next-up__play .tvm-button__label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.next-up__play-icon {
  width: 1.05rem;
  height: 1.05rem;
}
.next-up__dismiss {
  min-height: 2.6rem;
}
@keyframes next-up-in {
  from {
    opacity: 0;
    transform: translate3d(1.4rem, 0.35rem, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .next-up { animation: none; }
}
`;

export default NextUp;
