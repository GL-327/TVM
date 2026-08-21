import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { FocusButton } from '../../components/FocusButton';
import { playbackErrorMessage } from '../../data/playbackErrors';
import { requestFocus } from '../../nav/focusEngine';
import { useNavigate, useScopedFocusKey } from '../../nav/ViewStackContext';
import { usePlayerSession, type PlayerEngine, type PlayerOverlay } from '../PlayerRoot';

export const PLAYBACK_ERROR_RETRY_ID = 'player-retry';
export const PLAYBACK_ERROR_BACK_ID = 'player-error-back';
export const PLAYBACK_ERROR_PLANS_ID = 'player-error-plans';

/** Delay so html5 → native fallback is not painted as a dead error card. */
const FALLBACK_GRACE_MS = 2_800;
const RETRY_IGNORE_MS = 1_400;

export const PLAYBACK_ERROR_CASES = [
  'aborted',
  'network',
  'decode',
  'unsupported',
  'not-in-library',
  'empty',
  'needs-auth',
  'not-configured',
  'hours-cap',
  'stalled',
  'native',
  'internal',
  'message',
] as const;

export type PlaybackErrorKind = (typeof PLAYBACK_ERROR_CASES)[number];

export interface PlaybackErrorCopy {
  kind: PlaybackErrorKind;
  title: string;
  body: string;
  showPlans: boolean;
}

export interface PlaybackErrorProps {
  error?: string | MediaError | number | null;
  reason?: string | null;
  videoRef?: RefObject<HTMLVideoElement | null>;
  video?: HTMLVideoElement | null;
  engine?: PlayerEngine;
  busy?: boolean;
  buffering?: boolean;
  overlay?: PlayerOverlay;
  retry?: () => void;
  close?: () => void;
  onRetry?: () => void;
  onBack?: () => void;
}

