import { useCallback, useEffect, useMemo, useState } from 'react';
import Hls from 'hls.js';
import { FocusButton } from '../../components/FocusButton';
import { requestFocus } from '../../nav/focusEngine';
import { useScopedFocusKey } from '../../nav/ViewStackContext';
import { usePlayerSession } from '../PlayerRoot';

export const AUDIO_FOCUS_ID = 'player-audio';
export const AUDIO_TRACK_FOCUS_PREFIX = 'player-audio-track-';

export function audioTrackFocusId(index: number): string {
  return `${AUDIO_TRACK_FOCUS_PREFIX}${index}`;
}

/** HLS.js audio surface already attached to the playing source. */
export interface HlsAudioApi {
  audioTracks: ReadonlyArray<{
    id?: number;
    name?: string;
    lang?: string;
    language?: string;
    default?: boolean;
  }>;
  audioTrack: number;
  media?: HTMLMediaElement | null;
  on?(event: string, handler: () => void): void;
  off?(event: string, handler: () => void): void;
}

export interface AudioPickerProps {
  video?: HTMLVideoElement | null;
  videoRef?: { readonly current: HTMLVideoElement | null };
  /** Existing HLS.js instance for this playback — never a new loader. */
  hls?: HlsAudioApi | null;
  engine?: 'loading' | 'html5' | 'native';
  controlsVisible?: boolean;
  showControls?: () => void;
  className?: string;
}

export type AudioTrackSource = 'audioTracks' | 'hls';

export interface ListedAudio {
  id: string;
  index: number;
  label: string;
  language: string;
  source: AudioTrackSource;
  selected: boolean;
}

const HLS_TRACK_EVENTS = ['hlsAudioTracksUpdated', 'hlsAudioTrackSwitched'] as const;
const hlsByMedia = new WeakMap<HTMLMediaElement, HlsAudioApi>();

interface HtmlAudioTrack {
  id: string;
  kind: string;
  label: string;
  language: string;
  enabled: boolean;
}

interface HtmlAudioTrackList extends EventTarget {
  readonly length: number;
  [index: number]: HtmlAudioTrack;
}

type TaggedMedia = HTMLMediaElement & { hls?: HlsAudioApi; _hls?: HlsAudioApi };

function isHlsAudioApi(value: unknown): value is HlsAudioApi {
  if (typeof value !== 'object' || value === null) return false;
  const host = value as HlsAudioApi;
  return Array.isArray(host.audioTracks) && typeof host.audioTrack === 'number';
}

function tagHls(hls: HlsAudioApi, media: HTMLMediaElement): void {
  hlsByMedia.set(media, hls);
  (media as TaggedMedia).hls = hls;
}

function installHlsBridge(): void {
  const proto = Hls.prototype as typeof Hls.prototype & { __tvmAudioPicker?: boolean };
  if (proto.__tvmAudioPicker === true) return;
  proto.__tvmAudioPicker = true;
  const attach = proto.attachMedia;
  proto.attachMedia = function (this: Hls, media: HTMLMediaElement) {
    tagHls(this as unknown as HlsAudioApi, media);
    return attach.call(this, media);
  };
  const detach = proto.detachMedia;
  proto.detachMedia = function (this: Hls) {
    const media = this.media;
    if (media !== null) {
      const tagged = media as TaggedMedia;
      if (tagged.hls === (this as unknown as HlsAudioApi)) delete tagged.hls;
      hlsByMedia.delete(media);
    }
    return detach.call(this);
  };
}

installHlsBridge();

export function resolveHls(video: HTMLVideoElement | null, explicit?: HlsAudioApi | null): HlsAudioApi | null {
  if (explicit !== undefined && explicit !== null) return explicit;
  if (video === null) return null;
  const tagged = video as TaggedMedia;
  if (isHlsAudioApi(tagged.hls)) return tagged.hls;
  if (isHlsAudioApi(tagged._hls)) return tagged._hls;
  return hlsByMedia.get(video) ?? null;
}

function resolveVideo(props: AudioPickerProps): HTMLVideoElement | null {
  if (props.video !== undefined && props.video !== null) return props.video;
  if (props.videoRef?.current !== undefined && props.videoRef.current !== null) return props.videoRef.current;
  return document.querySelector('.player__video, .player video');
}

function htmlAudioList(video: HTMLVideoElement | null): HtmlAudioTrackList | null {
  if (video === null) return null;
  const list = (video as HTMLVideoElement & { audioTracks?: HtmlAudioTrackList }).audioTracks;
  return list === undefined ? null : list;
}

function languageName(code: string): string {
  const trimmed = code.trim();
  if (trimmed === '') return '';
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(trimmed) ?? trimmed;
  } catch {
    return trimmed;
  }
}

function displayLabel(name: string, language: string, index: number): string {
  if (name.trim() !== '') return name.trim();
  const named = languageName(language);
  if (named !== '') return named;
  return `Audio ${index + 1}`;
}

