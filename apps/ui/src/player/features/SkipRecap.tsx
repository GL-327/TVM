import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { FocusButton } from '../../components/FocusButton';
import type { ExtrasSegments } from '../../data/extras';
import { PREFS_CHANGED_EVENT, readPrefs, type SkipSegmentsMode } from '../../data/prefs';
import { requestFocus } from '../../nav/focusEngine';
import { useScopedFocusKey } from '../../nav/ViewStackContext';
import { usePlayerSession, type PlayerSession } from '../PlayerRoot';
import { isLivePlayback } from './LiveOverlay';
import './SkipRecap.css';

export const SKIP_RECAP_FOCUS_ID = 'player-skip-recap';
export const SKIP_RECAP_SLOT = '[data-slot="skip-recap"]';

/** Recap window used by the existing Player chrome when no richer marker is attached. */
export const DEFAULT_RECAP_END_SECONDS = 90;
/** Skip pill auto-hides after 8 s into the segment (or when the segment ends). */
export const SKIP_PILL_VISIBLE_MS = 8_000;

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

export type ActiveSegmentKind = 'recap' | 'intro' | 'credits';

export interface ActiveSegment {
  kind: ActiveSegmentKind;
  start: number;
  end: number | null;
  label: string;
}

export type SkipRecapProps = Partial<PlayerSession> & {
  recap?: RecapLike;
  recapEnd?: number;
  recapStart?: number;
  markers?: unknown;
  chapters?: unknown;
  skipMode?: SkipSegmentsMode;
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

export function isSegmentActive(position: number, start: number, end: number | null, duration = 0): boolean {
  if (!Number.isFinite(position) || !Number.isFinite(start) || start < 0) return false;
  if (position < start - 0.15) return false;
  if (end !== null && Number.isFinite(end)) return position < end - 0.35;
  if (Number.isFinite(duration) && duration > 0) return position < duration - 0.35;
  return true;
}

export function activeSegmentForTime(
  position: number,
  duration: number,
  segments: ExtrasSegments | null | undefined,
  legacyRecap: RecapMetadata | null,
  mode: SkipSegmentsMode,
): ActiveSegment | null {
  if (mode === 'off') return null;

  if (segments !== null && segments !== undefined) {
    if (segments.recap !== null && isSegmentActive(position, segments.recap.start, segments.recap.end, duration)) {
      return { kind: 'recap', start: segments.recap.start, end: segments.recap.end, label: 'Skip recap' };
    }
    if (segments.intro !== null && isSegmentActive(position, segments.intro.start, segments.intro.end, duration)) {
      return { kind: 'intro', start: segments.intro.start, end: segments.intro.end, label: 'Skip intro' };
    }
    if (segments.credits !== null && isSegmentActive(position, segments.credits.start, segments.credits.end, duration)) {
      return { kind: 'credits', start: segments.credits.start, end: segments.credits.end, label: 'Skip credits' };
    }
  }

  if (legacyRecap !== null && isRecapWindow(position, legacyRecap)) {
    return {
      kind: 'recap',
      start: legacyRecap.start,
      end: legacyRecap.end,
      label: legacyRecap.label ?? 'Skip recap',
    };
  }
  return null;
}

export function applyRecapSkip(
  recap: { start: number; end: number | null },
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
  const desiredEnd = recap.end !== null && Number.isFinite(recap.end)
    ? recap.end
    : Number.isFinite(duration) && duration > 0
      ? Math.max(0, duration - 0.08)
      : current + 1;
  const target = Math.max(Math.min(desiredEnd, duration), current + 1);

  if (options.seekTo !== undefined) {
    options.seekTo(target);
  } else if (video !== null) {
    video.currentTime = target;
  } else if (options.seek !== undefined) {
    options.seek(target - current);
  }

  options.showControls?.();
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('tvm:user-activity'));
  }
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

/**
 * Player segment skip pill (Skip intro / Skip recap / Skip credits).
 * Appears bottom-right as a Glass 27 pill for 8 s or until the segment ends,
 * or skips automatically when the viewer picks Skip automatically in Settings.
 */
