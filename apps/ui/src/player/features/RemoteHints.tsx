import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * First-play remote legend. Decorative only — never enters the spatial map.
 *
 * PlayerRoot spreads the session. The hint waits until the picture is up,
 * then writes localStorage on first appearance so it never blocks focus.
 */

export const REMOTE_HINTS_STORAGE_KEY = 'tvm.player.remote-hints.v1';

export const REMOTE_HINTS_COPY = {
  skip: { keys: ['Left', 'Right'] as const, action: 'Skip' },
  pause: { keys: ['OK'] as const, action: 'Pause' },
  exit: { keys: ['Back'] as const, action: 'Exit' },
  spoken: 'Left or Right to skip. OK to pause. Back to exit.',
  spokenLive: 'OK to pause. Back to exit.',
} as const;

export const REMOTE_HINTS_DISMISS = {
  /** Wait after `ready` so the loader can clear. */
  settleMs: 420,
  /** Visible hold before the dissolve. */
  autoMs: 5200,
  /** Ignore leftover input from the Play press that opened the player. */
  activityGraceMs: 750,
  /** Must stay in step with the CSS leave transition. */
  fadeMs: 280,
} as const;

export interface RemoteHintsProps {
  /** Picture is up (not queue, ad, or a hard error). Inferred from session when omitted. */
  ready?: boolean;
  /** Live omits skip — Left/Right are not a seek lesson there. */
  live?: boolean;
  /** Force-hide (fatal error chrome, blocking pickers). */
  hidden?: boolean;
  /** PlayerRoot spreads the session; these fields drive first-play timing. */
  mediaId?: string;
  engine?: string;
  busy?: boolean;
  error?: string | null;
  overlay?: 'queue' | 'ad' | null;
}

type Phase = 'wait' | 'visible' | 'leaving' | 'gone';

type LessonId = keyof typeof REMOTE_HINTS_COPY;
type Lesson = { id: Exclude<LessonId, 'spoken' | 'spokenLive'>; keys: readonly string[]; action: string };

let sessionSeen = false;

export function remoteHintsSpoken(live = false): string {
  return live ? REMOTE_HINTS_COPY.spokenLive : REMOTE_HINTS_COPY.spoken;
}

export function remoteHintLessons(live = false): readonly Lesson[] {
  const skip: Lesson = { id: 'skip', keys: REMOTE_HINTS_COPY.skip.keys, action: REMOTE_HINTS_COPY.skip.action };
  const pause: Lesson = { id: 'pause', keys: REMOTE_HINTS_COPY.pause.keys, action: REMOTE_HINTS_COPY.pause.action };
  const exit: Lesson = { id: 'exit', keys: REMOTE_HINTS_COPY.exit.keys, action: REMOTE_HINTS_COPY.exit.action };
  return live ? [pause, exit] : [skip, pause, exit];
}

