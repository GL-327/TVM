import { useCallback, useEffect, useMemo, useState } from 'react';
import { FocusButton } from '../../components/FocusButton';
import { requestFocus } from '../../nav/focusEngine';
import { useFocusScope, useScopedFocusKey } from '../../nav/ViewStackContext';

/** Same shape as core `PlaybackResolution.subtitles` — never scraped or invented. */
export interface AppSubtitle {
  url: string;
  language: string;
  label: string;
}

export interface HlsSubtitleApi {
  subtitleTracks?: ReadonlyArray<{
    id?: number;
    name?: string;
    lang?: string;
    language?: string;
  }>;
  subtitleTrack: number;
  on?(event: string, handler: () => void): void;
  off?(event: string, handler: () => void): void;
}

export interface SubtitlePickerProps {
  video?: HTMLVideoElement | null;
  videoRef?: { readonly current: HTMLVideoElement | null };
  /** Existing app subtitle sidecar list from playback. */
  subtitles?: ReadonlyArray<Partial<AppSubtitle>>;
  stream?: { subtitles?: ReadonlyArray<Partial<AppSubtitle>> } | null;
  /** Optional HLS.js instance already attached to this video. */
  hls?: HlsSubtitleApi | null;
  className?: string;
}

export type SubtitleTrackSource = 'textTracks' | 'hls' | 'app';

export interface ListedSubtitle {
  id: string;
  label: string;
  language: string;
  kind: 'subtitles' | 'captions';
  source: SubtitleTrackSource;
  selected: boolean;
}

const TEXT_KINDS = new Set<TextTrackKind>(['subtitles', 'captions']);
const HLS_TRACK_EVENTS = ['hlsSubtitleTracksUpdated', 'hlsSubtitleTrackSwitch'] as const;

function isSafeSubtitleUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'blob:' || parsed.protocol === 'data:';
  } catch {
    return false;
  }
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

function displayLabel(label: string, language: string, kind: 'subtitles' | 'captions', index: number): string {
  if (label.trim() !== '') return label.trim();
  const named = languageName(language);
  if (named !== '') return named;
  return kind === 'captions' ? `Captions ${index + 1}` : `Subtitles ${index + 1}`;
}

function trackKey(language: string, label: string): string {
  return `${language.trim().toLowerCase()}|${label.trim().toLowerCase()}`;
}

export function readAppSubtitles(
  input: Pick<SubtitlePickerProps, 'subtitles' | 'stream'> | null | undefined,
): AppSubtitle[] {
  const raw = input?.subtitles ?? input?.stream?.subtitles ?? [];
  const out: AppSubtitle[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (url === '' || !isSafeSubtitleUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const language = typeof item.language === 'string' ? item.language : '';
    const label = typeof item.label === 'string' ? item.label : '';
    out.push({ url, language, label });
  }
  return out;
}

/** Attach playback sidecar files as native `<track>` elements. No network of our own. */
export function attachAppSubtitleTracks(video: HTMLVideoElement, subtitles: readonly AppSubtitle[]): void {
  for (const sub of subtitles) {
    const already = [...video.querySelectorAll('track')].some((node) => node.dataset.tvmSub === sub.url);
    if (already) continue;
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.src = sub.url;
    if (sub.language !== '') track.srclang = sub.language;
    track.label = sub.label !== '' ? sub.label : languageName(sub.language) || 'Subtitles';
    track.dataset.tvmSub = sub.url;
    video.appendChild(track);
  }
}

function collectTextTracks(video: HTMLVideoElement | null): TextTrack[] {
  if (video === null) return [];
  const list: TextTrack[] = [];
  const tracks = video.textTracks;
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    if (track !== undefined && TEXT_KINDS.has(track.kind)) list.push(track);
  }
  return list;
}

function textTrackSource(video: HTMLVideoElement, track: TextTrack): SubtitleTrackSource {
  for (const node of video.querySelectorAll('track')) {
    if (node.dataset.tvmSub === undefined) continue;
    if (node.label === track.label || (track.language !== '' && node.srclang === track.language)) return 'app';
  }
  return 'textTracks';
}

function collectHlsTracks(hls: HlsSubtitleApi | null | undefined): ListedSubtitle[] {
  if (hls === null || hls === undefined) return [];
  const rows = hls.subtitleTracks;
  if (rows === undefined || rows.length === 0) return [];
  const selected = typeof hls.subtitleTrack === 'number' ? hls.subtitleTrack : -1;
  return rows.map((row, index) => {
    const language = row.lang ?? row.language ?? '';
    const label = displayLabel(row.name ?? '', language, 'subtitles', index);
    return {
      id: `hls:${index}`,
      label,
      language,
      kind: 'subtitles' as const,
      source: 'hls' as const,
      selected: selected === index,
    };
  });
}

/**
 * Tracks the picker will show, in order:
 * 1. HLS.js `subtitleTracks` when an instance is passed in
 * 2. `video.textTracks` of kind `subtitles` or `captions` that are not already in that HLS list
 *
 * With no HLS list, only textTracks are shown. Playback `subtitles[]` URLs are
 * attached as `<track>` elements first, then appear as textTracks. Off is a
 * separate row, not a listed track.
 */
