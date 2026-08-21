import { useEffect, useState, type RefObject } from 'react';
import { activeEntry } from '@tvm/nav';
import { useViewStack } from '../../nav/ViewStackContext';
import { usePlayerSession } from '../PlayerRoot';
import { isLivePlayback } from './LiveOverlay';

/**
 * Title plate for the stream chrome.
 *
 * Decorative only: no focusables, `pointer-events: none`, and it fades with
 * the player chrome so Skip Recap / transport stay reachable.
 */
export interface TitleOverlayProps {
  title?: string;
  showTitle?: string;
  season?: number;
  episode?: number;
  episodeLabel?: string;
  position?: number;
  currentTime?: number;
  duration?: number;
  remaining?: number;
  chromeVisible?: boolean;
  visible?: boolean;
  controlsVisible?: boolean;
  busy?: boolean;
  error?: string | null;
  live?: boolean;
  id?: string;
  mediaId?: string;
  video?: HTMLVideoElement | null;
  videoRef?: RefObject<HTMLVideoElement | null>;
}

const EPISODE_MARK = /\bS(\d{1,2})\s*E(\d{1,3})\b/i;
const PLAY_ID_EPISODE = /:(\d{1,2}):(\d{1,3})$/;
const TITLE_EPISODE_TAIL = /\s*[·•\-–|:]\s*S\d{1,2}\s*E\d{1,3}\s*$/i;