export function remoteHintsAlreadySeen(): boolean {
  if (sessionSeen) return true;
  try {
    return window.localStorage.getItem(REMOTE_HINTS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markRemoteHintsSeen(): void {
  sessionSeen = true;
  try {
    window.localStorage.setItem(REMOTE_HINTS_STORAGE_KEY, '1');
  } catch {
    // Private mode still suppresses the hint for this session.
  }
}

function isLiveId(mediaId: string | undefined): boolean {
  return typeof mediaId === 'string' && mediaId.startsWith('live:');
}

function resolveLive(props: RemoteHintsProps): boolean {
  return props.live ?? isLiveId(props.mediaId);
}

function resolveReady(props: RemoteHintsProps): boolean {
  if (props.ready !== undefined) return props.ready;
  if (props.overlay != null) return false;
  if (props.error != null && props.error !== '') return false;
  if (props.engine === 'loading') return false;
  if (props.busy === true) return false;
  return true;
}

function resolveHidden(props: RemoteHintsProps): boolean {
  if (props.hidden === true) return true;
  if (props.error != null && props.error !== '') return true;
  if (props.overlay != null) return true;
  return false;
}

export function RemoteHints(props: RemoteHintsProps): React.JSX.Element | null {
  const live = resolveLive(props);
  const ready = resolveReady(props);
  const hidden = resolveHidden(props);
  const [phase, setPhase] = useState<Phase>(() => (remoteHintsAlreadySeen() ? 'gone' : 'wait'));
  const lessons = useMemo(() => remoteHintLessons(live), [live]);
  const spoken = remoteHintsSpoken(live);

  const dismiss = useCallback((): void => {
    setPhase((current) => {
      if (current !== 'visible') return current;
      markRemoteHintsSeen();
      return 'leaving';
    });
  }, []);

  useEffect(() => {
    if (phase === 'visible') markRemoteHintsSeen();
  }, [phase]);

  useEffect(() => {
    if (phase !== 'wait' || hidden || !ready) return;
    const timer = window.setTimeout(() => setPhase('visible'), REMOTE_HINTS_DISMISS.settleMs);
    return () => window.clearTimeout(timer);
  }, [hidden, phase, ready]);

  useEffect(() => {
    if (phase === 'visible' && hidden) dismiss();
  }, [dismiss, hidden, phase]);

  useEffect(() => {
    if (phase !== 'visible') return;
    const timer = window.setTimeout(dismiss, REMOTE_HINTS_DISMISS.autoMs);
    return () => window.clearTimeout(timer);
  }, [dismiss, phase]);

  useEffect(() => {
    if (phase !== 'visible') return;
    const opened = Date.now();
    const onActivity = (): void => {
      if (Date.now() - opened < REMOTE_HINTS_DISMISS.activityGraceMs) return;
      dismiss();
    };
    window.addEventListener('tvm:user-activity', onActivity);
    window.addEventListener('tvm:media-intent', onActivity);
    window.addEventListener('pointerdown', onActivity);
    return () => {
      window.removeEventListener('tvm:user-activity', onActivity);
      window.removeEventListener('tvm:media-intent', onActivity);
      window.removeEventListener('pointerdown', onActivity);
    };
  }, [dismiss, phase]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = window.setTimeout(() => setPhase('gone'), REMOTE_HINTS_DISMISS.fadeMs);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === 'wait' || phase === 'gone') return null;

  return (
    <aside
      className="player-remote-hints"
      data-player-hints=""
      data-player-feature="remote-hints"
      data-state={phase === 'visible' ? 'in' : 'out'}
      data-live={live ? 'true' : undefined}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={spoken}
    >
      <style href="tvm-player-remote-hints" precedence="player">
        {REMOTE_HINTS_CSS}
      </style>
      <p className="player-remote-hints__sr">{spoken}</p>
      <ol className="player-remote-hints__phrase">
        {lessons.map((lesson, index) => (
          <li
            key={lesson.id}
            className="player-remote-hints__lesson"
            data-lesson={lesson.id}
            style={{ ['--hint-i']: String(index) } as React.CSSProperties}
          >
            <span className="player-remote-hints__keys">
              {lesson.keys.map((key) => (
                <kbd key={key} className="player-remote-hints__key">
                  {key}
                </kbd>
              ))}
            </span>
            <span className="player-remote-hints__action">{lesson.action}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

const REMOTE_HINTS_CSS = `
.player-remote-hints {
  position: absolute;
  left: 50%;
  bottom: calc(var(--tvm-safe-y, 1.5rem) + 10.4rem);
  z-index: 6;
  display: flex;
  justify-content: center;
  width: max-content;
  max-width: calc(100% - (var(--tvm-safe-x, 2.5rem) * 2));
  margin: 0;
  padding: 0;
  pointer-events: none;
  user-select: none;
  contain: layout style;
  transform: translateX(-50%) translateY(0.45rem);
  opacity: 0;
}

.player-remote-hints[data-state='in'] {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
  will-change: opacity, transform;
  transition:
    opacity var(--tvm-motion-slow, 260ms) var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--tvm-motion-slow, 260ms) var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
}

.player-remote-hints[data-state='out'] {
  opacity: 0;
  transform: translateX(-50%) translateY(0.35rem);
  will-change: auto;
  transition:
    opacity var(--tvm-motion-slow, 260ms) var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--tvm-motion-slow, 260ms) var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
}

.player-remote-hints__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.player-remote-hints__phrase {
  display: flex;
  align-items: center;
  gap: 0.95rem;
  margin: 0;
  padding: 0.48rem 0.85rem 0.48rem 0.7rem;
  list-style: none;
  border: 1px solid color-mix(in srgb, var(--tvm-accent, #fff) 18%, transparent);
  border-radius: var(--tvm-radius-pill, 999rem);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 46%),
    color-mix(in srgb, var(--tvm-bg-deep, #000) 42%, transparent);
  box-shadow:
    0 0.55rem 1.6rem rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  -webkit-backdrop-filter: blur(0.85rem) saturate(1.15);
  backdrop-filter: blur(0.85rem) saturate(1.15);
}

.player-remote-hints__lesson {
  display: flex;
  align-items: center;
  gap: 0.42rem;
}

.player-remote-hints__lesson + .player-remote-hints__lesson::before {
  content: '';
  width: 0.22rem;
  height: 0.22rem;
  margin-right: 0.12rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--tvm-text-faint, #8a8a8a) 70%, transparent);
  opacity: 0.7;
}

.player-remote-hints__keys {
  display: inline-flex;
  align-items: center;
  gap: 0.22rem;
}

.player-remote-hints__key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.05rem;
  height: 1.45rem;
  padding: 0 0.42rem;
  border: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: 0.38rem;
  background: rgba(255, 255, 255, 0.07);
  color: var(--tvm-text, #f5f5f5);
  font-family: var(--tvm-font-family, inherit);
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.06em;
  line-height: 1;
  text-transform: uppercase;
}

.player-remote-hints[data-state='in'] .player-remote-hints__key {
  animation: player-remote-hints-press 2.6s var(--tvm-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)) 2 both;
  animation-delay: calc(var(--hint-i, 0) * 0.55s);
}

.player-remote-hints__action {
  color: color-mix(in srgb, var(--tvm-text, #f5f5f5) 78%, transparent);
  font-size: var(--tvm-font-size-caption, 0.8125rem);
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

@keyframes player-remote-hints-press {
  0%, 100% {
    background: rgba(255, 255, 255, 0.07);
    box-shadow: none;
  }
  38% {
    background: rgba(255, 255, 255, 0.2);
    box-shadow: 0 0 0 0.11rem color-mix(in srgb, var(--tvm-accent, #fff) 55%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-remote-hints,
  .player-remote-hints[data-state='in'],
  .player-remote-hints[data-state='out'] {
    transform: translateX(-50%);
    transition: opacity 1ms linear;
  }

  .player-remote-hints[data-state='in'] .player-remote-hints__key {
    animation: none;
  }
}
`;

export default RemoteHints;