export function listSubtitleTracks(
  video: HTMLVideoElement | null,
  hls?: HlsSubtitleApi | null,
): ListedSubtitle[] {
  const textRows: ListedSubtitle[] = collectTextTracks(video).map((track, index) => {
    const kind: ListedSubtitle['kind'] = track.kind === 'captions' ? 'captions' : 'subtitles';
    const source: SubtitleTrackSource = video !== null ? textTrackSource(video, track) : 'textTracks';
    return {
      id: `text:${index}`,
      label: displayLabel(track.label, track.language, kind, index),
      language: track.language,
      kind,
      source,
      selected: track.mode === 'showing',
    };
  });

  const hlsRows = collectHlsTracks(hls);
  if (hlsRows.length === 0) return textRows;

  const used = new Set(hlsRows.map((row) => trackKey(row.language, row.label)));
  const extras = textRows.filter((row) => !used.has(trackKey(row.language, row.label)));
  if (hlsRows.some((row) => row.selected)) {
    for (const extra of extras) extra.selected = false;
  }
  return [...hlsRows, ...extras];
}

function resolveVideo(props: SubtitlePickerProps): HTMLVideoElement | null {
  if (props.video !== undefined && props.video !== null) return props.video;
  if (props.videoRef?.current !== undefined && props.videoRef.current !== null) return props.videoRef.current;
  return document.querySelector('.player__video, .player video');
}

function applySelection(
  video: HTMLVideoElement | null,
  hls: HlsSubtitleApi | null | undefined,
  selectedId: string | null,
): void {
  const hlsPick = selectedId?.startsWith('hls:') === true;
  if (hls !== null && hls !== undefined && Array.isArray(hls.subtitleTracks)) {
    hls.subtitleTrack = hlsPick && selectedId !== null ? Number(selectedId.slice(4)) : -1;
  }
  if (hlsPick) return;
  const tracks = collectTextTracks(video);
  if (selectedId === null) {
    for (const track of tracks) track.mode = 'disabled';
    return;
  }
  const index = selectedId.startsWith('text:') ? Number(selectedId.slice(5)) : -1;
  tracks.forEach((track, current) => {
    track.mode = current === index ? 'showing' : 'disabled';
  });
}