const COPY: Record<Exclude<PlaybackErrorKind, 'message'>, PlaybackErrorCopy> = {
  aborted: {
    kind: 'aborted',
    title: 'Playback stopped',
    body: 'Playback was interrupted. Press Retry to start again, or Back to leave.',
    showPlans: false,
  },
  network: {
    kind: 'network',
    title: 'Can’t reach the stream',
    body: 'TVM could not reach the stream or the local core. Check the connection, then press Retry.',
    showPlans: false,
  },
  decode: {
    kind: 'decode',
    title: 'Can’t play this file',
    body: 'This file could not be decoded. Press Retry, or Back to pick another title.',
    showPlans: false,
  },
  unsupported: {
    kind: 'unsupported',
    title: 'Format not supported',
    body: 'This link could not be opened. Press Retry for a converted stream, or Back to pick another title.',
    showPlans: false,
  },
  'not-in-library': {
    kind: 'not-in-library',
    title: 'No stream yet',
    body: 'No playable stream was found. It may not be cached on Real-Debrid yet. Press Retry, or Back.',
    showPlans: false,
  },
  empty: {
    kind: 'empty',
    title: 'No streams found',
    body: 'Torrentio returned no streams for this title. Press Retry later, or Back to pick another episode.',
    showPlans: false,
  },
  'needs-auth': {
    kind: 'needs-auth',
    title: 'Real-Debrid token',
    body: 'Real-Debrid rejected the saved token. Press Back, then open TVM Stream and paste a new one.',
    showPlans: false,
  },
  'not-configured': {
    kind: 'not-configured',
    title: 'Connect Real-Debrid',
    body: 'Real-Debrid is not connected. Press Back, then open TVM Stream and paste a token.',
    showPlans: false,
  },
  'hours-cap': {
    kind: 'hours-cap',
    title: 'Watch hours used',
    body: 'This week’s Free watch hours are used. Ads do not count. Press Back, or view Plans.',
    showPlans: true,
  },
  stalled: {
    kind: 'stalled',
    title: 'Playback stalled',
    body: 'The stream did not start. Press Retry, or Back to pick another file.',
    showPlans: false,
  },
  native: {
    kind: 'native',
    title: 'Native playback failed',
    body: 'TVM could not start native playback. Check that mpv is installed, then press Retry.',
    showPlans: false,
  },
  internal: {
    kind: 'internal',
    title: 'Playback failed',
    body: playbackErrorMessage('internal'),
    showPlans: false,
  },
};

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[’‘`]/g, "'");
}

function fromMediaCode(code: number): PlaybackErrorCopy {
  if (code === 1) return COPY.aborted;
  if (code === 2) return COPY.network;
  if (code === 3) return COPY.decode;
  if (code === 4) return COPY.unsupported;
  return COPY.internal;
}

function fromReasonCode(reason: string): PlaybackErrorCopy | null {
  if (reason in COPY) return COPY[reason as Exclude<PlaybackErrorKind, 'message'>];
  return null;
}

/**
 * Maps session strings, HTML5 MediaError codes, and core reasons to couch-readable copy.
 * Unknown core sentences are kept as the body so a timeout is never replaced with “unavailable”.
 */
export function describePlaybackError(
  input: string | MediaError | number | null | undefined,
): PlaybackErrorCopy | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return fromMediaCode(input);
  if (typeof input === 'object') return fromMediaCode(input.code);

  const known = fromReasonCode(input);
  if (known !== null) return known;

  const trimmed = input.trim();
  if (trimmed === '') return COPY.internal;

  const text = normalize(trimmed);
  if (text.includes('watch hours') || text.includes('hours-cap') || text.includes('hours are used')) {
    return COPY['hours-cap'];
  }
  if (text.includes('rejected the saved token') || text.includes('needs-auth') || text.includes('paste a new one')) {
    return COPY['needs-auth'];
  }
  if (text.includes('not connected') || text.includes('not-configured') || text.includes('paste a token')) {
    return COPY['not-configured'];
  }
  if (text.includes('torrentio returned no streams') || text.includes('no streams for this title') || text === 'empty') {
    return COPY.empty;
  }
  if (text.includes('not be cached') || text.includes('not-in-library') || text.includes('no playable stream')) {
    return COPY['not-in-library'];
  }
  if (
    text.includes('could not be opened') ||
    text.includes('src_not_supported') ||
    text.includes('media_err_src_not_supported') ||
    text.includes('format cannot play') ||
    text.includes('not supported')
  ) {
    return COPY.unsupported;
  }
  if (text.includes('mpv') || text.includes('native playback') || text.includes('converted stream')) {
    return COPY.native;
  }
  if (text.includes('stalled') || text.includes('did not start') || text.includes('bufferstalled')) {
    return COPY.stalled;
  }
  if (
    text.includes('local core') ||
    text.includes('could not reach') ||
    text.includes('media_err_network') ||
    text.includes('manifestload') ||
    text.includes('fragload')
  ) {
    return COPY.network;
  }
  if (text.includes('decode') || text.includes('media_err_decode')) {
    return COPY.decode;
  }
  if (text.includes('interrupted') || text.includes('media_err_aborted') || text.includes('aborted')) {
    return COPY.aborted;
  }
  if (text.includes('playback failed inside') || text === 'internal' || text === 'internal_error') {
    return COPY.internal;
  }

  return {
    kind: 'message',
    title: 'Playback failed',
    body: trimmed,
    showPlans: false,
  };
}

function unwrapVideo(
  value: HTMLVideoElement | null | RefObject<HTMLVideoElement | null> | undefined,
): HTMLVideoElement | null {
  if (value == null) return null;
  if (value instanceof HTMLVideoElement) return value;
  return value.current;
}

function findVideo(
  explicit: HTMLVideoElement | null | undefined,
  videoRef: RefObject<HTMLVideoElement | null> | undefined,
  host: HTMLElement | null,
): HTMLVideoElement | null {
  const fromProp = unwrapVideo(explicit) ?? unwrapVideo(videoRef);
  if (fromProp !== null) return fromProp;
  const scope = host?.closest('.player, [data-player-root], .player-root') ?? host?.parentElement;
  const scoped = scope?.querySelector('video');
  if (scoped instanceof HTMLVideoElement) return scoped;
  const fallback = document.querySelector('.player video, .player__video');
  return fallback instanceof HTMLVideoElement ? fallback : null;
}

function readLegacyError(root: ParentNode | null): string | null {
  if (root === null) return null;
  const node = root.querySelector('.player__error');
  const text = node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return text === '' ? null : text;
}

function clickForeignFocusId(id: string, except: HTMLElement | null): boolean {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-focus-id="${id}"]`);
  for (const node of nodes) {
    if (except !== null && except.contains(node)) continue;
    node.click();
    return true;
  }
  return false;
}