export function formatClock(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const total = Math.floor(value);
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`;
}

export function formatSeasonEpisode(season: number, episode: number): string {
  return `S${season} E${episode}`;
}

export function formatRemainingLabel(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 0.5) return null;
  return `${formatClock(seconds)} left`;
}

export function parseSeasonEpisode(source: string | undefined): { season: number; episode: number } | null {
  if (source === undefined || source === '' || source.startsWith('live:')) return null;
  const marked = source.match(EPISODE_MARK);
  if (marked !== null) {
    const season = Number(marked[1]);
    const episode = Number(marked[2]);
    if (Number.isFinite(season) && Number.isFinite(episode) && season > 0 && episode > 0) {
      return { season, episode };
    }
  }
  const playId = source.match(PLAY_ID_EPISODE);
  if (playId === null) return null;
  const season = Number(playId[1]);
  const episode = Number(playId[2]);
  if (!Number.isFinite(season) || !Number.isFinite(episode) || season < 1 || episode < 1) return null;
  return { season, episode };
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function stripEpisodeTail(title: string): string {
  return title.replace(TITLE_EPISODE_TAIL, '').trim();
}

function playerRoot(host: HTMLElement | null): Element | null {
  return host?.closest('.player') ?? document.querySelector('.player');
}

function readChromeVisible(player: Element | null, host: HTMLElement | null): boolean {
  const shell =
    host?.closest('.player-root') ?? player?.querySelector('.player-root') ?? document.querySelector('.player-root');
  if (player !== null) {
    const hiddenAttr = player.getAttribute('data-chrome-hidden');
    if (hiddenAttr === 'true') return false;
    if (hiddenAttr === 'false') return true;
    if (player.getAttribute('data-chrome') === 'hidden') return false;
    if (player.getAttribute('data-chrome-visible') === 'false') return false;
    const chrome = player.querySelector('.player__chrome');
    if (chrome !== null) return !chrome.classList.contains('player__chrome--hidden');
  }
  if (shell?.getAttribute('data-controls') === 'hidden') return false;
  if (shell?.getAttribute('data-controls') === 'visible') return true;
  return true;
}

function chromeFromSession(
  chromeVisible: boolean | undefined,
  visible: boolean | undefined,
  controlsVisible: boolean | undefined,
  busy: boolean | undefined,
  error: string | null | undefined,
): boolean | undefined {
  if (chromeVisible !== undefined) return chromeVisible;
  if (visible !== undefined) return visible;
  if (controlsVisible === undefined && busy === undefined && error === undefined) return undefined;
  return Boolean(controlsVisible) || Boolean(busy) || error != null;
}

function useChromeVisible(explicit: boolean | undefined, host: HTMLElement | null): boolean {
  const [observed, setObserved] = useState(true);

  useEffect(() => {
    if (explicit !== undefined) return;
    const player = playerRoot(host);
    const sync = (): void => setObserved(readChromeVisible(playerRoot(host) ?? player, host));
    sync();
    if (player === null) return;
    const chrome = player.querySelector('.player__chrome');
    const shell = host?.closest('.player-root') ?? player.querySelector('.player-root');
    const observer = new MutationObserver(sync);
    observer.observe(player, {
      attributes: true,
      attributeFilter: ['class', 'data-chrome', 'data-chrome-hidden', 'data-chrome-visible'],
      childList: true,
    });
    if (chrome !== null) observer.observe(chrome, { attributes: true, attributeFilter: ['class'] });
    if (shell !== null) observer.observe(shell, { attributes: true, attributeFilter: ['data-controls'] });
    return () => observer.disconnect();
  }, [explicit, host]);

  return explicit ?? observed;
}

function usePlaybackClock(
  position: number | undefined,
  duration: number | undefined,
  remaining: number | undefined,
  video: HTMLVideoElement | null | undefined,
  host: HTMLElement | null,
): { position: number; duration: number; remaining: number | undefined } {
  const [clock, setClock] = useState({ position: position ?? 0, duration: duration ?? 0 });

  useEffect(() => {
    if (video != null && Number.isFinite(video.duration) && video.duration > 1) return;
    if (position !== undefined || duration !== undefined) {
      setClock({ position: position ?? 0, duration: duration ?? 0 });
    }
  }, [duration, position, video]);

  useEffect(() => {
    if (remaining !== undefined) return;
    const player = playerRoot(host);
    const node =
      video ??
      player?.querySelector<HTMLVideoElement>('video.player__video, video') ??
      document.querySelector<HTMLVideoElement>('.player__video');
    if (node === null || node === undefined) return;
    const sync = (): void => {
      setClock({
        position: Number.isFinite(node.currentTime) ? node.currentTime : 0,
        duration: Number.isFinite(node.duration) ? node.duration : 0,
      });
    };
    sync();
    node.addEventListener('timeupdate', sync);
    node.addEventListener('durationchange', sync);
    node.addEventListener('loadedmetadata', sync);
    return () => {
      node.removeEventListener('timeupdate', sync);
      node.removeEventListener('durationchange', sync);
      node.removeEventListener('loadedmetadata', sync);
    };
  }, [host, remaining, video]);

  const fromVideo = video != null && Number.isFinite(video.duration) && video.duration > 1;
  return {
    position: fromVideo ? clock.position : (position ?? clock.position),
    duration: fromVideo ? clock.duration : (duration ?? clock.duration),
    remaining,
  };
}

export function TitleOverlay(props: TitleOverlayProps): React.JSX.Element {
  const session = usePlayerSession();
  const params = activeEntry(useViewStack()).params;
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  const titleProp = asString(props.title) ?? asString(session?.title);
  const showTitle = asString(props.showTitle);
  const seasonProp = props.season ?? session?.season;
  const episodeProp = props.episode ?? session?.episode;
  const mediaKey = asString(props.id) ?? asString(props.mediaId) ?? asString(session?.mediaId) ?? asString(params['id']);
  const live = props.live ?? session?.live ?? isLivePlayback(mediaKey);
  const position = props.position ?? props.currentTime ?? session?.position;
  const duration = props.duration ?? session?.duration;
  const video = props.video ?? props.videoRef?.current ?? session?.videoRef.current ?? null;

  const explicitVisible = chromeFromSession(
    props.chromeVisible,
    props.visible,
    props.controlsVisible ?? session?.controlsVisible,
    props.busy ?? session?.busy,
    props.error !== undefined ? props.error : (session?.error ?? null),
  );
  const chromeShown = useChromeVisible(explicitVisible, host);
  const clock = usePlaybackClock(position, duration, props.remaining, video, host);

  const paramTitle = asString(params['title']);
  const rawTitle =
    (titleProp !== undefined && titleProp !== 'Loading' ? titleProp : undefined) ??
    showTitle ??
    paramTitle ??
    (titleProp === 'Loading' ? '' : (titleProp ?? ''));
  const parsed =
    parseSeasonEpisode(props.episodeLabel) ?? parseSeasonEpisode(rawTitle) ?? parseSeasonEpisode(mediaKey);
  const season = seasonProp ?? asNumber(params['season']) ?? parsed?.season;
  const episode = episodeProp ?? asNumber(params['episode']) ?? parsed?.episode;
  const title = stripEpisodeTail(rawTitle);
  const episodeText =
    asString(props.episodeLabel) ??
    (season !== undefined && episode !== undefined ? formatSeasonEpisode(season, episode) : null);

  const remainingSeconds =
    props.remaining ??
    (live || !Number.isFinite(clock.duration) || clock.duration <= 0
      ? undefined
      : Math.max(0, clock.duration - clock.position));
  const remainingText = live ? null : remainingSeconds === undefined ? null : formatRemainingLabel(remainingSeconds);
  const displayTitle = title === 'Loading' ? '' : title;
  const hasTitle = displayTitle !== '';
  const hasEpisode = !live && episodeText !== null && episodeText !== '';
  const hasRemaining = remainingText !== null;
  const hasLive = live;

  return (
    <div
      ref={setHost}
      className={`player-title-overlay${chromeShown ? '' : ' player-title-overlay--hidden'}`}
      data-player-overlay="title"
      aria-hidden="true"
    >
      <style>{OVERLAY_CSS}</style>
      <p className="player-title-overlay__kicker">
        {hasLive ? <span className="player-title-overlay__live">Live</span> : 'Now playing'}
      </p>
      {hasTitle ? <p className="player-title-overlay__title">{displayTitle}</p> : null}
      {hasEpisode || hasRemaining ? (
        <p className="player-title-overlay__meta">
          {hasEpisode ? <span className="player-title-overlay__episode">{episodeText}</span> : null}
          {hasEpisode && hasRemaining ? <span className="player-title-overlay__dot" /> : null}
          {hasRemaining ? <span className="player-title-overlay__remaining">{remainingText}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

const OVERLAY_CSS = `
.player-title-overlay {
  position: relative;
  z-index: 2;
  max-width: min(72vw, 52rem);
  margin: 0;
  padding: 0;
  overflow: visible;
  pointer-events: none;
  opacity: 1;
  transition: opacity var(--tvm-motion-base, 200ms) var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
}
.player-title-overlay--hidden {
  opacity: 0;
}
.player-title-overlay__kicker {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin: 0 0 0.45rem;
  color: var(--player-fill, var(--tvm-mark, #7ad7ff));
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  text-shadow: 0 0 0.8rem var(--player-fill-glow, rgba(122, 215, 255, 0.45));
}
.player-title-overlay__live {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.18rem 0.55rem 0.18rem 0.42rem;
  border-radius: 999px;
  background: color-mix(in srgb, #ff4d4d 82%, #fff);
  color: #fff;
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  box-shadow: 0 0 0.85rem rgba(255, 70, 70, 0.45);
}
.player-title-overlay__live::before {
  content: '';
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0.45rem #fff;
  animation: player-live-pulse 1.4s ease-in-out infinite;
}
.player-title-overlay__title,
.player-title-overlay__meta {
  margin: 0;
  pointer-events: none;
  color: var(--tvm-text, #f5f5f5);
  text-shadow: 0 0.12rem 1.1rem rgba(0, 0, 0, 0.78), 0 1px 0 rgba(0, 0, 0, 0.45);
}
.player-title-overlay__title {
  overflow: hidden;
  font-size: clamp(2rem, 4.6vw, 3.35rem);
  font-weight: 750;
  line-height: 1.02;
  letter-spacing: -0.045em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.player-title-overlay__meta {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-top: 0.55rem;
  color: var(--tvm-text-muted, #c4c4c4);
  font-size: var(--tvm-font-size-body, 1.0625rem);
  font-weight: 600;
}
.player-title-overlay__episode,
.player-title-overlay__remaining {
  font-variant-numeric: tabular-nums;
}
.player-title-overlay__dot {
  width: 0.28rem;
  height: 0.28rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--tvm-text-muted, #c4c4c4) 70%, transparent);
}
@keyframes player-live-pulse {
  50% { opacity: 0.35; }
}
@media (prefers-reduced-motion: reduce) {
  .player-title-overlay__live::before { animation: none; }
}
[data-theme="glass"] .player-title-overlay__title,
[data-theme="glass"] .player-title-overlay__meta {
  text-shadow: 0 0.14rem 1.2rem rgba(0, 0, 0, 0.9), 0 1px 0 rgba(0, 0, 0, 0.55);
}
`;

export default TitleOverlay;