function hlsTrackId(track: HlsAudioApi['audioTracks'][number], index: number): number {
  return typeof track.id === 'number' ? track.id : index;
}

function collectHlsTracks(hls: HlsAudioApi | null): ListedAudio[] {
  if (hls === null || hls.audioTracks.length === 0) return [];
  const selected = hls.audioTrack;
  return hls.audioTracks.map((track, index) => {
    const language = track.lang ?? track.language ?? '';
    const id = hlsTrackId(track, index);
    return {
      id: `hls:${id}`,
      index,
      label: displayLabel(track.name ?? '', language, index),
      language,
      source: 'hls' as const,
      selected: selected === id,
    };
  });
}

function collectHtmlTracks(video: HTMLVideoElement | null): ListedAudio[] {
  const list = htmlAudioList(video);
  if (list === null || list.length === 0) return [];
  const rows: ListedAudio[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const track = list[index];
    if (track === undefined) continue;
    rows.push({
      id: `html:${track.id || String(index)}`,
      index,
      label: displayLabel(track.label, track.language, index),
      language: track.language,
      source: 'audioTracks',
      selected: track.enabled,
    });
  }
  return rows;
}

/**
 * Tracks already on the playing source. HLS alternate-audio groups win when
 * they have a real choice; otherwise `video.audioTracks`. Never invents URLs.
 */
export function listAudioTracks(video: HTMLVideoElement | null, hls?: HlsAudioApi | null): ListedAudio[] {
  const hlsRows = collectHlsTracks(hls ?? null);
  if (hlsRows.length >= 2) return hlsRows;
  const htmlRows = collectHtmlTracks(video);
  if (htmlRows.length >= 2) return htmlRows;
  return hlsRows.length > 0 ? hlsRows : htmlRows;
}

function applyAudioTrack(video: HTMLVideoElement | null, hls: HlsAudioApi | null, row: ListedAudio): void {
  if (row.source === 'hls' && hls !== null) {
    const id = Number(row.id.slice(4));
    if (Number.isFinite(id)) hls.audioTrack = id;
    return;
  }
  const list = htmlAudioList(video);
  if (list === null) return;
  for (let index = 0; index < list.length; index += 1) {
    const track = list[index];
    if (track !== undefined) track.enabled = index === row.index;
  }
}

function scopedId(scopeKey: string, id: string): string {
  const slash = scopeKey.lastIndexOf('/');
  if (slash < 0) return id;
  return `${scopeKey.slice(0, slash + 1)}${id}`;
}

