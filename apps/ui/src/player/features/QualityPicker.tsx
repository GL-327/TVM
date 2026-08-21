import { useCallback, useEffect, useMemo, useState } from 'react';
import Hls from 'hls.js';
import { FocusButton } from '../../components/FocusButton';
import { FALLBACK_PLAN, fetchPlan, type PlanStatus } from '../../data/plan';
import { requestFocus } from '../../nav/focusEngine';
import { useScopedFocusKey } from '../../nav/ViewStackContext';

export const QUALITY_FOCUS_ID = 'player-quality';
export const QUALITY_AUTO_FOCUS_ID = 'player-quality-auto';
export const AUTO_LEVEL = -1;

export interface QualityLevelOption {
  index: number;
  height: number;
  bitrate: number;
  name: string;
  label: string;
}

export interface QualityPickerProps {
  video?: HTMLVideoElement | null;
  videoRef?: { readonly current: HTMLVideoElement | null };
  engine?: 'loading' | 'html5' | 'native';
  controlsVisible?: boolean;
  overlay?: 'queue' | 'ad' | null;
  showControls?: () => void;
  /** Plan cap. Discovered from `/api/plan` when omitted. */
  maxHeight?: 720 | 1080 | 2160;
  /** Existing hls.js instance. Discovered from the player video when omitted. */
  hls?: Hls | null;
  className?: string;
}

const mediaToHls = new WeakMap<HTMLMediaElement, Hls>();
let hooked = false;

function bindHls(hls: Hls, media?: HTMLMediaElement | null): void {
  const el = media ?? hls.media;
  if (el === null) return;
  mediaToHls.set(el, hls);
  (el as HTMLMediaElement & { hls?: Hls }).hls = hls;
}

/** Remember the player's hls.js instance without editing Player.tsx. */
function hookHlsDiscovery(): void {
  if (hooked) return;
  hooked = true;
  const attach = Hls.prototype.attachMedia;
  Hls.prototype.attachMedia = function (this: Hls, media: HTMLMediaElement) {
    bindHls(this, media);
    return attach.call(this, media);
  };
}

function resolveVideo(props: QualityPickerProps): HTMLVideoElement | null {
  if (props.video instanceof HTMLVideoElement) return props.video;
  if (props.videoRef?.current instanceof HTMLVideoElement) return props.videoRef.current;
  return document.querySelector('.player video.player__video, .player__video, .player video');
}

function taggedHls(video: HTMLVideoElement | null): Hls | null {
  if (video === null) return null;
  const mapped = mediaToHls.get(video);
  if (mapped !== undefined) return mapped;
  const tagged = (video as HTMLVideoElement & { hls?: Hls }).hls;
  return tagged instanceof Hls ? tagged : null;
}

export function resolutionLabel(height: number): string | null {
  if (height >= 2160) return '4K';
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 540) return '540p';
  if (height >= 480) return '480p';
  if (height >= 360) return '360p';
  if (height > 0) return `${height}p`;
  return null;
}

export function formatBitrate(bitrate: number): string | null {
  if (!Number.isFinite(bitrate) || bitrate <= 0) return null;
  const mbps = bitrate / 1_000_000;
  if (mbps >= 10) return `${Math.round(mbps)} Mbps`;
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
  return `${Math.round(bitrate / 1000)} kbps`;
}

function optionLabel(level: { height: number; bitrate: number; name: string }, showBitrate: boolean): string {
  const named = level.name.trim();
  const res = resolutionLabel(level.height);
  const rate = showBitrate ? formatBitrate(level.bitrate) : null;
  const custom = named !== '' && !/^\d+p?$/i.test(named) && named.toLowerCase() !== 'default';
  if (custom) return rate !== null ? `${named} · ${rate}` : named;
  if (res !== null) return rate !== null ? `${res} · ${rate}` : res;
  if (rate !== null) return rate;
  return 'Source';
}

/** Real HLS variants at or under the plan cap. Never invents 720/1080/4K. */
export function selectableLevels(
  levels: ReadonlyArray<{ height: number; bitrate: number; name: string }>,
  maxHeight: number,
): QualityLevelOption[] {
  const raw: Omit<QualityLevelOption, 'label'>[] = [];
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    if (level === undefined) continue;
    if (level.height > 0 && level.height > maxHeight) continue;
    raw.push({ index, height: level.height, bitrate: level.bitrate, name: level.name });
  }
  const heights = new Map<number, number>();
  for (const row of raw) {
    if (row.height > 0) heights.set(row.height, (heights.get(row.height) ?? 0) + 1);
  }
  const showBitrate = [...heights.values()].some((count) => count > 1);
  return raw.map((row) => ({ ...row, label: optionLabel(row, showBitrate) }));
}