export function SkipRecap(props: SkipRecapProps = {}): React.JSX.Element | null {
  const session = usePlayerSession();
  const merged: SkipRecapProps = { ...session, ...props };
  const skipKey = useScopedFocusKey(SKIP_RECAP_FOCUS_ID);
  const playKey = useScopedFocusKey('player-play');
  const [clock, setClock] = useState({ position: merged.position ?? 0, duration: merged.duration ?? 0 });
  const [prefMode, setPrefMode] = useState<SkipSegmentsMode>(() => readPrefs().skipSegments);
  const [timedOut, setTimedOut] = useState(false);
  const [wakeCounter, setWakeCounter] = useState(0);
  const autoSkippedRef = useRef<Set<string>>(new Set());
  const prevVisibleRef = useRef(false);
  const hasSessionClock = merged.position !== undefined && merged.duration !== undefined;

  useEffect(() => {
    const sync = (): void => setPrefMode(readPrefs().skipSegments);
    window.addEventListener(PREFS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PREFS_CHANGED_EVENT, sync);
  }, []);

  useEffect(() => {
    autoSkippedRef.current.clear();
    setTimedOut(false);
  }, [merged.mediaId]);

  useEffect(() => {
    if (hasSessionClock) return;
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
    return () => {
      video?.removeEventListener('timeupdate', tick);
      video?.removeEventListener('seeked', tick);
      video?.removeEventListener('loadedmetadata', tick);
    };
  }, [hasSessionClock, merged.videoRef]);

  const position = merged.position ?? clock.position;
  const duration = merged.duration ?? clock.duration;
  const skipMode = props.skipMode ?? prefMode;
  const isLive = merged.live === true || (typeof merged.mediaId === 'string' && isLivePlayback(merged.mediaId));
  const legacyRecap = useMemo(
    () => resolveRecapMetadata(merged, findPlayerVideo(merged.videoRef)),
    [merged, clock.duration],
  );
  const active = useMemo(
    () =>
      isLive
        ? null
        : activeSegmentForTime(position, duration, merged.segments, legacyRecap, skipMode),
    [duration, isLive, legacyRecap, merged.segments, position, skipMode],
  );

  const blocked =
    merged.overlay === 'queue' ||
    merged.overlay === 'ad' ||
    (merged.error !== null && merged.error !== undefined) ||
    merged.engine === 'loading';

  const activeKey = active !== null ? `${active.kind}:${active.start}` : null;

  useEffect(() => {
    setTimedOut(false);
  }, [activeKey]);

  useEffect(() => {
    if (activeKey === null || blocked || skipMode !== 'button') return;
    const onActivity = (): void => {
      setTimedOut(false);
      setWakeCounter((n) => n + 1);
    };
    window.addEventListener('tvm:user-activity', onActivity);
    return () => window.removeEventListener('tvm:user-activity', onActivity);
  }, [activeKey, blocked, skipMode]);

  useEffect(() => {
    if (activeKey === null || blocked || skipMode !== 'button' || merged.paused === true) return;
    const timer = window.setTimeout(() => setTimedOut(true), SKIP_PILL_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [activeKey, blocked, merged.paused, skipMode, wakeCounter]);

  const performSkip = useCallback(
    (segment: ActiveSegment): void => {
      applyRecapSkip(
        { start: segment.start, end: segment.end },
        {
          seekTo: merged.seekTo,
          seek: merged.seek,
          video: findPlayerVideo(merged.videoRef),
          position,
          duration,
          showControls: merged.showControls,
        },
      );
    },
    [duration, merged, position],
  );

  useEffect(() => {
    if (skipMode !== 'auto' || blocked || active === null || activeKey === null) return;
    if (autoSkippedRef.current.has(activeKey)) return;
    // Leave open-ended credits to Up Next when a next episode card is active.
    if (active.kind === 'credits' && active.end === null && document.querySelector('[data-next-up="true"]') !== null) {
      return;
    }
    autoSkippedRef.current.add(activeKey);
    performSkip(active);
  }, [active, activeKey, blocked, performSkip, skipMode]);

  const visible = active !== null && !blocked && !timedOut && skipMode !== 'off';

  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      const menuOpen = document.querySelector('.player [data-player-menu], .player [role="listbox"]') !== null;
      if (!menuOpen) {
        const timer = window.setTimeout(() => requestFocus(skipKey), 30);
        prevVisibleRef.current = visible;
        return () => window.clearTimeout(timer);
      }
    }
    if (!visible && prevVisibleRef.current) {
      const focused = document.querySelector(`[data-focus-id="${SKIP_RECAP_FOCUS_ID}"][data-focused="true"]`);
      if (focused !== null) requestFocus(playKey);
    }
    prevVisibleRef.current = visible;
    return undefined;
  }, [playKey, skipKey, visible]);

  const onSelect = useCallback((): void => {
    if (active === null) return;
    performSkip(active);
  }, [active, performSkip]);

  if (!visible || active === null) return null;

  return (
    <div
      className="player-skip-recap"
      data-player-skip-recap="true"
      data-segment-kind={active.kind}
    >
      <FocusButton
        id={SKIP_RECAP_FOCUS_ID}
        className="glass glass--chrome player-skip-recap__btn"
        onSelect={onSelect}
      >
        {active.label}
      </FocusButton>
    </div>
  );
}

export default SkipRecap;