function AudioGlyph(): React.JSX.Element {
  return (
    <svg className="player-audio__glyph" viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M6 13h4l6-5v16l-6-5H6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M20 12.5a5 5 0 0 1 0 7M23 10a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Focusable audio-track picker. Hidden unless the current source already
 * exposes two or more tracks (`video.audioTracks` or HLS.js `audioTracks`).
 * Switching uses those existing groups only — no extra audio URLs.
 */
export function AudioPicker(props: AudioPickerProps): React.JSX.Element | null {
  const session = usePlayerSession();
  const videoRef = props.videoRef ?? session?.videoRef;
  const engine = props.engine ?? session?.engine;
  const controlsVisible = props.controlsVisible ?? session?.controlsVisible;
  const showControls = props.showControls ?? session?.showControls;
  const lookup: AudioPickerProps = { video: props.video, videoRef, hls: props.hls };

  const [video, setVideo] = useState<HTMLVideoElement | null>(() => resolveVideo(lookup));
  const [hls, setHls] = useState<HlsAudioApi | null>(() => resolveHls(resolveVideo(lookup), props.hls));
  const [generation, setGeneration] = useState(0);
  const [open, setOpen] = useState(false);
  const toggleKey = useScopedFocusKey(AUDIO_FOCUS_ID);

  const listed = useMemo(() => listAudioTracks(video, hls), [generation, hls, video]);
  const active = listed.find((row) => row.selected) ?? listed[0] ?? null;
  const chromeOn = open || controlsVisible !== false;

  const refresh = useCallback((): void => {
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    const sync = (): void => {
      const nextVideo = resolveVideo({ video: props.video, videoRef, hls: props.hls });
      const nextHls = resolveHls(nextVideo, props.hls);
      setVideo((current) => (current === nextVideo ? current : nextVideo));
      setHls((current) => (current === nextHls ? current : nextHls));
    };
    sync();
    const timer = window.setInterval(sync, 750);
    return () => window.clearInterval(timer);
  }, [props.hls, props.video, videoRef]);

  useEffect(() => {
    const list = htmlAudioList(video);
    if (video === null && list === null) return;
    const onChange = (): void => refresh();
    list?.addEventListener('addtrack', onChange);
    list?.addEventListener('removetrack', onChange);
    list?.addEventListener('change', onChange);
    video?.addEventListener('loadedmetadata', onChange);
    return () => {
      list?.removeEventListener('addtrack', onChange);
      list?.removeEventListener('removetrack', onChange);
      list?.removeEventListener('change', onChange);
      video?.removeEventListener('loadedmetadata', onChange);
    };
  }, [refresh, video]);

  useEffect(() => {
    if (hls === null || typeof hls.on !== 'function') return;
    const onChange = (): void => refresh();
    for (const event of HLS_TRACK_EVENTS) hls.on(event, onChange);
    return () => {
      if (typeof hls.off !== 'function') return;
      for (const event of HLS_TRACK_EVENTS) hls.off(event, onChange);
    };
  }, [hls, refresh]);

  const closeMenu = useCallback((): void => {
    setOpen(false);
    requestFocus(toggleKey);
  }, [toggleKey]);

  const openMenu = useCallback((): void => {
    setOpen(true);
    showControls?.();
    window.dispatchEvent(new CustomEvent('tvm:user-activity'));
  }, [showControls]);

  useEffect(() => {
    if (!open) return;
    const selected = listed.find((row) => row.selected) ?? listed[0];
    if (selected === undefined) return;
    const next = scopedId(toggleKey, audioTrackFocusId(selected.index));
    window.requestAnimationFrame(() => requestFocus(next));
  }, [listed, open, toggleKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' && event.key !== 'Backspace' && event.key !== 'BrowserBack' && event.key !== 'GoBack') {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMenu();
    };
    const onClick = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-focus-id="player-back"], [data-focus-id="close"]') === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMenu();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [closeMenu, open]);

  const pick = useCallback(
    (row: ListedAudio): void => {
      applyAudioTrack(video, hls, row);
      refresh();
      showControls?.();
      closeMenu();
    },
    [closeMenu, hls, refresh, showControls, video],
  );

  const onMenuArrow = useCallback(
    (direction: string): boolean => {
      if (direction === 'left' || direction === 'right') {
        closeMenu();
        return false;
      }
      return true;
    },
    [closeMenu],
  );

  if (engine === 'native') return null;
  if (listed.length < 2) return null;

  const classes = ['player-audio', props.className].filter(Boolean).join(' ');
  const currentLabel = active?.label ?? 'Audio';

  return (
    <div
      className={classes}
      data-open={open ? 'true' : undefined}
      data-picker-open={open ? 'true' : undefined}
      data-chrome={chromeOn ? 'on' : 'off'}
    >
      <style>{PICKER_CSS}</style>
      <FocusButton
        id={AUDIO_FOCUS_ID}
        className="player-audio__toggle"
        detail={currentLabel}
        onSelect={() => (open ? closeMenu() : openMenu())}
      >
        <span className="player-audio__face">
          <AudioGlyph />
          <span className="player-audio__word">Audio</span>
        </span>
      </FocusButton>
      {open ? (
        <div
          className="player-audio__menu"
          role="listbox"
          aria-label="Audio tracks"
          data-player-menu="audio"
          data-wrap="y"
        >
          <p className="player-audio__heading">Audio</p>
          {listed.map((row) => (
            <FocusButton
              key={row.id}
              id={audioTrackFocusId(row.index)}
              className={`player-audio__row${row.selected ? ' player-audio__row--on' : ''}`}
              detail={row.selected ? 'On' : row.language !== '' ? row.language : undefined}
              onSelect={() => pick(row)}
              onArrowPress={onMenuArrow}
            >
              {row.label}
            </FocusButton>
          ))}
        </div>
      ) : null}
      <span className="player-audio__live" aria-live="polite">
        {currentLabel}
      </span>
    </div>
  );
}

const PICKER_CSS = `
.player-audio {
  position: relative;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  pointer-events: auto;
  opacity: 1;
  transition: opacity var(--tvm-motion-base, 200ms) var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
}
.player-audio[data-chrome='off'] {
  opacity: 0;
  pointer-events: none;
}
.player-audio__toggle {
  min-width: 2.7rem;
  min-height: 2.7rem;
  padding: 0.3rem 0.7rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--tvm-surface-glass, rgba(28, 28, 28, 0.78)) 82%, transparent);
  color: var(--tvm-text, #f5f5f5);
}
.player-audio__face {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
}
.player-audio__glyph {
  width: 1.25rem;
  height: 1.25rem;
}
.player-audio__word {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.player-audio__menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 0.55rem);
  z-index: 7;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 16.5rem;
  max-height: min(22rem, 52vh);
  padding: 0.7rem;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--tvm-text, #fff) 18%, transparent);
  border-radius: 0.7rem;
  background: color-mix(in srgb, var(--tvm-surface-glass, #0b0b0b) 88%, transparent);
  box-shadow: 0 0.8rem 2rem rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(16px);
}
.player-audio__heading {
  margin: 0 0.2rem 0.15rem;
  color: color-mix(in srgb, var(--tvm-text, #fff) 72%, transparent);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.player-audio__row {
  width: 100%;
  min-height: 2.7rem;
  justify-content: space-between;
  border-radius: 0.5rem;
}
.player-audio__row--on {
  box-shadow: inset 0 0 0 0.1rem var(--tvm-text, #fff);
}
.player-audio__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
`;

export default AudioPicker;