function inertForeignSurfaces(overlay: HTMLElement): () => void {
  const player = overlay.closest('.player');
  const playerRoot = overlay.closest('.player-root, [data-player-root]');
  const stopAt = player instanceof HTMLElement ? player : playerRoot instanceof HTMLElement ? playerRoot : null;
  const mutated: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  const mark = (el: HTMLElement): void => {
    if (seen.has(el) || el === overlay || overlay.contains(el) || el.contains(overlay)) return;
    if (el.tagName === 'VIDEO' || el.classList.contains('player__video')) return;
    seen.add(el);
    if (!el.hasAttribute('inert')) {
      el.setAttribute('inert', '');
      mutated.push(el);
    }
  };

  let node: HTMLElement | null = overlay.parentElement;
  while (node !== null) {
    for (const child of Array.from(node.children)) {
      if (child instanceof HTMLElement) mark(child);
    }
    if (node === stopAt) break;
    node = node.parentElement;
  }

  return () => {
    for (const el of mutated) el.removeAttribute('inert');
  };
}

const CSS = `
.player-error {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(var(--tvm-safe-y, 2.4rem) + env(titlebar-area-height, 0px)) var(--tvm-safe-x, 2.5rem);
  background:
    radial-gradient(80% 70% at 50% 40%, rgba(28, 12, 16, 0.35), transparent 62%),
    rgba(4, 4, 8, 0.92);
  pointer-events: auto;
}

.player-error .error-state {
  width: min(52rem, 100%);
  min-height: 0;
  padding: var(--tvm-space-5, 2rem);
}

.player-error .empty-state__title {
  font-size: clamp(2rem, 4.2vw, 3.15rem);
  line-height: 1.05;
  text-wrap: balance;
}

.player-error .page__lede {
  max-width: 34ch;
  color: var(--tvm-text, #f5f5f5);
  font-size: var(--tvm-font-size-body-lg, 1.25rem);
  line-height: 1.35;
  text-wrap: pretty;
}

.player-error .hero__actions {
  margin-top: 0.35rem;
  gap: 1rem;
}

.player-error .tvm-button {
  min-width: 10.5rem;
  min-height: 3.25rem;
}

.player:has(.player-error),
.player-root:has(.player-error),
[data-player-root]:has(.player-error) {
  --player-error-open: 1;
}

.player:has(.player-error) .player__error-block,
.player:has(.player-error) .player__error,
.player:has(.player-error) .player__loader,
.player:has(.player-error) .player__queue,
.player:has(.player-error) .player__ad,
.player:has(.player-error) .tvm-buffering,
.player-root:has(.player-error) .tvm-buffering,
.player-root:has(.player-error) .player-remote-hints,
.player-root:has(.player-error) .player-title-overlay,
.player-root:has(.player-error) .next-up-layer,
.player-root:has(.player-error) .next-up {
  display: none !important;
}
`;

/**
 * Exclusive 10-foot error card. Retry and Back are the only live controls.
 * Sibling chrome is inert so queue / loader / transport cannot sit as a dead overlay.
 */
