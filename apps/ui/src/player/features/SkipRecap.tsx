import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { FocusButton } from '../../components/FocusButton';
import { requestFocus } from '../../nav/focusEngine';
import { useScopedFocusKey } from '../../nav/ViewStackContext';
import { usePlayerSession, type PlayerSession } from '../PlayerRoot';
import { isLivePlayback } from './LiveOverlay';
import './SkipRecap.css';

export const SKIP_RECAP_FOCUS_ID = 'player-skip-recap';
export const SKIP_RECAP_SLOT = '[data-slot="skip-recap"]';

/** Recap window used by the existing Player chrome when no richer marker is attached. */
export const DEFAULT_RECAP_END_SECONDS = 90;

export interface RecapMetadata {
  start: number;
  end: number;
  label?: string;
}

export type RecapLike =
  | RecapMetadata
  | number
  | string
  | boolean
  | Record<string, unknown>
  | null
  | undefined;

export type SkipRecapProps = Partial<PlayerSession> & {
  recap?: RecapLike;
  recapEnd?: number;
  recapStart?: number;
  markers?: unknown;
  chapters?: unknown;
};

const RECAP_KEYS = ['recap', 'skipRecap', 'skip_recap', 'recapMarker', 'intro'] as const;
const END_KEYS = ['end', 'endSeconds', 'endAt', 'to', 'recapEnd', 'skipTo'] as const;
const START_KEYS = ['start', 'startSeconds', 'startAt', 'from', 'recapStart'] as const;

function asSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    if (parts.length > 3 || parts.some((part) => part === '' || Number.isNaN(Number(part)))) return null;
    return parts.reduce((sum, part) => sum * 60 + Number(part), 0);
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function pickSeconds(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const seconds = asSeconds(record[key]);
    if (seconds !== null) return seconds;
  }
  return null;
}

function isRecapKind(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const kind = value.toLowerCase();
  return kind === 'recap' || kind === 'skip_recap' || kind === 'skip-recap' || kind === 'previously';
}

export function parseRecapMetadata(raw: RecapLike): RecapMetadata | null {
  if (raw == null || raw === false) return null;
  if (raw === true) return null;
  if (typeof raw === 'number' || typeof raw === 'string') {
    const end = asSeconds(raw);
    return end !== null && end > 0 ? { start: 0, end } : null;
  }
  if (typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  for (const key of RECAP_KEYS) {
    if (!(key in record)) continue;
    const nested = record[key];
    if (nested === raw) continue;
    const parsed = parseRecapMetadata(nested as RecapLike);
    if (parsed !== null) return parsed;
  }

  const collections = [record.markers, record.skipMarkers, record.chapters];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const marker of collection) {
      if (typeof marker !== 'object' || marker === null) continue;
      const item = marker as Record<string, unknown>;
      if (!isRecapKind(item.type ?? item.kind ?? item.label)) continue;
      const parsed = parseRecapMetadata(item);
      if (parsed !== null) return parsed;
    }
  }

  const end = pickSeconds(record, END_KEYS);
  if (end === null || end <= 0) return null;
  const start = pickSeconds(record, START_KEYS) ?? 0;
  if (start >= end) return null;
  return {
    start,
    end,
    ...(typeof record.label === 'string' ? { label: record.label } : {}),
  };
}

function findPlayerVideo(videoRef?: RefObject<HTMLVideoElement | null>): HTMLVideoElement | null {
  if (videoRef?.current instanceof HTMLVideoElement) return videoRef.current;
  return document.querySelector<HTMLVideoElement>('video.player__video, .player video, video');
}

function findPlayerHost(video: HTMLVideoElement | null): HTMLElement | null {
  return (
    video?.closest<HTMLElement>('.player, [data-player-root], [data-player]') ??
    document.querySelector<HTMLElement>('.player, [data-player-root]')
  );
}

function recapFromDataset(el: Element | null): RecapMetadata | null {
  if (!(el instanceof HTMLElement)) return null;
  const json = el.getAttribute('data-recap') ?? el.dataset.recap;
  if (json !== undefined && json !== '') {
    try {
      const parsed = parseRecapMetadata(JSON.parse(json) as RecapLike);
      if (parsed !== null) return parsed;
    } catch {
      // Attribute may be a bare end time.
    }
  }
  const end = asSeconds(el.getAttribute('data-recap-end') ?? el.dataset.recapEnd);
  if (end === null || end <= 0) return null;
  const start = asSeconds(el.getAttribute('data-recap-start') ?? el.dataset.recapStart) ?? 0;
  if (start >= end) return null;
  return { start, end };
}

function recapFromChapterTracks(video: HTMLVideoElement | null): RecapMetadata | null {
  if (video === null) return null;
  for (const track of video.textTracks) {
    if (track.kind !== 'chapters' && track.kind !== 'metadata') continue;
    const cues = track.cues;
    if (cues === null) continue;
    for (let i = 0; i < cues.length; i += 1) {
      const cue = cues[i];
      if (cue === undefined) continue;
      const text = cue instanceof VTTCue ? cue.text : '';
      if (!isRecapKind(text) && !/recap|previously/i.test(text)) continue;
      if (cue.endTime > cue.startTime) return { start: cue.startTime, end: cue.endTime };
    }
  }
  return null;
}

