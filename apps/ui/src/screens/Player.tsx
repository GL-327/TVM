import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestPlayback, saveProgress, type PlaybackResult } from '../data/media';
import { FALLBACK_PLAN, fetchPlan, tickUsage, type PlanStatus } from '../data/plan';
import { playbackErrorMessage } from '../data/playbackErrors';
import { useNavigate } from '../nav/ViewStackContext';
import { isLivePlayback, liveOverlayPolicy } from '../player/features/LiveOverlay';
import { TvmMark } from '../brand/TvmMark';
import { createPlayerEngine, type EngineStream, type PlayerEngine } from '../player/engine';
import { PlayerRoot, type PlayerSession } from '../player';
import type { ScreenProps } from '../nav/registry';

/**
 * Playback screen. Core resolves every title to a stream the browser is
 * guaranteed to play (probed, remuxed or transcoded server-side), so this
 * screen is only glue: resolve → attach engine → feed PlayerSession to the
 * chrome. No fallback cascades, no codec guessing, no external player.
 */
export function Player({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const streamRef = useRef<EngineStream | null>(null);
  const planRef = useRef<PlanStatus>(FALLBACK_PLAN);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const lastSaved = useRef(0);
  const lastTick = useRef(0);
  const billableRef = useRef(false);

  const [title, setTitle] = useState('Loading');
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hasFrame, setHasFrame] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [overlay, setOverlay] = useState<'queue' | 'ad' | null>('queue');
  const [queuePos, setQueuePos] = useState(12);
  const [skipRecap, setSkipRecap] = useState(false);
  const [badges, setBadges] = useState<string[]>([]);

  const id = typeof params['id'] === 'string' ? params['id'] : '';
  const live = isLivePlayback(id);
  const link = typeof params['link'] === 'string' ? params['link'] : '';
  const playbackTitle = typeof params['title'] === 'string' ? params['title'] : '';
  const playbackSeason = typeof params['season'] === 'number' ? params['season'] : undefined;
  const playbackEpisode = typeof params['episode'] === 'number' ? params['episode'] : undefined;

  const showControls = useCallback((): void => {
    window.dispatchEvent(new CustomEvent('tvm:user-activity'));
  }, []);

  const persist = useCallback(
    (nextPosition = positionRef.current, nextDuration = durationRef.current): void => {
      if (id === '' || live || !Number.isFinite(nextDuration) || nextDuration <= 0) return;
      void saveProgress(id, nextPosition, nextDuration);
    },
    [id, live],
  );

  const tick = useCallback((): void => {
    const now = Date.now();
    if (!billableRef.current || now - lastTick.current < 10_000) return;
    const elapsed = (now - lastTick.current) / 1000;
    lastTick.current = now;
    void tickUsage(elapsed, true).then((status) => {
      if (status.weeklyRemainingSeconds === 0) {
        billableRef.current = false;
        engineRef.current?.pause();
        setError(playbackErrorMessage('hours-cap'));
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    billableRef.current = false;
    setLoading(true);
    setBuffering(true);
    setHasFrame(false);
    setError(null);
    setOverlay('queue');
    setPosition(0);
    setDuration(0);
    let playReady = false;

    const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

    const runQueue = async (plan: PlanStatus, allowQueue: boolean): Promise<void> => {
      if (!allowQueue || plan.queueMs <= 0 || playReady) {
        setOverlay(null);
        return;
      }
      setOverlay('queue');
      if (plan.queueSkipToTop) {
        setQueuePos(12);
        await wait(400);
        if (cancelled || playReady) {
          setOverlay(null);
          return;
        }
        setQueuePos(1);
        await wait(plan.queueMs);
        return;
      }
      let pos = 12;
      setQueuePos(pos);
      const step = Math.max(400, Math.floor(plan.queueMs / 11));
      while (pos > 1 && !cancelled && !playReady) {
        await wait(step);
        pos -= 1;
        setQueuePos(pos);
      }
    };

    const playbackTask = requestPlayback({
      id: id === '' ? undefined : id,
      link: link === '' ? undefined : link,
      title: playbackTitle === '' ? undefined : playbackTitle,
      season: playbackSeason,
      episode: playbackEpisode,
    });

    const start = (stream: EngineStream): void => {
      const video = videoRef.current;
      if (video === null || cancelled) {
        window.requestAnimationFrame(() => start(stream));
        return;
      }
      engineRef.current?.destroy();
      streamRef.current = stream;
      setTitle(stream.title);
      setLoading(false);
      setError(null);
      video.volume = volume;
      video.muted = muted;
      const engine = createPlayerEngine(
        video,
        stream,
        { live, startAt: stream.startAt ?? 0 },
        {
          onTime: (nextPosition, nextDuration) => {
            positionRef.current = nextPosition;
            if (nextDuration > 0) durationRef.current = nextDuration;
            setPosition(nextPosition);
            if (nextDuration > 0) setDuration(nextDuration);
            const now = Date.now();
            if (now - lastSaved.current >= 10_000) {
              lastSaved.current = now;
              persist(nextPosition, nextDuration);
            }
            tick();
          },
          onPlayState: (isPaused) => {
            setPaused(isPaused);
            if (isPaused) persist();
          },
          onBuffering: setBuffering,
          onFirstFrame: () => setHasFrame(true),
          onEnded: () => {
            persist(durationRef.current, durationRef.current);
            navigate.pop();
          },
          onError: (message) => {
            setBuffering(false);
            setError(message);
          },
        },
      );
      engineRef.current = engine;
      engine.attach();
    };

    void (async () => {
      const plan = await fetchPlan();
      if (cancelled) return;
      planRef.current = plan;
      const policy = liveOverlayPolicy(id, plan.skipRecap);
      setSkipRecap(policy.skipRecap);
      setBadges(plan.badges);
      setTitle(playbackTitle !== '' ? playbackTitle : 'Loading');
      const queueTask = runQueue(plan, policy.queue);
      let result: PlaybackResult;
      try {
        result = await playbackTask;
      } catch {
        if (!cancelled) {
          setOverlay(null);
          setLoading(false);
          setBuffering(false);
          setError(playbackErrorMessage('network'));
        }
        return;
      }
      if (cancelled) return;
      if (result.kind !== 'stream') {
        setOverlay(null);
        setLoading(false);
        setBuffering(false);
        if (result.reason === 'not-configured' || result.reason === 'needs-auth') {
          navigate.pop();
          navigate.pushModal('notice', {
            params: {
              title: 'Real-Debrid',
              body: playbackErrorMessage(result.reason),
              action: 'tvm-stream',
            },
          });
          return;
        }
        setError(playbackErrorMessage(result.reason));
        return;
      }
      billableRef.current = true;
      lastTick.current = Date.now();
      playReady = true;
      start(result);
      setOverlay(null);
      await queueTask;
      if (!cancelled) setOverlay(null);
    })();

    return () => {
      cancelled = true;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
    // volume/muted are applied imperatively; restarting playback on those would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, id, link, live, navigate, persist, playbackEpisode, playbackSeason, playbackTitle, tick]);

  // A transcode that cannot produce its first segment must surface, not spin forever.
  useEffect(() => {
    if (!buffering || hasFrame || error !== null || loading) return;
    const timer = window.setTimeout(() => {
      setBuffering(false);
      setError('Playback stalled. The stream did not start. Press Retry, or Back to pick another file.');
    }, 45_000);
    return () => window.clearTimeout(timer);
  }, [buffering, error, hasFrame, loading]);

  const togglePlayback = useCallback((): void => {
    showControls();
    if (error === null) engineRef.current?.toggle();
  }, [error, showControls]);

  const play = useCallback((): void => {
    showControls();
    if (error === null) engineRef.current?.play();
  }, [error, showControls]);

  const pause = useCallback((): void => {
    showControls();
    engineRef.current?.pause();
  }, [showControls]);

  const seek = useCallback(
    (seconds: number): void => {
      showControls();
      engineRef.current?.seekBy(seconds);
    },
    [showControls],
  );

  const seekTo = useCallback(
    (seconds: number): void => {
      showControls();
      engineRef.current?.seekTo(seconds);
      positionRef.current = seconds;
      setPosition(seconds);
    },
    [showControls],
  );

  const adjustVolume = useCallback(
    (delta: number): void => {
      showControls();
      setVolume((current) => {
        const next = Math.max(0, Math.min(1, current + delta));
        engineRef.current?.setVolume(next);
        return next;
      });
      setMuted(false);
      engineRef.current?.setMuted(false);
    },
    [showControls],
  );

  const applyMuted = useCallback(
    (next: boolean): void => {
      setMuted(next);
      engineRef.current?.setMuted(next);
      showControls();
    },
    [showControls],
  );

  const close = useCallback((): void => {
    persist();
    navigate.pop();
  }, [navigate, persist]);

  const retry = useCallback((): void => {
    setError(null);
    setBuffering(true);
    setHasFrame(false);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    const onIntent = (raw: Event): void => {
      const intent = (raw as CustomEvent<string>).detail;
      showControls();
      if (intent === 'playPause') togglePlayback();
      if (intent === 'play') play();
      if (intent === 'pause') pause();
      if (intent === 'rewind') seek(-10);
      if (intent === 'fastForward') seek(10);
      if (intent === 'stop') close();
      if (intent === 'volumeUp') adjustVolume(0.1);
      if (intent === 'volumeDown') adjustVolume(-0.1);
      if (intent === 'mute') {
        setMuted((current) => {
          const next = !current;
          engineRef.current?.setMuted(next);
          return next;
        });
      }
    };
    window.addEventListener('tvm:media-intent', onIntent);
    return () => window.removeEventListener('tvm:media-intent', onIntent);
  }, [adjustVolume, close, pause, play, seek, showControls, togglePlayback]);

  const busy = loading || (buffering && !hasFrame);
  const session: PlayerSession = useMemo(
    () => ({
      videoRef,
      mediaId: id,
      title,
      season: playbackSeason,
      episode: playbackEpisode,
      engine: loading ? 'loading' : 'html5',
      paused,
      buffering,
      busy,
      error,
      position,
      duration,
      volume,
      muted,
      controlsVisible: true,
      skipRecap,
      badges,
      overlay,
      live,
      play,
      pause,
      togglePlayback,
      seek,
      seekTo,
      close,
      retry,
      showControls,
      adjustVolume,
      setMuted: applyMuted,
    }),
    [
      adjustVolume,
      applyMuted,
      badges,
      buffering,
      busy,
      close,
      duration,
      error,
      id,
      live,
      loading,
      muted,
      overlay,
      pause,
      paused,
      play,
      playbackEpisode,
      playbackSeason,
      position,
      retry,
      seek,
      seekTo,
      showControls,
      skipRecap,
      title,
      togglePlayback,
      volume,
    ],
  );

  return (
    <div
      className={`player player--html5${busy ? ' player--busy' : ''}${live ? ' player--live' : ''}`}
      data-player=""
      data-player-shell=""
      data-engine={loading ? 'loading' : 'html5'}
      data-live-mode={live ? 'true' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseMove={showControls}
    >
      <video ref={videoRef} className="player__video" data-player-video="" autoPlay playsInline preload="auto" />
      <PlayerRoot session={session} />
      {overlay === 'queue' && (
        <div className="player__queue" aria-live="polite">
          <TvmMark size="lg" animated loop className="player__queue-mark" />
          <p className="player__queue-kicker">TVM Cinema</p>
          <h2>Getting your stream ready</h2>
          <p>
            {planRef.current.queueSkipToTop
              ? 'Jumping you to the front of the line'
              : `You’re number ${queuePos}`}
          </p>
        </div>
      )}
      {overlay === 'ad' && (
        <div className="player__ad" aria-live="polite">
          <p className="player__queue-kicker">A short break</p>
          <h2>Advertisement</h2>
          <p>This does not use Free weekly watch hours.</p>
        </div>
      )}
    </div>
  );
}
