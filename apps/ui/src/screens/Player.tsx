import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Hls from 'hls.js';
import { FocusButton } from '../components/FocusButton';
import {
  IconChevronLeft,
  IconForward,
  IconPause,
  IconPlay,
  IconRewind,
  IconVolume,
  IconVolumeMute,
} from '../components/Icons';
import { requestPlayback, saveProgress, type PlaybackResult } from '../data/media';
import { FALLBACK_PLAN, fetchPlan, tickUsage, type PlanStatus } from '../data/plan';
import { playbackErrorMessage } from '../data/playbackErrors';
import { revealFocused } from '../nav/revealFocused';
import { useNavigate, useScopedFocusKey } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

type StreamResult = Extract<PlaybackResult, { kind: 'stream' }>;
type Engine = 'loading' | 'html5' | 'native';

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const total = Math.floor(value);
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`;
}

function html5Playable(stream: StreamResult): boolean {
  if (stream.mimeType.includes('mpegurl') || stream.mimeType === 'video/mp4' || stream.mimeType === 'video/webm') {
    return true;
  }
  return /\.(m3u8|mp4|m4v|webm)(\?|$)/i.test(stream.url);
}

interface PlayerIconProps {
  id: string;
  label: string;
  disabled?: boolean;
  primary?: boolean;
  onSelect: () => void;
  onArrowPress?: (direction: string) => boolean;
  children: ReactNode;
}

function PlayerIcon({
  id,
  label,
  disabled = false,
  primary = false,
  onSelect,
  onArrowPress,
  children,
}: PlayerIconProps): React.JSX.Element {
  const focusKey = useScopedFocusKey(id);
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    focusable: !disabled,
    onArrowPress,
    onFocus: () => {
      const node = ref.current;
      if (node !== null) requestAnimationFrame(() => revealFocused(node));
    },
  });

  return (
    <button
      ref={ref}
      type="button"
      className={`player__icon${primary ? ' player__icon--primary' : ''}`}
      aria-label={label}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

export function Player({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSaved = useRef(0);
  const nativeStarted = useRef(false);
  const streamRef = useRef<StreamResult | null>(null);
  const startAtRef = useRef(0);
  const hideTimer = useRef<number | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const fallbackTried = useRef(false);
  const [title, setTitle] = useState('Loading');
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [loadProgress, setLoadProgress] = useState(8);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [engine, setEngine] = useState<Engine>('loading');
  const [attempt, setAttempt] = useState(0);
  const [overlay, setOverlay] = useState<'queue' | 'ad' | null>('queue');
  const [queuePos, setQueuePos] = useState(12);
  const [skipRecap, setSkipRecap] = useState(false);
  const [badges, setBadges] = useState<string[]>([]);
  const planRef = useRef<PlanStatus>(FALLBACK_PLAN);
  const billableRef = useRef(false);
  const lastTick = useRef(0);
  const id = typeof params['id'] === 'string' ? params['id'] : '';
  const link = typeof params['link'] === 'string' ? params['link'] : '';
  const playbackTitle = typeof params['title'] === 'string' ? params['title'] : '';
  const playbackSeason = typeof params['season'] === 'number' ? params['season'] : undefined;
  const playbackEpisode = typeof params['episode'] === 'number' ? params['episode'] : undefined;

  const scheduleHide = useCallback((): void => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    if (paused || error !== null || buffering) return;
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 3_200);
  }, [buffering, error, paused]);

  const showControls = useCallback((): void => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  const persist = useCallback(
    (nextPosition = positionRef.current, nextDuration = durationRef.current): void => {
      if (id === '' || id.startsWith('live:') || !Number.isFinite(nextDuration) || nextDuration <= 0) return;
      void saveProgress(id, nextPosition, nextDuration);
    },
    [id],
  );

  const destroyHls = useCallback((): void => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  const markReady = useCallback((): void => {
    setLoadProgress(100);
    setBuffering(false);
  }, []);

  const startNative = useCallback(
    async (stream: StreamResult, url = stream.fallbackUrl ?? stream.url): Promise<void> => {
      destroyHls();
      const bridge = window.tvmNativePlayer;
      if (bridge === undefined) {
        setEngine('native');
        setBuffering(false);
        setError('This file needs a converted stream. Real-Debrid could not provide one, and mpv is not installed.');
        return;
      }
      const video = videoRef.current;
      if (video !== null) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      setEngine('native');
      setBuffering(true);
      setLoadProgress(70);
      setError(null);
      nativeStarted.current = true;
      try {
        await bridge.start({ url, title: stream.title, startAt: startAtRef.current || undefined });
        setLoadProgress(82);
      } catch {
        nativeStarted.current = false;
        setBuffering(false);
        setError('TVM could not start native playback. Check that mpv is installed, then retry.');
      }
    },
    [destroyHls],
  );

  const startHtml5 = useCallback(
    (stream: StreamResult): void => {
      const video = videoRef.current;
      if (video === null) {
        window.requestAnimationFrame(() => startHtml5(stream));
        return;
      }
      destroyHls();
      setEngine('html5');
      setError(null);
      setBuffering(true);
      setLoadProgress(62);
      video.volume = volume;
      video.muted = muted;
      const hlsSource = stream.mimeType.includes('mpegurl') || /\.m3u8(\?|$)/i.test(stream.url);
      if (hlsSource && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
        hlsRef.current = hls;
        hls.loadSource(stream.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          const cap = planRef.current.maxHeight;
          const capped = hls.levels.reduce((max, level, index) => {
            if (typeof level.height === 'number' && level.height > cap) return max;
            return index;
          }, 0);
          hls.autoLevelCapping = capped;
          if (planRef.current.startDelayMs >= 4000) hls.currentLevel = 0;
          setLoadProgress(78);
          void video.play().catch(() => {
            fallbackTried.current = true;
            void startNative(stream);
          });
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            fallbackTried.current = true;
            void startNative(stream);
          }
        });
        return;
      }
      video.src = stream.url;
      video.load();
      void video.play().catch(() => {
        fallbackTried.current = true;
        void startNative(stream);
      });
    },
    [destroyHls, muted, startNative, volume],
  );

  const startStream = useCallback(
    (stream: StreamResult): void => {
      streamRef.current = stream;
      setTitle(stream.title);
      setLoadProgress(48);
      if (stream.engine === 'native' || !html5Playable(stream)) void startNative(stream, stream.url);
      else startHtml5(stream);
    },
    [startHtml5, startNative],
  );

  const startStreamRef = useRef(startStream);
  startStreamRef.current = startStream;

  useEffect(() => {
    let cancelled = false;
    fallbackTried.current = false;
    billableRef.current = false;
    setEngine('loading');
    setBuffering(true);
    setLoadProgress(12);
    setOverlay('queue');

    const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

    const runQueue = async (plan: PlanStatus): Promise<void> => {
      if (id.startsWith('live:') || plan.queueMs <= 0) {
        setOverlay(null);
        return;
      }
      setOverlay('queue');
      if (plan.queueSkipToTop) {
        setQueuePos(12);
        await wait(400);
        if (cancelled) return;
        setQueuePos(1);
        await wait(plan.queueMs);
        return;
      }
      let pos = 12;
      setQueuePos(pos);
      const step = Math.max(400, Math.floor(plan.queueMs / 11));
      while (pos > 1 && !cancelled) {
        await wait(step);
        pos -= 1;
        setQueuePos(pos);
      }
    };

    const runAd = async (plan: PlanStatus): Promise<void> => {
      if (id.startsWith('live:') || !plan.ads) return;
      try {
        const response = await fetch('/api/ads/preroll');
        if (!response.ok) return;
        const body = (await response.json()) as { url?: string };
        if (typeof body.url !== 'string' || body.url === '') return;
        const adUrl = body.url;
        setOverlay('ad');
        const video = videoRef.current;
        if (video === null) return;
        await new Promise<void>((resolve) => {
          const done = (): void => {
            video.removeEventListener('ended', done);
            video.removeEventListener('error', done);
            resolve();
          };
          video.addEventListener('ended', done);
          video.addEventListener('error', done);
          video.src = adUrl;
          video.load();
          void video.play().catch(done);
        });
      } catch {
        // Content still plays if the sample tag is unreachable.
      }
    };

    void (async () => {
      const plan = await fetchPlan();
      if (cancelled) return;
      planRef.current = plan;
      setSkipRecap(plan.skipRecap);
      setBadges(plan.badges);
      await runQueue(plan);
      if (cancelled) return;
      await runAd(plan);
      if (cancelled) return;
      if (plan.startDelayMs > 0) await wait(plan.startDelayMs);
      if (cancelled) return;
      setOverlay(null);
      try {
        const result = await requestPlayback({
          id: id === '' ? undefined : id,
          link: link === '' ? undefined : link,
          title: playbackTitle === '' ? undefined : playbackTitle,
          season: playbackSeason,
          episode: playbackEpisode,
        });
        if (cancelled) return;
        if (result.kind !== 'stream') {
          if (result.reason === 'hours-cap') {
            setBuffering(false);
            setError(playbackErrorMessage(result.reason));
            return;
          }
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
          setBuffering(false);
          setError(playbackErrorMessage(result.reason));
          return;
        }
        startAtRef.current = result.startAt ?? 0;
        billableRef.current = true;
        lastTick.current = Date.now();
        startStreamRef.current(result);
      } catch {
        if (!cancelled) {
          setBuffering(false);
          setError(playbackErrorMessage('network'));
        }
      }
    })();

    return () => {
      cancelled = true;
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      destroyHls();
      const video = videoRef.current;
      if (video !== null) video.pause();
      if (nativeStarted.current) void window.tvmNativePlayer?.stop();
    };
  }, [attempt, destroyHls, id, link, navigate, playbackEpisode, playbackSeason, playbackTitle]);

  useEffect(() => {
    const bridge = window.tvmNativePlayer;
    if (bridge === undefined) return;
    return bridge.onEvent((event) => {
      if (!nativeStarted.current) return;
      if (event.type === 'started') {
        setBuffering(true);
        setLoadProgress(88);
        return;
      }
      if (event.type === 'state') {
        setPaused(event.paused);
        setBuffering(event.buffering);
        if (!event.buffering && event.duration > 0) markReady();
        positionRef.current = event.position;
        durationRef.current = event.duration;
        setPosition(event.position);
        setDuration(event.duration);
        const now = Date.now();
        if (now - lastSaved.current >= 10_000) {
          lastSaved.current = now;
          persist(event.position, event.duration);
        }
        if (billableRef.current && now - lastTick.current >= 10_000) {
          const elapsed = (now - lastTick.current) / 1000;
          lastTick.current = now;
          void tickUsage(elapsed, true).then((status) => {
            if (status.weeklyRemainingSeconds === 0) {
              billableRef.current = false;
              setError(playbackErrorMessage('hours-cap'));
              void window.tvmNativePlayer?.command('pause');
            }
          });
        }
        return;
      }
      if (event.type === 'error') {
        setBuffering(false);
        setError(event.message);
        return;
      }
      if (event.type === 'ended' || event.type === 'closed') {
        nativeStarted.current = false;
        persist();
        navigate.pop();
      }
    });
  }, [markReady, navigate, persist]);

  useEffect(() => {
    if (!buffering || error !== null) return;
    const ms = engine === 'html5' ? 10_000 : engine === 'native' ? 18_000 : 22_000;
    const timer = window.setTimeout(() => {
      const stream = streamRef.current;
      if (engine === 'html5' && stream !== null && !fallbackTried.current) {
        fallbackTried.current = true;
        void startNative(stream);
        return;
      }
      if (engine === 'loading') return;
      setBuffering(false);
      setError('Playback stalled. The stream did not start. Press Retry, or Back to pick another file.');
    }, ms);
    return () => window.clearTimeout(timer);
  }, [buffering, engine, error, startNative]);

  const togglePlayback = useCallback((): void => {
    showControls();
    if (engine === 'loading' || error !== null) return;
    if (engine === 'native') {
      void window.tvmNativePlayer?.command('togglePause');
      return;
    }
    const video = videoRef.current;
    if (video === null || engine !== 'html5') return;
    if (video.paused) void video.play();
    else video.pause();
  }, [engine, error, showControls]);

  const seek = useCallback(
    (seconds: number): void => {
      showControls();
      if (engine === 'native') {
        void window.tvmNativePlayer?.command(seconds < 0 ? 'seekBack' : 'seekForward');
        return;
      }
      const video = videoRef.current;
      if (video === null) return;
      video.currentTime = Math.max(0, Math.min(video.duration || Number.POSITIVE_INFINITY, video.currentTime + seconds));
    },
    [engine, showControls],
  );

  const adjustVolume = useCallback(
    (delta: number): void => {
      const next = Math.max(0, Math.min(1, volume + delta));
      setVolume(next);
      setMuted(false);
      const video = videoRef.current;
      if (video !== null) {
        video.volume = next;
        video.muted = false;
      }
      showControls();
    },
    [showControls, volume],
  );

  useEffect(() => {
    const onIntent = (raw: Event): void => {
      const intent = (raw as CustomEvent<string>).detail;
      showControls();
      if (intent === 'playPause') togglePlayback();
      if (intent === 'play') {
        if (engine === 'native') void window.tvmNativePlayer?.command('play');
        else void videoRef.current?.play();
      }
      if (intent === 'pause') {
        if (engine === 'native') void window.tvmNativePlayer?.command('pause');
        else videoRef.current?.pause();
      }
      if (intent === 'rewind') seek(-10);
      if (intent === 'fastForward') seek(10);
      if (intent === 'stop') {
        persist();
        nativeStarted.current = false;
        if (engine === 'native') void window.tvmNativePlayer?.stop();
        navigate.pop();
      }
      if (intent === 'volumeUp') adjustVolume(0.1);
      if (intent === 'volumeDown') adjustVolume(-0.1);
      if (intent === 'mute') {
        setMuted((current) => {
          const next = !current;
          if (videoRef.current !== null) videoRef.current.muted = next;
          return next;
        });
      }
    };
    const onActivity = (): void => showControls();
    window.addEventListener('tvm:media-intent', onIntent);
    window.addEventListener('tvm:user-activity', onActivity);
    return () => {
      window.removeEventListener('tvm:media-intent', onIntent);
      window.removeEventListener('tvm:user-activity', onActivity);
    };
  }, [adjustVolume, engine, navigate, persist, seek, showControls, togglePlayback]);

  useEffect(() => scheduleHide(), [scheduleHide]);

  const close = (): void => {
    persist();
    nativeStarted.current = false;
    if (engine === 'native') void window.tvmNativePlayer?.stop();
    navigate.pop();
  };

  const retry = (): void => {
    fallbackTried.current = false;
    setError(null);
    setBuffering(true);
    setLoadProgress(16);
    const stream = streamRef.current;
    if (stream !== null) {
      startStream(stream);
      return;
    }
    setAttempt((value) => value + 1);
  };

  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const busy = buffering || engine === 'loading';
  const loaderWidth = busy ? Math.min(96, Math.max(loadProgress, 8)) : 100;

  return (
    <div
      className={`player player--${engine}${busy ? ' player--busy' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseMove={showControls}
    >
      <video
        ref={videoRef}
        className="player__video"
        autoPlay
        playsInline
        preload="auto"
        onLoadedMetadata={(event) => {
          durationRef.current = event.currentTarget.duration;
          setDuration(event.currentTarget.duration);
          const startAt = startAtRef.current;
          if (startAt > 0 && Number.isFinite(event.currentTarget.duration) && startAt < event.currentTarget.duration - 2) {
            event.currentTarget.currentTime = startAt;
            positionRef.current = startAt;
            setPosition(startAt);
          }
          setLoadProgress(86);
        }}
        onPlaying={() => {
          setPaused(false);
          markReady();
        }}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => {
          setLoadProgress((current) => Math.max(current, 90));
          setBuffering(false);
        }}
        onPlay={() => setPaused(false)}
        onPause={() => {
          setPaused(true);
          persist(videoRef.current?.currentTime ?? position, videoRef.current?.duration ?? duration);
        }}
        onEnded={() => {
          persist(videoRef.current?.duration ?? duration, videoRef.current?.duration ?? duration);
          navigate.pop();
        }}
        onTimeUpdate={(event) => {
          const nextPosition = event.currentTarget.currentTime;
          const nextDuration = event.currentTarget.duration;
          positionRef.current = nextPosition;
          durationRef.current = nextDuration;
          setPosition(nextPosition);
          if (Number.isFinite(nextDuration)) setDuration(nextDuration);
          const now = Date.now();
          if (now - lastSaved.current < 10_000) return;
          lastSaved.current = now;
          persist(nextPosition, nextDuration);
          if (billableRef.current && now - lastTick.current >= 10_000) {
            const elapsed = (now - lastTick.current) / 1000;
            lastTick.current = now;
            void tickUsage(elapsed, true).then((status) => {
              if (status.weeklyRemainingSeconds === 0) {
                billableRef.current = false;
                event.currentTarget.pause();
                setError(playbackErrorMessage('hours-cap'));
              }
            });
          }
        }}
        onError={() => {
          const stream = streamRef.current;
          if (stream !== null && engine === 'html5' && !fallbackTried.current) {
            fallbackTried.current = true;
            void startNative(stream);
          }
        }}
      />
      {overlay === 'queue' && (
        <div className="player__queue" aria-live="polite">
          <h2>You’re in the queue</h2>
          <p>{planRef.current.queueSkipToTop ? 'Always skipping to the top…' : `Position ${queuePos}`}</p>
        </div>
      )}
      {overlay === 'ad' && (
        <div className="player__ad" aria-live="polite">
          <h2>Advertisement</h2>
          <p>This does not use Free weekly watch hours.</p>
        </div>
      )}
      {busy && overlay === null && (
        <div className="player__loader" aria-live="polite">
          <p className="player__loader-label">{engine === 'loading' ? 'Preparing stream…' : 'Loading…'}</p>
          <div className="player__loader-track" aria-label="Loading playback">
            <span className="player__loader-bar" style={{ width: `${loaderWidth}%` }} />
          </div>
        </div>
      )}
      <div className={`player__chrome${controlsVisible || busy || error !== null ? '' : ' player__chrome--hidden'}`}>
        <div className="player__top">
          <PlayerIcon id="close" label="Back" onSelect={close}>
            <IconChevronLeft className="player__glyph" />
          </PlayerIcon>
          <p className="player__title">
            {title}
            {badges.length > 0 ? <span className="player__badges">{badges.join(' · ')}</span> : null}
          </p>
        </div>
        {error !== null && (
          <div className="player__error-block">
            <p className="player__error">{error}</p>
            {error.includes('watch hours') && (
              <FocusButton id="hours-plans" variant="primary" onSelect={() => navigate.push('plans')}>
                View plans
              </FocusButton>
            )}
          </div>
        )}
        <div className="player__bottom">
          <div className="player__seek-row">
            <span className="player__time">{formatTime(position)}</span>
            <PlayerIcon
              id="seek"
              label="Seek"
              disabled={engine === 'loading' || error !== null}
              onSelect={() => seek(10)}
              onArrowPress={(direction) => {
                if (direction === 'left') {
                  seek(-10);
                  return false;
                }
                if (direction === 'right') {
                  seek(10);
                  return false;
                }
                return true;
              }}
            >
              <span className="player__seek" aria-hidden="true">
                <span className="player__seek-fill" style={{ width: `${progress * 100}%` }} />
                <span className="player__seek-thumb" style={{ left: `${progress * 100}%` }} />
              </span>
            </PlayerIcon>
            <span className="player__time">{formatTime(duration)}</span>
          </div>
          <div className="player__bar">
            <div className="player__vol">
              <PlayerIcon
                id="mute"
                label={muted ? 'Unmute' : 'Volume'}
                disabled={engine !== 'html5'}
                onSelect={() => {
                  const next = !muted;
                  setMuted(next);
                  if (videoRef.current !== null) videoRef.current.muted = next;
                  showControls();
                }}
                onArrowPress={(direction) => {
                  if (direction === 'left') {
                    adjustVolume(-0.1);
                    return false;
                  }
                  if (direction === 'right') {
                    adjustVolume(0.1);
                    return false;
                  }
                  return true;
                }}
              >
                {muted || volume === 0 ? (
                  <IconVolumeMute className="player__glyph" />
                ) : (
                  <IconVolume className="player__glyph" />
                )}
              </PlayerIcon>
              <span className="player__vol-track" aria-hidden="true">
                <span className="player__vol-fill" style={{ width: `${muted ? 0 : volume * 100}%` }} />
              </span>
            </div>
            <div className="player__tools">
              <PlayerIcon
                id="back-10"
                label="Back 10 seconds"
                disabled={engine === 'loading' || error !== null}
                onSelect={() => seek(-10)}
              >
                <IconRewind className="player__glyph" />
              </PlayerIcon>
              <PlayerIcon
                id="pause"
                label={paused ? 'Play' : 'Pause'}
                primary
                onSelect={togglePlayback}
              >
                {paused ? <IconPlay className="player__glyph" /> : <IconPause className="player__glyph" />}
              </PlayerIcon>
              <PlayerIcon
                id="fwd-10"
                label="Forward 10 seconds"
                disabled={engine === 'loading' || error !== null}
                onSelect={() => seek(10)}
              >
                <IconForward className="player__glyph" />
              </PlayerIcon>
              {skipRecap && overlay === null && engine === 'html5' && error === null && position < 90 && (
                <FocusButton
                  id="skip-recap"
                  variant="primary"
                  onSelect={() => {
                    const video = videoRef.current;
                    if (video === null) return;
                    const target = Math.min(Number.isFinite(video.duration) ? video.duration : 90, 90);
                    video.currentTime = Math.max(target, video.currentTime + 1);
                    showControls();
                  }}
                >
                  Skip recap
                </FocusButton>
              )}
              {error !== null && (
                <FocusButton id="retry" variant="primary" onSelect={retry}>
                  Retry
                </FocusButton>
              )}
              {engine === 'native' && <span className="player__engine">mpv</span>}
              {engine === 'html5' && <span className="player__engine">html5</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