export function resolveRecapMetadata(source: SkipRecapProps, video?: HTMLVideoElement | null): RecapMetadata | null {
  if (source.live === true || (typeof source.mediaId === 'string' && isLivePlayback(source.mediaId))) return null;

  const explicit =
    parseRecapMetadata(source.recap) ??
    (source.recapEnd !== undefined ? parseRecapMetadata({ start: source.recapStart ?? 0, end: source.recapEnd }) : null) ??
    parseRecapMetadata(source.markers as RecapLike) ??
    parseRecapMetadata(source.chapters as RecapLike) ??
    recapFromDataset(video ?? null) ??
    recapFromDataset(findPlayerHost(video ?? null)) ??
    recapFromChapterTracks(video ?? null);

  if (explicit !== null) return source.skipRecap === false ? null : explicit;
  if (source.skipRecap === true) return { start: 0, end: DEFAULT_RECAP_END_SECONDS };
  return null;
}

export function isRecapWindow(position: number, recap: RecapMetadata): boolean {
  if (!Number.isFinite(position)) return false;
  return position >= recap.start - 0.15 && position < recap.end - 0.35;
}

export function applyRecapSkip(
  recap: RecapMetadata,
  options: {
    seekTo?: (seconds: number) => void;
    seek?: (deltaSeconds: number) => void;
    video?: HTMLVideoElement | null;
    position?: number;
    duration?: number;
    showControls?: () => void;
  },
): number {
  const video = options.video ?? null;
  const duration =
    options.duration ?? (video !== null && Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY);
  const current = options.position ?? video?.currentTime ?? 0;
  const target = Math.max(Math.min(recap.end, duration), current + 1);

  if (options.seekTo !== undefined) {
    options.seekTo(target);
  } else if (video !== null) {
    video.currentTime = target;
  } else if (options.seek !== undefined) {
    options.seek(target - current);
  }

  options.showControls?.();
  window.dispatchEvent(new CustomEvent('tvm:user-activity'));
  return target;
}

export function isSkipRecapMounted(root: ParentNode = document): boolean {
  return root.querySelector(`[data-focus-id="${SKIP_RECAP_FOCUS_ID}"]`) !== null;
}

export function activateSkipRecap(root: ParentNode = document): boolean {
  const button = root.querySelector<HTMLElement>(`[data-focus-id="${SKIP_RECAP_FOCUS_ID}"]`);
  if (button === null || (button instanceof HTMLButtonElement && button.disabled)) return false;
  button.click();
  return true;
}

function useSkipRecapSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const sync = (): void => {
      const next = document.querySelector<HTMLElement>(SKIP_RECAP_SLOT);
      setSlot((current) => (current === next ? current : next));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return slot;
}

/**
 * Remote Skip Recap. Hidden unless a recap window exists. OK / click seeks to
 * the marker end through `seekTo` (or the html5 currentTime API).
 */
export function SkipRecap(props: SkipRecapProps = {}): React.JSX.Element | null {
  const session = usePlayerSession();
  const merged: SkipRecapProps = { ...session, ...props };
  const slot = useSkipRecapSlot();
  const skipKey = useScopedFocusKey(SKIP_RECAP_FOCUS_ID);
  const playKey = useScopedFocusKey('player-play');
  const [clock, setClock] = useState({ position: merged.position ?? 0, duration: merged.duration ?? 0 });

  useEffect(() => {
    const tick = (): void => {
      const node = findPlayerVideo(merged.videoRef);
      setClock({
        position: node?.currentTime ?? 0,
        duration: node !== null && Number.isFinite(node.duration) ? node.duration : 0,
      });
    };
    tick();
    const video = findPlayerVideo(merged.videoRef);
    video?.addEventListener('timeupdate', tick);
    video?.addEventListener('seeked', tick);
    video?.addEventListener('loadedmetadata', tick);
    const poll = window.setInterval(tick, 400);
    return () => {
      video?.removeEventListener('timeupdate', tick);
      video?.removeEventListener('seeked', tick);
      video?.removeEventListener('loadedmetadata', tick);
      window.clearInterval(poll);
    };
  }, [merged.videoRef]);

  const videoNode = findPlayerVideo(merged.videoRef);
  const useVideoClock = videoNode !== null && Number.isFinite(videoNode.duration) && videoNode.duration > 1;
  const position = useVideoClock ? clock.position : (merged.position ?? clock.position);
  const duration =
    useVideoClock && clock.duration > 0 ? clock.duration : (merged.duration ?? clock.duration);
  const recap = useMemo(
    () => resolveRecapMetadata(merged, findPlayerVideo(merged.videoRef)),
    [merged, clock.duration],
  );

  const blocked =
    merged.overlay === 'queue' ||
    merged.overlay === 'ad' ||
    merged.error !== null && merged.error !== undefined ||
    merged.engine === 'loading';
  const visible = recap !== null && !blocked && isRecapWindow(position, recap);

  useEffect(() => {
    if (!visible) return;
    return () => {
      const focused = document.querySelector(`[data-focus-id="${SKIP_RECAP_FOCUS_ID}"][data-focused="true"]`);
      if (focused !== null) requestFocus(playKey);
    };
  }, [playKey, visible, skipKey]);

  const onSelect = useCallback((): void => {
    const marker = resolveRecapMetadata(merged, findPlayerVideo(merged.videoRef));
    if (marker === null) return;
    applyRecapSkip(marker, {
      seekTo: merged.seekTo,
      seek: merged.seek,
      video: findPlayerVideo(merged.videoRef),
      position,
      duration,
      showControls: merged.showControls,
    });
  }, [duration, merged, position]);

  if (!visible || recap === null) return null;

  const button = (
    <div
      className={`player-skip-recap${slot !== null ? ' player-skip-recap--slotted' : ''}`}
      data-player-skip-recap="true"
    >
      <FocusButton
        id={SKIP_RECAP_FOCUS_ID}
        variant="primary"
        className="player-skip-recap__btn"
        onSelect={onSelect}
      >
        {recap.label ?? 'Skip recap'}
      </FocusButton>
    </div>
  );

  if (slot !== null) return createPortal(button, slot);
  return button;
}

export default SkipRecap;
