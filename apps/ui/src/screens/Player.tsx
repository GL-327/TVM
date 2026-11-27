import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clampVolume, readAudioPrefs, restoredAudio, writeAudioPrefs } from '../player/audioPrefs';
import { applyBoostedVolume } from '../player/audioGain';
import { fetchExtrasSegments, fetchExtrasSubtitles, isAnimeCandidate, type ExtrasSegments } from '../data/extras';
import { freeChannelErrorCopy } from '../data/freeLive';
import { apiFetch, requestPlayback, saveProgress, type PlaybackResult, type PlaybackSubtitle } from '../data/media';
import { imdbIdFrom } from '../data/playId';
import { hydratePrefs, readPrefs } from '../data/prefs';
import { FALLBACK_PLAN, fetchPlan, tickUsage, type PlanStatus } from '../data/plan';
import { playbackErrorMessage } from '../data/playbackErrors';
import { useNavigate } from '../nav/ViewStackContext';
import { isLivePlayback, liveOverlayPolicy } from '../player/features/LiveOverlay';
import { GoLive, GO_LIVE_CSS, useLiveDrift } from '../player/features/GoLive';
import { OrbitLoader } from '../components/OrbitLoader';
import { extraEnabled, readPolishPrefs } from '../data/polishPrefs';
import { nativeAudioLanguage } from '../player/audioLanguage';
import { useExtraPrefs } from '../data/uiExtras';
import { FranchiseIntro, introSkippedForAutomation, markIntroPlayed, planIntro, type IntroPick } from '../intros';
import { createPlayerEngine, type EngineStream, type PlayerEngine } from '../player/engine';
import { nativePlaybackBridge } from '../player/iosEngine';
import { attachedHls } from '../player/hlsBridge';
import { PlayerRoot, type PlayerSession } from '../player';
import { playbackMaxHeight, readDeviceChrome } from '../nav/deviceChrome';
import { effectiveStreamMaxHeight, screenTargetHeight } from '../player/quality';
import { playerShellClass, readPlayerLayout } from '../player/playerLayout';
import type { ScreenProps } from '../nav/registry';

/**
 * Playback screen. Core resolves and prepares the stream; the engine owns
 * bounded startup/recovery and the screen keeps Retry and Back reachable.
 */