function readSnapshot(hls: Hls | null, maxHeight: number): { options: QualityLevelOption[]; auto: boolean; active: number } {
  if (hls === null) return { options: [], auto: true, active: AUTO_LEVEL };
  try {
    const options = selectableLevels(hls.levels, maxHeight);
    const auto = hls.autoLevelEnabled || hls.currentLevel < 0;
    const playing = auto ? hls.loadLevel : hls.currentLevel;
    return { options, auto, active: playing };
  } catch {
    return { options: [], auto: true, active: AUTO_LEVEL };
  }
}

function applyLevel(hls: Hls, index: number): void {
  if (index < 0) {
    hls.currentLevel = AUTO_LEVEL;
    return;
  }
  hls.nextLevel = index;
}

function QualityGlyph(): React.JSX.Element {
  return (
    <svg className="player-quality__glyph" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="8" width="26" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M9 12v8M9 16h4.6M13.6 12v8M18 20V12h3.1c2.1 0 3.4 1.3 3.4 4s-1.3 4-3.4 4H18Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function useScopedFocusKeySafe(id: string, fallbackScope: string): string {
  const slash = fallbackScope.lastIndexOf('/');
  if (slash < 0) return id;
  return `${fallbackScope.slice(0, slash + 1)}${id}`;
}

/**
 * Remote quality control.
 *
 * The html5 player already parses HLS variants and caps them with
 * `autoLevelCapping` / `plan.maxHeight`. When those levels exist, this is a
 * D-pad list (Auto + real variants). Native, progressive, or a single-file
 * stream has no ladder — show the plan max as a label, never a fake 1080/4K menu.
 */
export function QualityPicker(props: QualityPickerProps): React.JSX.Element | null {
  const [plan, setPlan] = useState<PlanStatus>(FALLBACK_PLAN);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const toggleKey = useScopedFocusKey(QUALITY_FOCUS_ID);
  const autoKey = useScopedFocusKey(QUALITY_AUTO_FOCUS_ID);

  const maxHeight = props.maxHeight ?? plan.maxHeight;
  const video = resolveVideo(props);
  const hls = props.hls ?? taggedHls(video);
  const snapshot = useMemo(() => readSnapshot(hls, maxHeight), [hls, maxHeight, tick]);
  const chromeVisible = props.controlsVisible ?? true;
  const blocked = props.overlay === 'queue' || props.overlay === 'ad';

  const refresh = useCallback((): void => {
    setTick((value) => value + 1);
  }, []);

  useEffect(() => {
    hookHlsDiscovery();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchPlan().then((status) => {
      if (!cancelled) setPlan(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    hookHlsDiscovery();
    const pulse = window.setInterval(refresh, 700);
    return () => window.clearInterval(pulse);
  }, [refresh]);

  useEffect(() => {
    if (hls === null) return;
    const events = [Hls.Events.MANIFEST_PARSED, Hls.Events.LEVELS_UPDATED, Hls.Events.LEVEL_SWITCHED] as const;
    for (const event of events) hls.on(event, refresh);
    return () => {
      for (const event of events) hls.off(event, refresh);
    };
  }, [hls, refresh]);

  useEffect(() => {
    if (!chromeVisible) setOpen(false);
  }, [chromeVisible]);

  const bumpChrome = useCallback((): void => {
    props.showControls?.();
    window.dispatchEvent(new CustomEvent('tvm:user-activity'));
  }, [props.showControls]);

  const closeMenu = useCallback((): void => {
    setOpen(false);
    requestFocus(toggleKey);
  }, [toggleKey]);

  const openMenu = useCallback((): void => {
    setOpen(true);
    bumpChrome();
    const nextId = snapshot.auto ? QUALITY_AUTO_FOCUS_ID : `player-quality-${snapshot.active}`;
    window.requestAnimationFrame(() => requestFocus(useScopedFocusKeySafe(nextId, toggleKey)));
  }, [bumpChrome, snapshot.active, snapshot.auto, toggleKey]);

  useEffect(() => {
    if (!open) return;
    const nextId = snapshot.auto ? autoKey : useScopedFocusKeySafe(`player-quality-${snapshot.active}`, toggleKey);
    window.requestAnimationFrame(() => requestFocus(nextId));
  }, [autoKey, open, snapshot.active, snapshot.auto, toggleKey]);

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

  const pick = useCallback(
    (index: number): void => {
      if (hls !== null) applyLevel(hls, index);
      refresh();
      bumpChrome();
      closeMenu();
    },
    [bumpChrome, closeMenu, hls, refresh],
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

  if (blocked || snapshot.options.length === 0 || props.engine === 'native') return null;

  const playing = snapshot.options.find((row) => row.index === snapshot.active);
  const toggleLabel = snapshot.auto
    ? playing !== undefined
      ? `Auto · ${resolutionLabel(playing.height) ?? playing.label}`
      : 'Auto'
    : (playing?.label ?? 'Quality');
  const classes = ['player-quality', props.className].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      data-player-feature="quality"
      data-mode="picker"
      data-open={open ? 'true' : undefined}
      data-visible={chromeVisible ? 'true' : 'false'}
    >
      <style>{QUALITY_CSS}</style>
      <FocusButton
        id={QUALITY_FOCUS_ID}
        className="player-quality__toggle"
        disabled={!chromeVisible}
        onSelect={() => {
          bumpChrome();
          if (open) closeMenu();
          else openMenu();
        }}
      >
        <span className="player-quality__face">
          <QualityGlyph />
          <span className="player-quality__word">{snapshot.auto ? 'Auto' : (resolutionLabel(playing?.height ?? 0) ?? 'HD')}</span>
        </span>
      </FocusButton>
      {open ? (
        <div className="player-quality__menu" role="listbox" aria-label="Quality" data-wrap="y">
          <p className="player-quality__heading">Quality</p>
          <FocusButton
            id={QUALITY_AUTO_FOCUS_ID}
            className={`player-quality__row${snapshot.auto ? ' player-quality__row--on' : ''}`}
            detail={snapshot.auto ? 'On' : undefined}
            onSelect={() => pick(AUTO_LEVEL)}
            onArrowPress={onMenuArrow}
          >
            Auto
          </FocusButton>
          {snapshot.options.map((row) => (
            <FocusButton
              key={row.index}
              id={`player-quality-${row.index}`}
              className={`player-quality__row${!snapshot.auto && snapshot.active === row.index ? ' player-quality__row--on' : ''}`}
              detail={formatBitrate(row.bitrate) ?? undefined}
              onSelect={() => pick(row.index)}
              onArrowPress={onMenuArrow}
            >
              {row.label}
            </FocusButton>
          ))}
        </div>
      ) : null}
      <span className="player-quality__live" aria-live="polite">
        {toggleLabel}
      </span>
    </div>
  );
}

const QUALITY_CSS = `
.player-quality {
  position: relative;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  pointer-events: auto;
}
.player-transport .player-quality,
.player-root__tools .player-quality,
.player-dock__tools .player-quality {
  position: relative;
  right: auto;
  bottom: auto;
}
.player-quality[data-visible='false'] {
  opacity: 0;
  pointer-events: none;
}
.player-quality--label {
  pointer-events: none;
}
.player-quality__cap {
  color: color-mix(in srgb, var(--tvm-text, #f5f5f5) 72%, transparent);
  font-size: 0.78rem;
  font-weight: 750;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-shadow: 0 0.08rem 0.45rem rgba(0, 0, 0, 0.7);
}
.player-quality__toggle {
  min-width: 2.7rem;
  min-height: 2.7rem;
  padding: 0.3rem 0.55rem;
  border-radius: 0.5rem;
}
.player-quality__face {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
}
.player-quality__glyph {
  width: 1.35rem;
  height: 1.35rem;
}
.player-quality__word {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
}
.player-quality__menu {
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
.player-quality__heading {
  margin: 0 0.2rem 0.15rem;
  color: color-mix(in srgb, #fff, transparent 28%);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.player-quality__row {
  width: 100%;
  min-height: 2.7rem;
  justify-content: space-between;
  border-radius: 0.5rem;
}
.player-quality__row--on {
  box-shadow: inset 0 0 0 0.1rem #fff;
}
.player-quality__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
`;

export default QualityPicker;