function CcGlyph(): React.JSX.Element {
  return (
    <svg className="player-cc__glyph" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="8" width="26" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M10.2 19.2c-1.8 0-2.9-1.3-2.9-3.2s1.1-3.2 2.9-3.2c1 0 1.7.4 2.2 1l-1.1.9c-.3-.3-.7-.6-1.1-.6-.8 0-1.3.7-1.3 1.9s.5 1.9 1.3 1.9c.5 0 .9-.2 1.2-.6l1.1.8c-.6.8-1.4 1.1-2.3 1.1Zm8.6 0c-1.8 0-2.9-1.3-2.9-3.2s1.1-3.2 2.9-3.2c1 0 1.7.4 2.2 1l-1.1.9c-.3-.3-.7-.6-1.1-.6-.8 0-1.3.7-1.3 1.9s.5 1.9 1.3 1.9c.5 0 .9-.2 1.2-.6l1.1.8c-.6.8-1.4 1.1-2.3 1.1Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Focusable CC control. Hidden unless the current video already has caption
 * or subtitle tracks (in-band, `<track>`, playback `subtitles`, or HLS).
 */
export function SubtitlePicker(props: SubtitlePickerProps): React.JSX.Element | null {
  const [video, setVideo] = useState<HTMLVideoElement | null>(() => resolveVideo(props));
  const [generation, setGeneration] = useState(0);
  const [open, setOpen] = useState(false);
  const scope = useFocusScope();
  const toggleKey = useScopedFocusKey('player-cc');

  const appSubs = useMemo(() => readAppSubtitles(props), [props.stream, props.subtitles]);
  const listed = useMemo(
    () => listSubtitleTracks(video, props.hls),
    [generation, props.hls, video],
  );
  const active = listed.find((row) => row.selected) ?? null;

  const refresh = useCallback((): void => {
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    const sync = (): void => {
      const next = resolveVideo(props);
      setVideo((current) => (current === next ? current : next));
    };
    sync();
    const timer = window.setInterval(sync, 750);
    return () => window.clearInterval(timer);
  }, [props.video, props.videoRef]);

  useEffect(() => {
    if (video === null) return;
    attachAppSubtitleTracks(video, appSubs);
    refresh();
  }, [appSubs, refresh, video]);

  useEffect(() => {
    if (video === null) return;
    const tracks = video.textTracks;
    tracks.addEventListener('addtrack', refresh);
    tracks.addEventListener('removetrack', refresh);
    tracks.addEventListener('change', refresh);
    video.addEventListener('loadedmetadata', refresh);
    return () => {
      tracks.removeEventListener('addtrack', refresh);
      tracks.removeEventListener('removetrack', refresh);
      tracks.removeEventListener('change', refresh);
      video.removeEventListener('loadedmetadata', refresh);
    };
  }, [refresh, video]);

  useEffect(() => {
    const hls = props.hls;
    if (hls === null || hls === undefined || typeof hls.on !== 'function') return;
    for (const event of HLS_TRACK_EVENTS) hls.on(event, refresh);
    return () => {
      if (typeof hls.off !== 'function') return;
      for (const event of HLS_TRACK_EVENTS) hls.off(event, refresh);
    };
  }, [props.hls, refresh]);

  const closeMenu = useCallback((): void => {
    setOpen(false);
    requestFocus(toggleKey);
  }, [toggleKey]);

  const openMenu = useCallback((): void => {
    setOpen(true);
    window.dispatchEvent(new CustomEvent('tvm:user-activity'));
  }, []);

  useEffect(() => {
    if (!open) return;
    const selected = listSubtitleTracks(video, props.hls).find((row) => row.selected);
    const id = selected === undefined ? 'player-cc-off' : `player-cc-${selected.id.replace(':', '-')}`;
    window.requestAnimationFrame(() => requestFocus(`${scope}/${id}`));
  }, [open, props.hls, scope, video]);

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
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [closeMenu, open]);

  useEffect(() => {
    if (listed.length === 0) return;
    const onIntent = (raw: Event): void => {
      if ((raw as CustomEvent<string>).detail !== 'info') return;
      setOpen((current) => {
        const next = !current;
        if (next) window.dispatchEvent(new CustomEvent('tvm:user-activity'));
        return next;
      });
    };
    window.addEventListener('tvm:media-intent', onIntent);
    return () => window.removeEventListener('tvm:media-intent', onIntent);
  }, [listed.length]);

  const pick = useCallback(
    (id: string | null): void => {
      applySelection(video, props.hls, id);
      refresh();
      closeMenu();
    },
    [closeMenu, props.hls, refresh, video],
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

  if (listed.length === 0) return null;

  const classes = ['player-cc', props.className].filter(Boolean).join(' ');
  const currentLabel = active?.label ?? 'Off';

  return (
    <div className={classes} data-open={open ? 'true' : undefined} data-on={active !== null ? 'true' : undefined}>
      <style>{PICKER_CSS}</style>
      <FocusButton
        id="player-cc"
        className="player-cc__toggle"
        onSelect={() => (open ? closeMenu() : openMenu())}
      >
        <span className="player-cc__face">
          <CcGlyph />
          <span className="player-cc__word">CC</span>
        </span>
      </FocusButton>
      {open ? (
        <div className="player-cc__menu" role="listbox" aria-label="Subtitles" data-wrap="y">
          <p className="player-cc__heading">Subtitles</p>
          <FocusButton
            id="player-cc-off"
            className={`player-cc__row${active === null ? ' player-cc__row--on' : ''}`}
            detail={active === null ? 'On' : undefined}
            onSelect={() => pick(null)}
            onArrowPress={onMenuArrow}
          >
            Off
          </FocusButton>
          {listed.map((row) => (
            <FocusButton
              key={row.id}
              id={`player-cc-${row.id.replace(':', '-')}`}
              className={`player-cc__row${row.selected ? ' player-cc__row--on' : ''}`}
              detail={row.kind === 'captions' ? 'CC' : row.language !== '' ? row.language : undefined}
              onSelect={() => pick(row.id)}
              onArrowPress={onMenuArrow}
            >
              {row.label}
            </FocusButton>
          ))}
        </div>
      ) : null}
      <span className="player-cc__live" aria-live="polite">
        {currentLabel}
      </span>
    </div>
  );
}

const PICKER_CSS = `
.player-cc {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.player-cc__toggle {
  min-width: 2.7rem;
  min-height: 2.7rem;
  padding: 0.3rem 0.55rem;
  border-radius: 0.5rem;
}
.player-cc__face {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
}
.player-cc__glyph {
  width: 1.35rem;
  height: 1.35rem;
}
.player-cc__word {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.player-cc[data-on='true'] .player-cc__toggle {
  box-shadow: inset 0 0 0 0.1rem color-mix(in srgb, #fff, transparent 35%);
}
.player-cc__menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 0.55rem);
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 16.5rem;
  max-height: min(22rem, 52vh);
  padding: 0.7rem;
  overflow: auto;
  border: 1px solid color-mix(in srgb, #fff, transparent 82%);
  border-radius: 0.7rem;
  background: color-mix(in srgb, #0b0b0b, transparent 12%);
  box-shadow: 0 0.8rem 2rem rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(16px);
}
.player-cc__heading {
  margin: 0 0.2rem 0.15rem;
  color: color-mix(in srgb, #fff, transparent 28%);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.player-cc__row {
  width: 100%;
  min-height: 2.7rem;
  justify-content: space-between;
  border-radius: 0.5rem;
}
.player-cc__row--on {
  box-shadow: inset 0 0 0 0.1rem #fff;
}
.player-cc__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
`;

export default SubtitlePicker;