export function PlaybackError(props: PlaybackErrorProps): React.JSX.Element | null {
  const ctx = usePlayerSession();
  const session = ctx === null ? props : { ...ctx, ...props };
  const navigate = useNavigate();
  const retryKey = useScopedFocusKey(PLAYBACK_ERROR_RETRY_ID);
  const hostRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const ignoreUntil = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [detected, setDetected] = useState<PlaybackErrorCopy | null>(null);

  const fromProps = useMemo(() => {
    if (session.error !== undefined && session.error !== null) return describePlaybackError(session.error);
    if (session.reason !== undefined && session.reason !== null && session.reason !== '') {
      return describePlaybackError(session.reason);
    }
    return null;
  }, [session.error, session.reason]);

  const copy = fromProps ?? detected;
  const transient = session.overlay === 'queue' || session.overlay === 'ad';
  const visible = copy !== null && (fromProps !== null || !transient);

  useEffect(() => {
    let attached: HTMLVideoElement | null = null;
    let graceTimer = 0;
    const root =
      hostRef.current?.closest('.player, [data-player-root], .player-root') ??
      document.querySelector('.player, [data-player-root]');

    const clearGrace = (): void => {
      if (graceTimer === 0) return;
      window.clearTimeout(graceTimer);
      graceTimer = 0;
    };

    const ignored = (): boolean => Date.now() < ignoreUntil.current;

    const sameCopy = (left: PlaybackErrorCopy | null, right: PlaybackErrorCopy | null): boolean => {
      if (left === right) return true;
      if (left === null || right === null) return false;
      return left.kind === right.kind && left.body === right.body && left.title === right.title;
    };

    const commit = (next: PlaybackErrorCopy | null): void => {
      if (ignored()) return;
      setDetected((current) => (sameCopy(current, next) ? current : next));
    };

    const live = (): PlaybackErrorProps => sessionRef.current;

    const commitVideo = (el: HTMLVideoElement): void => {
      if (ignored()) return;
      const now = live();
      if (now.overlay === 'queue' || now.overlay === 'ad') return;
      if (now.engine === 'loading') return;
      const media = el.error;
      if (media === null) return;
      if (media.code === 1 && (now.busy === true || now.engine === 'html5')) return;
      commit(fromMediaCode(media.code));
    };

    const scheduleVideo = (el: HTMLVideoElement): void => {
      const now = live();
      if (now.overlay === 'queue' || now.overlay === 'ad') return;
      if (now.engine === 'loading') return;
      const waiting = now.engine === 'html5' || now.busy === true || now.buffering === true;
      if (!waiting) {
        commitVideo(el);
        return;
      }
      clearGrace();
      graceTimer = window.setTimeout(() => {
        graceTimer = 0;
        if (el.error !== null && el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) commitVideo(el);
      }, FALLBACK_GRACE_MS);
    };

    const onVideoError = (event: Event): void => {
      if (event.currentTarget instanceof HTMLVideoElement) scheduleVideo(event.currentTarget);
    };

    const onPlaying = (): void => {
      clearGrace();
      setDetected(null);
    };

    const detach = (): void => {
      if (attached === null) return;
      attached.removeEventListener('error', onVideoError);
      attached.removeEventListener('playing', onPlaying);
      attached.removeEventListener('emptied', onPlaying);
      attached = null;
    };

    const attach = (el: HTMLVideoElement): void => {
      if (attached === el) return;
      detach();
      attached = el;
      el.addEventListener('error', onVideoError);
      el.addEventListener('playing', onPlaying);
      el.addEventListener('emptied', onPlaying);
      if (el.error !== null) scheduleVideo(el);
    };

    const scan = (): void => {
      const now = live();
      const el = findVideo(now.video, now.videoRef, hostRef.current);
      if (el !== null) attach(el);
      if (now.error != null || (now.reason !== undefined && now.reason !== null && now.reason !== '')) return;
      if (ignored()) return;
      const legacy = readLegacyError(root);
      if (legacy !== null) {
        commit(describePlaybackError(legacy));
        return;
      }
      if (el === null || el.error === null) {
        if (graceTimer === 0) commit(null);
      }
    };

    const onNative = (event: TvmNativePlayerEvent): void => {
      if (event.type !== 'error') return;
      commit(describePlaybackError(event.message) ?? COPY.native);
    };

    const onCustom = (raw: Event): void => {
      const detail = (raw as CustomEvent<string | { message?: string; reason?: string }>).detail;
      if (typeof detail === 'string') {
        commit(describePlaybackError(detail));
        return;
      }
      if (detail !== null && typeof detail === 'object') {
        commit(describePlaybackError(detail.reason ?? detail.message ?? null));
      }
    };

    scan();
    const pulse = window.setInterval(scan, 400);
    const observer = new MutationObserver(scan);
    if (root !== null) observer.observe(root, { subtree: true, childList: true, characterData: true });
    const offNative = window.tvmNativePlayer?.onEvent(onNative);
    window.addEventListener('tvm:playback-error', onCustom);

    return () => {
      clearGrace();
      detach();
      window.clearInterval(pulse);
      observer?.disconnect();
      offNative?.();
      window.removeEventListener('tvm:playback-error', onCustom);
    };
  }, [session.video, session.videoRef]);

  useLayoutEffect(() => {
    if (!visible || copy === null) return;
    const overlay = overlayRef.current;
    if (overlay === null) return;
    const restore = inertForeignSurfaces(overlay);
    const timer = window.setTimeout(() => requestFocus(retryKey), 0);
    return () => {
      window.clearTimeout(timer);
      restore();
    };
  }, [copy, retryKey, visible]);

  const retry = (): void => {
    ignoreUntil.current = Date.now() + RETRY_IGNORE_MS;
    setDetected(null);
    const host = overlayRef.current;
    if (session.retry !== undefined) {
      session.retry();
      return;
    }
    if (session.onRetry !== undefined) {
      session.onRetry();
      return;
    }
    if (clickForeignFocusId('retry', host) || clickForeignFocusId(PLAYBACK_ERROR_RETRY_ID, host)) return;
    const video = findVideo(session.video, session.videoRef, hostRef.current);
    if (video !== null) {
      video.load();
      void video.play().catch(() => undefined);
    }
    window.dispatchEvent(new CustomEvent('tvm:playback-retry'));
  };

  const back = (): void => {
    const host = overlayRef.current;
    if (session.close !== undefined) {
      session.close();
      return;
    }
    if (session.onBack !== undefined) {
      session.onBack();
      return;
    }
    if (clickForeignFocusId('close', host) || clickForeignFocusId('player-back', host)) return;
    navigate.pop();
  };

  if (!visible || copy === null) {
    return <span ref={(node) => { hostRef.current = node; }} hidden data-player-feature="error" />;
  }

  return (
    <div
      ref={(node) => {
        overlayRef.current = node;
        hostRef.current = node;
      }}
      className="player-error"
      data-player-feature="error"
      data-player-overlay="error"
      data-error-kind={copy.kind}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="player-error-title"
      aria-describedby="player-error-body"
    >
      <style href="tvm-player-error" precedence="player">
        {CSS}
      </style>
      <section className="error-state">
        <p className="stage__kicker">Playback</p>
        <h2 id="player-error-title" className="empty-state__title">
          {copy.title}
        </h2>
        <p id="player-error-body" className="page__lede">
          {copy.body}
        </p>
        <div className="hero__actions" data-wrap="x">
          <FocusButton id={PLAYBACK_ERROR_RETRY_ID} variant="primary" onSelect={retry}>
            Retry
          </FocusButton>
          <FocusButton id={PLAYBACK_ERROR_BACK_ID} onSelect={back}>
            Back
          </FocusButton>
          {copy.showPlans ? (
            <FocusButton id={PLAYBACK_ERROR_PLANS_ID} onSelect={() => navigate.push('plans')}>
              View plans
            </FocusButton>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default PlaybackError;
