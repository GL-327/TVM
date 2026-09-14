import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestPlayback, saveProgress, type PlaybackResult } from '../data/media';
import { FALLBACK_PLAN, fetchPlan, tickUsage, type PlanStatus } from '../data/plan';
import { playbackErrorMessage } from '../data/playbackErrors';
import { useNavigate } from '../nav/ViewStackContext';
import { isLivePlayback, liveOverlayPolicy } from '../player/features/LiveOverlay';
import { TvmMark } from '../brand/TvmMark';
import { createPlayerEngine, type EngineStream, type PlayerEngine } from '../player/engine';
import { iosPlaybackBridge } from '../player/iosEngine';
import { PlayerRoot, type PlayerSession } from '../player';
import { playerShellClass, readPlayerLayout } from '../player/playerLayout';
import type { ScreenProps } from '../nav/registry';

/**
 * Playback screen. Core resolves and prepares the stream; the engine owns
 * bounded startup/recovery and the screen keeps Retry and Back reachable.
 */
export function Player({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const planRef = useRef<PlanStatus>(FALLBACK_PLAN);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const lastSaved = useRef(0);
  const lastTick = useRef(0);
  const billableRef = useRef(false);
  const audioRef = useRef({ volume: 1, muted: false });

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
  const [playbackEngine, setPlaybackEngine] = useState<PlayerSession['engine']>('loading');
  const [overlay, setOverlay] = useState<'queue' | 'ad' | null>('queue');
  const [skipRecap, setSkipRecap] = useState(false);
  const [badges, setBadges] = useState<string[]>([]);
  const [shell, setShell] = useState(() => playerShellClass(false, 'landscape'));
  audioRef.current = { volume, muted };

  const id = typeof params['id'] === 'string' ? params['id'] : '';
  const live = isLivePlayback(id);
  const link = typeof params['link'] === 'string' ? params['link'] : '';
  const playbackTitle = typeof params['title'] === 'string' ? params['title'] : '';
  const playbackSeason = typeof params['season'] === 'number' ? params['season'] : undefined;
  const playbackEpisode = typeof params['episode'] === 'number' ? params['episode'] : undefined;

  useEffect(() => {
    const sync = (): void => {
      const layout = readPlayerLayout();
      setShell(playerShellClass(layout.mobile, layout.orientation));
    };
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    window.visualViewport?.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      window.visualViewport?.removeEventListener('resize', sync);
    };
  }, []);

  const showControls = useCallback((): void => {
    window.dispatchEvent(new CustomEvent('tvm:user-activity'));
  }, []);

  const persist = useCallback(
    (nextPosition = positionRef.current, nextDuration = durationRef.current): void => {
      if (id === '' || live || !Number.isFinite(nextDuration) || nextDuration <= 0) return;
      void saveProgress(id, nextPosition, nextDuration).catch(() => undefined);
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
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const request = new AbortController();
    billableRef.current = false;
    setLoading(true);
    setPlaybackEngine('loading');
    setBuffering(true);
    setHasFrame(false);
    setError(null);
    setOverlay('queue');
    setPosition(0);
    setDuration(0);
    positionRef.current = 0;
    durationRef.current = 0;
    lastSaved.current = Date.now();
    let startFrame: number | null = null;

    const playbackTask = requestPlayback({
      id: id === '' ? undefined : id,
      link: link === '' ? undefined : link,
      title: playbackTitle === '' ? undefined : playbackTitle,
      season: playbackSeason,
      episode: playbackEpisode,
    }, request.signal);

    const start = (stream: EngineStream): void => {
      if (cancelled) return;
      const native = Boolean(iosPlaybackBridge());
      const video = videoRef.current;
      if (!native && video === null) {
        startFrame = window.requestAnimationFrame(() => start(stream));
        return;
      }
      engineRef.current?.destroy();
      setTitle(stream.title);
      setLoading(false);
      setPlaybackEngine(native ? 'native' : 'html5');
      setError(null);
      if (video !== null) {
        video.volume = audioRef.current.volume;
        video.muted = audioRef.current.muted;
      }
      const engine = createPlayerEngine(
        video ?? document.createElement('video'),
        native ? { ...stream, engine: 'native' } : stream,
        { live, startAt: stream.startAt ?? 0, maxHeight: planRef.current.maxHeight },
        {
          onTime: (nextPosition, nextDuration) => {
            positionRef.current = nextPosition;
            if (nextDuration > 0) durationRef.current = nextDuration;
            // The chrome clock displays whole seconds. Keep exact progress in
            // refs and let the progress control animate its own media events.
            setPosition(Math.floor(nextPosition));
            if (nextDuration > 0) setDuration(nextDuration);
            if (native && nextPosition > 0.4) setError(null);
            const now = Date.now();
            if (now - lastSaved.current >= 10_000) {
              lastSaved.current = now;
              persist(nextPosition, nextDuration);
            }
            tick();
          },
          onPlayState: (isPaused) => {
            billableRef.current = !live && !isPaused;
            lastTick.current = Date.now();
            setPaused(isPaused);
            if (isPaused) persist();
          },
          onBuffering: (waiting) => {
            lastTick.current = Date.now();
            setBuffering(waiting);
          },
          onFirstFrame: () => setHasFrame(true),
          onEnded: () => {
            persist(durationRef.current, durationRef.current);
            navigate.pop();
          },
          onClosed: () => { persist(); navigate.pop(); },
          onError: (message) => {
            billableRef.current = false;
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
      if (!policy.queue) setOverlay(null);
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
                action: 'realdebrid',
            },
          });
          return;
        }
        setError(playbackErrorMessage(result.reason));
        return;
      }
      lastTick.current = Date.now();
      start(result);
      setOverlay(null);
    })();

    return () => {
      cancelled = true;
      request.abort();
      billableRef.current = false;
      persist();
      if (startFrame !== null) window.cancelAnimationFrame(startFrame);
      engineRef.current?.destroy();
      engineRef.current = null;
    };
    // volume/muted are applied imperatively; restarting playback on those would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, id, link, live, navigate, persist, playbackEpisode, playbackSeason, playbackTitle, tick]);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;
    const syncAudio = (): void => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const saveWhenHidden = (): void => {
      if (document.visibilityState === 'hidden') persist();
    };
    const saveOnExit = (): void => persist();
    video.addEventListener('volumechange', syncAudio);
    document.addEventListener('visibilitychange', saveWhenHidden);
    window.addEventListener('pagehide', saveOnExit);
    return () => {
      video.removeEventListener('volumechange', syncAudio);
      document.removeEventListener('visibilitychange', saveWhenHidden);
      window.removeEventListener('pagehide', saveOnExit);
    };
  }, [persist]);

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
      if (live || !Number.isFinite(seconds)) return;
      engineRef.current?.seekTo(seconds);
      const total = durationRef.current;
      const target = Math.max(0, total > 0 ? Math.min(seconds, total - 1) : seconds);
      positionRef.current = target;
      setPosition(target);
    },
    [live, showControls],
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
      engine: loading ? 'loading' : playbackEngine,
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
      playbackEngine,
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
      className={`player player--${loading ? 'loading' : playbackEngine} ${shell}${busy ? ' player--busy' : ''}${live ? ' player--live' : ''}`}
      data-player=""
      data-player-shell=""
      data-engine={loading ? 'loading' : playbackEngine}
      data-live-mode={live ? 'true' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseMove={showControls}
    >
      <div className="player__stage" data-player-stage="">
        <video ref={videoRef} className="player__video" data-player-video="" playsInline preload="auto" />
      </div>
      <PlayerRoot session={session} />
      {overlay === 'queue' && (
        <div className="player__queue" aria-live="polite">
          <TvmMark size="lg" animated loop className="player__queue-mark" />
          <p className="player__queue-kicker">TVM Cinema</p>
          <h2>Getting your stream ready</h2>
          <p>Checking the source and preparing playback. Press Back to cancel.</p>
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