export function Player({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const prefs = useExtraPrefs();
  const onlineSubtitles = extraEnabled('onlineSubtitles', prefs);
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const planRef = useRef<PlanStatus>(FALLBACK_PLAN);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const lastSaved = useRef(0);
  const lastTick = useRef(0);
  const billableRef = useRef(false);
  const retryAt = useRef<number | undefined>(undefined);
  const recoveries = useRef(0);
  const mediaKey = useRef('');
  // Seeded once from storage: the level the room was last left at.
  const storedAudio = useRef(restoredAudio(readAudioPrefs()));
  const audioRef = useRef({ volume: storedAudio.current.volume, muted: storedAudio.current.muted });

  const [title, setTitle] = useState('Loading');
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hasFrame, setHasFrame] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => storedAudio.current.volume);
  const [muted, setMuted] = useState(() => storedAudio.current.muted);
  const [attempt, setAttempt] = useState(0);
  const [playbackEngine, setPlaybackEngine] = useState<PlayerSession['engine']>('loading');
  const [overlay, setOverlay] = useState<'queue' | 'ad' | null>('queue');
  const [skipRecap, setSkipRecap] = useState(false);
  const [badges, setBadges] = useState<string[]>([]);
  const [segments, setSegments] = useState<ExtrasSegments | null>(null);
  const [streamSubtitles, setStreamSubtitles] = useState<PlaybackSubtitle[]>([]);
  const [intro, setIntro] = useState<IntroPick | null>(null);
  const introGate = useRef<(() => void) | null>(null);
  const [shell, setShell] = useState(() => playerShellClass(false, 'landscape'));
  audioRef.current = { volume, muted };

  const paramId = typeof params['id'] === 'string' ? params['id'] : '';
  const paramLink = typeof params['link'] === 'string' ? params['link'] : '';
  const paramTitle = typeof params['title'] === 'string' ? params['title'] : '';
  const paramGeo = typeof params['channelGeo'] === 'string' ? params['channelGeo'] : null;
  const paramGenres = useMemo(
    () => (Array.isArray(params['genres']) ? params['genres'].filter((g): g is string => typeof g === 'string') : []),
    [params],
  );
  const paramAnime = params['anime'] === true;
  const freeQueue = useMemo(() => {
    const raw = params['freeQueue'];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item): item is { id: string; name: string; url: string; geo?: string | null } =>
        typeof item === 'object' && item !== null && typeof item.id === 'string' && typeof item.url === 'string',
    );
  }, [params]);
  const [channelOverride, setChannelOverride] = useState<{
    id: string;
    name: string;
    url: string;
    geo?: string | null;
  } | null>(null);

  useEffect(() => {
    setChannelOverride(null);
  }, [paramId, paramLink]);

  const id = channelOverride?.id ?? paramId;
  const live = isLivePlayback(id);
  const link = channelOverride?.url ?? paramLink;
  const playbackTitle = channelOverride?.name ?? paramTitle;
  const channelGeo = channelOverride !== null ? (channelOverride.geo ?? null) : paramGeo;
  const isFreeChannel = id.startsWith('live:free:');
  const nextFreeChannel = useMemo(() => {
    if (freeQueue.length === 0) return null;
    const idx = freeQueue.findIndex((item) => item.id === id);
    if (idx < 0 || freeQueue.length < 2) return freeQueue[0]?.id !== id ? (freeQueue[0] ?? null) : null;
    return freeQueue[(idx + 1) % freeQueue.length] ?? null;
  }, [freeQueue, id]);
  const playbackSeason = typeof params['season'] === 'number' ? params['season'] : undefined;
  const playbackEpisode = typeof params['episode'] === 'number' ? params['episode'] : undefined;

  useEffect(() => {
    void hydratePrefs();
  }, []);

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
    // A franchise film plays its intro over this loading phase; the stream starts once it ends.
    let introReady: Promise<void> = Promise.resolve();
    const introPick = planIntro({
      id, title: playbackTitle, live,
      enabled: extraEnabled('franchiseIntros'), automation: introSkippedForAutomation(),
    });
    if (introPick !== null) {
      introReady = new Promise<void>((resolve) => { introGate.current = resolve; });
      setIntro((prev) => (prev?.titleKey === introPick.titleKey ? prev : introPick));
    } else {
      introGate.current = null;
    }
    setSegments(null);
    setStreamSubtitles([]);
    const key = `${id}|${link}`;
    if (mediaKey.current !== key) {
      mediaKey.current = key;
      retryAt.current = undefined;
      recoveries.current = 0;
      positionRef.current = 0;
      durationRef.current = 0;
    }
    setPosition(retryAt.current ?? 0);
    setDuration(durationRef.current);
    lastSaved.current = Date.now();
    let startFrame: number | null = null;
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;

    const playbackTask = requestPlayback({
      id: id === '' ? undefined : id,
      link: link === '' ? undefined : link,
      title: playbackTitle === '' ? undefined : playbackTitle,
      season: playbackSeason,
      episode: playbackEpisode,
      startAt: retryAt.current,
      native: !live && nativePlaybackBridge() !== undefined,
      screenHeight: screenTargetHeight(),
    }, request.signal);

    const start = (stream: EngineStream): void => {
      if (cancelled) return;
      const native = nativePlaybackBridge() !== undefined;
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
        const res = applyBoostedVolume(video, audioRef.current.volume, audioRef.current.muted, !native);
        if (res.applied !== audioRef.current.volume) {
          audioRef.current.volume = res.applied;
          setVolume(res.applied);
        }
        video.muted = audioRef.current.muted;
      }
      const planCap = playbackMaxHeight(planRef.current.maxHeight, readDeviceChrome().maxHeight);
      const engine = createPlayerEngine(
        video ?? document.createElement('video'),
        native ? { ...stream, engine: 'native' } : stream,
        {
          live,
          startAt: stream.startAt ?? 0,
          maxHeight: effectiveStreamMaxHeight(planCap, screenTargetHeight()),
          initialVolume: audioRef.current.volume,
          initialMuted: audioRef.current.muted,
          audioLanguage: nativeAudioLanguage(readPolishPrefs().audioLanguage, stream.originalLanguage),
        },
        {
          onTime: (nextPosition, nextDuration) => {
            if (cancelled) return;
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
            if (cancelled) return;
            billableRef.current = !live && !isPaused;
            lastTick.current = Date.now();
            setPaused(isPaused);
            if (isPaused) persist();
          },
          onBuffering: (waiting) => {
            if (cancelled) return;
            lastTick.current = Date.now();
            setBuffering(waiting);
          },
          onFirstFrame: () => { if (!cancelled) setHasFrame(true); },
          onEnded: () => {
            /*
             * A live channel that ends did not finish; it stopped.
             *
             * Treating the two the same closed the player and dropped the
             * viewer back on the channel list with no explanation, which reads
             * as a crash. It is reachable today: pressing "Back to live" lands
             * three seconds short of the edge, and if the feed is not actually
             * advancing — an off-air channel, a dead upstream, or a provider
             * serving a finite file as a channel — those three seconds run out
             * and the stream ends.
             *
             * Say so and stay put, so the viewer can retry the channel or pick
             * another one instead of guessing what happened.
             */
            if (live) {
              setBuffering(false);
              setError('This channel stopped broadcasting. Try it again, or choose another channel.');
              return;
            }
            persist(durationRef.current, durationRef.current);
            const endedEvent = new CustomEvent('tvm:playback-ended', { cancelable: true });
            window.dispatchEvent(endedEvent);
            if (!endedEvent.defaultPrevented) navigate.pop();
          },
          onClosed: () => { persist(); navigate.pop(); },
          onError: (message) => {
            if (cancelled || recoveryTimer !== null) return;
            billableRef.current = false;
            if (!live && recoveries.current < 2 && !/not installed|browser blocked|not.*device/i.test(message)) {
              recoveries.current += 1;
              retryAt.current = positionRef.current > 0 ? positionRef.current : stream.startAt ?? 0;
              setLoading(true);
              setBuffering(true);
              setError(null);
              // Retire the failed conversion before resolving again. Reusing
              // its still-running session reproduced the same first error.
              const stop = stream.sessionId ? apiFetch(`/api/stream/hls/${stream.sessionId}/stop`, { method: 'POST' }).catch(() => undefined) : Promise.resolve();
              recoveryTimer = setTimeout(() => {
                void stop.finally(() => { if (!cancelled) setAttempt((value) => value + 1); });
              }, 700);
              return;
            }
            setBuffering(false);
            setError(isFreeChannel ? freeChannelErrorCopy(playbackTitle, channelGeo) : message);
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
        if (isFreeChannel && link.startsWith('http')) {
          result = {
            kind: 'stream',
            url: link,
            title: playbackTitle || 'Live channel',
            filename: 'live.m3u8',
            mimeType: 'application/vnd.apple.mpegurl',
            engine: nativePlaybackBridge() !== undefined ? 'native' : 'html5',
            transport: 'hls',
          };
        } else {
          if (!cancelled) {
            setOverlay(null);
            setLoading(false);
            setBuffering(false);
            setError(isFreeChannel ? freeChannelErrorCopy(playbackTitle, channelGeo) : playbackErrorMessage('network'));
          }
          return;
        }
      }
      if (cancelled) return;
      if (result.kind !== 'stream') {
        if (isFreeChannel && link.startsWith('http')) {
          lastTick.current = Date.now();
          start({
            kind: 'stream',
            url: link,
            title: playbackTitle || 'Live channel',
            filename: 'live.m3u8',
            mimeType: 'application/vnd.apple.mpegurl',
            engine: nativePlaybackBridge() !== undefined ? 'native' : 'html5',
            transport: 'hls',
          });
          setOverlay(null);
          return;
        }
        if (!live && recoveries.current < 2 && ['network', 'timeout', 'empty', 'unsupported'].includes(result.reason)) {
          recoveries.current += 1;
          recoveryTimer = setTimeout(() => { if (!cancelled) setAttempt((value) => value + 1); }, 1000);
          return;
        }
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
        setError(isFreeChannel ? freeChannelErrorCopy(playbackTitle, channelGeo) : playbackErrorMessage(result.reason));
        return;
      }
      lastTick.current = Date.now();
      const initialSubs = Array.isArray(result.subtitles) ? result.subtitles : [];
      setStreamSubtitles(initialSubs);
      const hasResolvedSegments =
        result.segments != null &&
        (result.segments.source !== null ||
          result.segments.intro !== null ||
          result.segments.recap !== null ||
          result.segments.credits !== null);
      if (hasResolvedSegments) setSegments(result.segments ?? null);

      if (!live) {
        const imdb = imdbIdFrom(id);
        const anime = isAnimeCandidate(paramGenres, paramAnime);
        if (!hasResolvedSegments && (imdb !== null || playbackTitle !== '')) {
          void fetchExtrasSegments(
            {
              id: imdb ?? id,
              season: playbackSeason,
              episode: playbackEpisode,
              title: playbackTitle,
              anime,
            },
            request.signal,
          ).then((loaded) => {
            if (!cancelled && loaded !== null) setSegments(loaded);
          });
        }
        if (imdb !== null && extraEnabled('onlineSubtitles', readPrefs())) {
          void fetchExtrasSubtitles(
            { id: imdb, season: playbackSeason, episode: playbackEpisode },
            request.signal,
          ).then((extraSubs) => {
            if (cancelled || extraSubs === null || extraSubs.length === 0) return;
            setStreamSubtitles((prev) => {
              const seen = new Set(prev.map((item) => item.url));
              const merged = [...prev];
              for (const sub of extraSubs) {
                if (!seen.has(sub.url)) {
                  seen.add(sub.url);
                  merged.push(sub);
                }
              }
              return merged;
            });
          });
        }
      }

      await introReady;
      if (cancelled) return;
      start(result);
      setOverlay(null);
    })();

    return () => {
      cancelled = true;
      introGate.current?.();
      request.abort();
      billableRef.current = false;
      persist();
      if (startFrame !== null) window.cancelAnimationFrame(startFrame);
      if (recoveryTimer !== null) clearTimeout(recoveryTimer);
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
      // Preserve logical gain (> 100%) when element.volume saturates at 1.0.
      const logical = !(audioRef.current.volume > 1 && video.volume >= 0.99)
        ? video.volume
        : audioRef.current.volume;
      audioRef.current = { volume: logical, muted: video.muted };
      setVolume(logical);
      setMuted(video.muted);
      writeAudioPrefs({ volume: logical, muted: video.muted });
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

  // How far behind the broadcast we have fallen, and the one seek that undoes it.
  const drift = useLiveDrift(live, useCallback(() => engineRef.current?.liveDrift() ?? 0, []));
  const goLive = useCallback((): void => {
    engineRef.current?.goLive();
    showControls();
  }, [showControls]);

  const applyVolume = useCallback(
    (value: number): void => {
      const cap = playbackEngine === 'native' ? 1 : 2;
      const next = clampVolume(value, cap);
      showControls();
      const video = videoRef.current;
      let applied = next;
      if (video !== null && playbackEngine !== 'native') {
        applied = applyBoostedVolume(video, next, false, true).applied;
      }
      audioRef.current = { volume: applied, muted: applied === 0 ? true : false };
      setVolume(applied);
      writeAudioPrefs({ volume: applied, muted: applied === 0 });
      engineRef.current?.setVolume(applied);
      if (applied > 0) {
        setMuted(false);
        engineRef.current?.setMuted(false);
      }
    },
    [playbackEngine, showControls],
  );

  const adjustVolume = useCallback(
    (delta: number): void => {
      const cap = playbackEngine === 'native' ? 1 : 2;
      setVolume((current) => {
        const next = clampVolume(current + delta, cap);
        showControls();
        const video = videoRef.current;
        let applied = next;
        if (video !== null && playbackEngine !== 'native') {
          applied = applyBoostedVolume(video, next, false, true).applied;
        }
        audioRef.current = { volume: applied, muted: applied === 0 };
        writeAudioPrefs({ volume: applied, muted: applied === 0 });
        engineRef.current?.setVolume(applied);
        if (applied > 0) {
          setMuted(false);
          engineRef.current?.setMuted(false);
        }
        return applied;
      });
    },
    [playbackEngine, showControls],
  );

  const applyPlaybackRate = useCallback((rate: number): void => {
    engineRef.current?.setRate(rate);
  }, []);

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
    retryAt.current = positionRef.current;
    recoveries.current = 0;
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

  useEffect(() => {
    if (playbackEngine !== 'native') return;
    document.documentElement.classList.add('tvm-native-playback');
    return () => document.documentElement.classList.remove('tvm-native-playback');
  }, [playbackEngine]);

  const switchNextChannel = useMemo(
    () =>
      nextFreeChannel !== null
        ? () => {
            setError(null);
            setLoading(true);
            setBuffering(true);
            setHasFrame(false);
            setChannelOverride(nextFreeChannel);
            setAttempt((value) => value + 1);
          }
        : undefined,
    [nextFreeChannel],
  );

  const releaseIntro = useCallback((): void => {
    setIntro((current) => {
      if (current !== null) markIntroPlayed(current.titleKey);
      return current;
    });
    introGate.current?.();
  }, []);
  const closeIntro = useCallback((): void => setIntro(null), []);
  // A failed start must not sit behind a running intro.
  useEffect(() => {
    if (error === null) return;
    introGate.current?.();
    setIntro(null);
  }, [error]);

  const busy = loading || (buffering && !hasFrame);
  const subtitles = useMemo(() => onlineSubtitles ? streamSubtitles : streamSubtitles.filter(({ url }) =>
    !url.startsWith('blob:') && !url.startsWith('data:') && !url.includes('/api/extras/subtitle.vtt?')), [onlineSubtitles, streamSubtitles]);
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
      segments,
      subtitles,
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
      nextChannel: switchNextChannel,
      nextChannelName: nextFreeChannel?.name,
      showControls,
      adjustVolume,
      setVolume: applyVolume,
      setMuted: applyMuted,
      setPlaybackRate: applyPlaybackRate,
    }),
    [
    adjustVolume,
    applyMuted,
    applyPlaybackRate,
    applyVolume,
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
    segments,
    showControls,
    skipRecap,
    subtitles,
    title,
    togglePlayback,
    volume,
  ]);

  return (
    <div
      className={`player player--${loading ? 'loading' : playbackEngine} ${shell}${busy ? ' player--busy' : ''}${live ? ' player--live' : ''}`}
      data-player=""
      data-player-shell=""
      data-playing={!loading && !paused && !buffering && !busy && !overlay && !error ? 'true' : undefined}
      data-engine={loading ? 'loading' : playbackEngine}
      data-live-mode={live ? 'true' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="player__stage" data-player-stage="">
        <video ref={videoRef} className="player__video" data-player-video="" playsInline preload="auto" />
      </div>
      <style>{GO_LIVE_CSS}</style>
      <GoLive live={live} drift={drift} onGoLive={goLive} />
      <PlayerRoot session={session} />
      {overlay === 'queue' && (
        <div className="player__queue" aria-live="polite">
          <OrbitLoader
            video={videoRef.current}
            hls={attachedHls(videoRef.current)}
            stage={loading ? 'finding' : 'connecting'}
            size="lg"
            className="player__queue-mark"
          />
          <p className="player__queue-kicker">TVM Cinema</p>
          <h2>{title !== 'Loading' ? title : 'Getting your stream ready'}</h2>
          <p>Press Back to cancel.</p>
        </div>
      )}
      {intro !== null && <FranchiseIntro key={intro.titleKey} pick={intro} onRelease={releaseIntro} onDone={closeIntro} />}
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
