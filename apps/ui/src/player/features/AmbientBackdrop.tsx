import { activeEntry } from '@tvm/nav';
import { useEffect, useMemo, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { imdbIdFrom, preferBackdrop } from '../../data/artwork';
import { titleById } from '../../data/catalog';
import { asTitle, fetchMedia, peekHome, type MediaItem } from '../../data/media';
import { useViewStack } from '../../nav/ViewStackContext';

/** Playing glow stays in real bars only — never a wash over a full-bleed frame. */
export const AMBIENT_MIN_BAR_PX = 12;

/**
 * When the glow shows:
 * - Paused, buffering, or before the first frame: on, in the letterbox (full-bleed only while the picture size is unknown).
 * - Playing: a whisper, and only if letterbox/pillarbox is at least 12px.
 * - Hidden: no poster/backdrop, reduced transparency, or a full-bleed 16:9 picture while playing.
 */
export const AMBIENT_SHOWS_WHEN =
  'Paused/buffering/pre-frame: letterbox glow on. Playing: faint glow only in real ≥12px bars. Hidden with no art, reduced transparency, or full-bleed 16:9 playback.';

export type AmbientMode = 'off' | 'play' | 'pause';

export interface AmbientBackdropProps {
  src?: string;
  poster?: string;
  backdrop?: string;
  id?: string;
  mediaId?: string;
  title?: string;
  hue?: number;
  paused?: boolean;
  buffering?: boolean;
  busy?: boolean;
  playing?: boolean;
  engine?: string;
  error?: string | null;
  overlay?: 'queue' | 'ad' | null;
  video?: HTMLVideoElement | null;
  videoRef?: RefObject<HTMLVideoElement | null>;
  params?: Readonly<Record<string, unknown>>;
  className?: string;
}

export interface Letterbox {
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Shortest bar in CSS pixels. */
  bar: number;
  kind: 'letter' | 'pillar' | 'none' | 'unknown';
}

const STYLES = `
.player-ambient {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.player-ambient__layer {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 420ms var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
}
.player-ambient[data-ambient='pause'] .player-ambient__layer { opacity: 0.7; }
.player-ambient[data-ambient='play'] .player-ambient__layer { opacity: 0.16; }
.player-ambient__glow {
  position: absolute;
  inset: -22%;
  width: 144%;
  height: 144%;
  object-fit: cover;
  transform: translate3d(0, 0, 0) scale(1.06);
  filter: blur(1.4rem) saturate(1.2) brightness(0.42);
  pointer-events: none;
  animation: player-ambient-drift 48s cubic-bezier(0.37, 0, 0.63, 1) infinite alternate;
}
.player-ambient__veil {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(70% 50% at 50% 0%, color-mix(in srgb, var(--tvm-scene-sun, #c8e4ff) 22%, transparent), transparent 58%),
    radial-gradient(60% 40% at 80% 100%, color-mix(in srgb, var(--tvm-scene-sky, #0a1830) 28%, transparent), transparent 62%);
  mix-blend-mode: soft-light;
  opacity: 0.35;
  animation: player-ambient-breathe 19s ease-in-out infinite;
}
.player-ambient__grain {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.04;
  background: var(--tvm-scene-noise, none);
  mix-blend-mode: overlay;
}
@keyframes player-ambient-drift {
  from { transform: translate3d(-1.2%, 0.4%, 0) scale(1.06); }
  to { transform: translate3d(1.4%, -0.8%, 0) scale(1.12); }
}
@keyframes player-ambient-breathe {
  0%, 100% { opacity: 0.28; }
  50% { opacity: 0.4; }
}
@media (prefers-reduced-transparency: reduce) {
  .player-ambient { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .player-ambient__layer { transition: none; }
  .player-ambient__glow,
  .player-ambient__veil { animation: none; }
}
`;

export function softenArtUrl(url: string): string {
  if (url === '') return url;
  return url
    .replace(/\/t\/p\/(?:original|w1280|w780)\//, '/t/p/w300/')
    .replace(/\/background\/large\//, '/background/small/')
    .replace(/\/poster\/large\//, '/poster/small/')
    .replace(/\/\d{3,4}x\d{3,4}bb/, '/400x400bb');
}

export function letterboxOf(video: HTMLVideoElement | null): Letterbox {
  const empty: Letterbox = { top: 0, right: 0, bottom: 0, left: 0, bar: 0, kind: 'unknown' };
  if (video === null) return empty;
  const boxW = video.clientWidth;
  const boxH = video.clientHeight;
  const picW = video.videoWidth;
  const picH = video.videoHeight;
  if (boxW <= 0 || boxH <= 0) return empty;
  if (picW <= 0 || picH <= 0) return { ...empty, kind: 'unknown' };
  const picAspect = picW / picH;
  const boxAspect = boxW / boxH;
  if (picAspect > boxAspect + 0.01) {
    const drawnH = boxW / picAspect;
    const bar = Math.max(0, (boxH - drawnH) / 2);
    return { top: bar, right: 0, bottom: bar, left: 0, bar, kind: 'letter' };
  }
  if (boxAspect > picAspect + 0.01) {
    const drawnW = boxH * picAspect;
    const bar = Math.max(0, (boxW - drawnW) / 2);
    return { top: 0, right: bar, bottom: 0, left: bar, bar, kind: 'pillar' };
  }
  return { ...empty, kind: 'none' };
}

export function ambientMode(input: {
  hasImage: boolean;
  paused: boolean;
  buffering: boolean;
  letterbox: Letterbox;
  reducedTransparency: boolean;
}): AmbientMode {
  if (!input.hasImage || input.reducedTransparency) return 'off';
  if (input.paused || input.buffering) return 'pause';
  if (input.letterbox.kind === 'letter' || input.letterbox.kind === 'pillar') {
    return input.letterbox.bar >= AMBIENT_MIN_BAR_PX ? 'play' : 'off';
  }
  return 'off';
}

function readString(params: Readonly<Record<string, unknown>> | undefined, key: string): string {
  const value = params?.[key];
  return typeof value === 'string' ? value : '';
}

function mediaRootId(id: string): string {
  if (id.startsWith('live:')) return '';
  return id.replace(/:\d+:\d+$/, '');
}

function homeMatch(id: string, title: string): MediaItem | undefined {
  const home = peekHome();
  if (home === null) return undefined;
  const items: MediaItem[] = [];
  if (home.featured !== null) items.push(home.featured);
  items.push(...home.library, ...home.continueWatching, ...home.watchlist);
  for (const rail of home.rails ?? []) items.push(...rail.items);
  const imdb = imdbIdFrom(id);
  const root = mediaRootId(id);
  return items.find((item) => {
    if (item.id === id || (root !== '' && item.id === root)) return true;
    if (imdb !== null && imdbIdFrom(item.id) === imdb) return true;
    return title !== '' && item.title === title;
  });
}

export function resolveAmbientSrc(input: {
  src?: string;
  poster?: string;
  backdrop?: string;
  id?: string;
  title?: string;
  params?: Readonly<Record<string, unknown>>;
  videoPoster?: string;
}): string {
  const params = input.params;
  const src = input.src ?? readString(params, 'src');
  if (src !== '') return softenArtUrl(src);
  const id = input.id ?? readString(params, 'id');
  const poster = input.poster ?? readString(params, 'poster');
  const backdrop = input.backdrop ?? readString(params, 'backdrop');
  const title = input.title ?? readString(params, 'title');
  const direct = preferBackdrop(id, backdrop, poster);
  if (direct !== '') return softenArtUrl(direct);
  const videoPoster = input.videoPoster ?? '';
  if (videoPoster !== '') return softenArtUrl(videoPoster);
  const root = mediaRootId(id);
  const catalog = titleById(id) ?? (root !== '' && root !== id ? titleById(root) : undefined);
  if (catalog !== undefined) {
    return softenArtUrl(preferBackdrop(catalog.id, catalog.backdrop, catalog.poster));
  }
  const home = homeMatch(id, title);
  if (home !== undefined) return softenArtUrl(preferBackdrop(home.id, home.backdrop, home.poster));
  const imdb = imdbIdFrom(id);
  if (imdb !== null) return softenArtUrl(preferBackdrop(imdb, '', ''));
  return '';
}

function pickVideo(props: AmbientBackdropProps): HTMLVideoElement | null {
  if (props.video !== undefined && props.video !== null) return props.video;
  if (props.videoRef?.current != null) return props.videoRef.current;
  return document.querySelector('.player video');
}

function layerMask(letterbox: Letterbox, mode: AmbientMode): CSSProperties {
  if (mode === 'off') return {};
  if (letterbox.kind === 'unknown' || letterbox.kind === 'none') {
    return { display: 'none' };
  }
  const fade = 18;
  if (letterbox.kind === 'letter') {
    const image = `linear-gradient(to bottom, #fff 0, #fff ${letterbox.top}px, transparent ${letterbox.top + fade}px, transparent calc(100% - ${letterbox.bottom}px - ${fade}px), #fff calc(100% - ${letterbox.bottom}px), #fff 100%)`;
    return { maskImage: image, WebkitMaskImage: image };
  }
  if (letterbox.kind === 'pillar') {
    const image = `linear-gradient(to right, #fff 0, #fff ${letterbox.left}px, transparent ${letterbox.left + fade}px, transparent calc(100% - ${letterbox.right}px - ${fade}px), #fff calc(100% - ${letterbox.right}px), #fff 100%)`;
    return { maskImage: image, WebkitMaskImage: image };
  }
  if (mode === 'pause') {
    const image = 'radial-gradient(ellipse 86% 80% at 50% 50%, transparent 64%, #fff 100%)';
    return { maskImage: image, WebkitMaskImage: image };
  }
  return {};
}

export function AmbientBackdrop(props: AmbientBackdropProps = {}): React.JSX.Element | null {
  const stack = useViewStack();
  const stackParams = activeEntry(stack).name === 'player' ? activeEntry(stack).params : undefined;
  const params = props.params ?? stackParams;
  const id = props.id ?? props.mediaId ?? readString(params, 'id');
  const title = props.title ?? readString(params, 'title');

  const [host, setHost] = useState<Element | null>(() => document.querySelector('.player'));
  const [video, setVideo] = useState<HTMLVideoElement | null>(() => pickVideo(props));
  const [letterbox, setLetterbox] = useState<Letterbox>(() => letterboxOf(pickVideo(props)));
  const [mediaPaused, setMediaPaused] = useState(true);
  const [mediaBuffering, setMediaBuffering] = useState(true);
  const [src, setSrc] = useState(() =>
    resolveAmbientSrc({
      src: props.src,
      poster: props.poster,
      backdrop: props.backdrop,
      id,
      title,
      params,
      videoPoster: pickVideo(props)?.poster,
    }),
  );
  const [failed, setFailed] = useState(false);
  const [reducedTransparency, setReducedTransparency] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-transparency: reduce)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-transparency: reduce)');
    const sync = (): void => setReducedTransparency(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const assign = (node: HTMLVideoElement | null): void => {
      setVideo((current) => (current === node ? current : node));
    };
    const found = pickVideo(props);
    if (found !== null) {
      assign(found);
      return;
    }
    const root = document.querySelector('.player');
    if (root === null) return;
    const observer = new MutationObserver(() => {
      const next = pickVideo(props);
      if (next !== null) {
        assign(next);
        observer.disconnect();
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [props.video, props.videoRef]);

  useEffect(() => {
    const node = video?.closest('.player') ?? document.querySelector('.player');
    setHost(node);
  }, [video]);

  useEffect(() => {
    if (video === null) return;
    const measure = (): void => setLetterbox(letterboxOf(video));
    const syncState = (): void => {
      const player = video.closest('.player');
      const native = player?.classList.contains('player--native') === true;
      const busy = player?.classList.contains('player--busy') === true;
      if (native) {
        setMediaPaused(busy);
        setMediaBuffering(busy);
      } else {
        setMediaPaused(video.paused || video.ended);
        setMediaBuffering(busy || (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA && !video.paused));
      }
      measure();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(video);
    video.addEventListener('loadedmetadata', measure);
    video.addEventListener('resize', measure);
    video.addEventListener('play', syncState);
    video.addEventListener('playing', syncState);
    video.addEventListener('pause', syncState);
    video.addEventListener('waiting', syncState);
    video.addEventListener('emptied', syncState);
    video.addEventListener('ended', syncState);
    video.addEventListener('canplay', syncState);
    syncState();
    return () => {
      observer.disconnect();
      video.removeEventListener('loadedmetadata', measure);
      video.removeEventListener('resize', measure);
      video.removeEventListener('play', syncState);
      video.removeEventListener('playing', syncState);
      video.removeEventListener('pause', syncState);
      video.removeEventListener('waiting', syncState);
      video.removeEventListener('emptied', syncState);
      video.removeEventListener('ended', syncState);
      video.removeEventListener('canplay', syncState);
    };
  }, [video]);

  useEffect(() => {
    const next = resolveAmbientSrc({
      src: props.src,
      poster: props.poster,
      backdrop: props.backdrop,
      id,
      title,
      params,
      videoPoster: video?.poster,
    });
    setSrc((current) => (current === next ? current : next));
    if (next !== '' || id === '' || id.startsWith('live:')) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      const root = mediaRootId(id);
      const item = (await fetchMedia(id)) ?? (root !== id && root !== '' ? await fetchMedia(root) : null);
      if (cancelled || item === null) return;
      const work = asTitle(item);
      const resolved = softenArtUrl(preferBackdrop(work.id, work.backdrop, work.poster));
      if (resolved !== '') setSrc(resolved);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, params, props.backdrop, props.poster, props.src, title, video?.poster]);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const paused =
    props.paused ??
    (props.error !== undefined && props.error !== null && props.error !== ''
      ? true
      : props.playing === true
        ? false
        : mediaPaused);
  const buffering =
    props.buffering !== undefined || props.busy !== undefined
      ? props.buffering === true || props.busy === true
      : mediaBuffering;
  const mode = ambientMode({
    hasImage: src !== '' && !failed,
    paused,
    buffering,
    letterbox,
    reducedTransparency,
  });
  const mask = useMemo(() => layerMask(letterbox, mode), [letterbox, mode]);

  if (src === '' || reducedTransparency || host === null) return null;

  const classes = ['player-ambient', props.className].filter(Boolean).join(' ');

  return createPortal(
    <div className={classes} data-ambient={mode} aria-hidden="true">
      <style>{STYLES}</style>
      <div className="player-ambient__layer" style={mask}>
        <img
          className="player-ambient__glow"
          src={src}
          alt=""
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
        <span className="player-ambient__veil" />
        <span className="player-ambient__grain" />
      </div>
    </div>,
    host,
  );
}

export default AmbientBackdrop;
