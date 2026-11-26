import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../data/media';
import { imdbIdFrom } from '../data/playId';
import { uiExtraEnabled, useExtraPrefs } from '../data/uiExtras';
import { prefersReducedMotion, subscribeMotionPreference } from '../theme/motion';

export function fadeAudio(audio: HTMLAudioElement, target: number, milliseconds: number, done?: () => void): () => void {
  const start = performance.now();
  const initial = audio.volume;
  const timer = window.setInterval(() => {
    const fraction = Math.min(1, (performance.now() - start) / milliseconds);
    audio.volume = initial + (target - initial) * fraction;
    if (fraction === 1) { window.clearInterval(timer); done?.(); }
  }, 40);
  return () => window.clearInterval(timer);
}

/**
 * Core cuts the same clean, muted MP4 it makes for the Home hero (no YouTube title bar,
 * no black frames while an embed boots). Polls while Core says it is preparing.
 */
function useCoreClip(id: string | null, enabled: boolean): { url: string | null; settled: boolean } {
  const [state, setState] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    setState(null);
    if (!id || !enabled) return;
    const controller = new AbortController();
    let timer = 0;
    const deadline = Date.now() + 120_000;
    const get = async (): Promise<void> => {
      try {
        const response = await apiFetch('/api/extras/hero-clip?id=' + encodeURIComponent(id), { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 202 && Date.now() < deadline) {
          timer = window.setTimeout(() => void get(), 5000);
          return;
        }
        const body = response.ok ? await response.json() as { status?: string; url?: string } : {};
        if (!controller.signal.aborted) setState({ id, url: body.status === 'ready' && body.url ? new URL(body.url, response.url || window.location.href).href : null });
      } catch {
        if (!controller.signal.aborted) setState({ id, url: null });
      }
    };
    void get();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [enabled, id]);
  return { url: state && state.id === id ? state.url : null, settled: !id || !enabled || (state !== null && state.id === id) };
}

/** YouTube's iframe API reports player state 1 once frames are actually playing. */
function youtubePlaying(event: MessageEvent, frame: HTMLIFrameElement | null): boolean {
  if (!frame || event.source !== frame.contentWindow || !/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(event.origin)) return false;
  try {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) as { info?: { playerState?: number } } : null;
    return data?.info?.playerState === 1;
  } catch { return false; }
}

export function DetailsMedia({ id, trailerId, active }: { id: string; trailerId?: string; active: boolean }): React.JSX.Element | null {
  const prefs = useExtraPrefs();
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const backdrop = uiExtraEnabled('trailerBackdrops', prefs) && !reduced;
  const theme = uiExtraEnabled('themeSongs', prefs);
  const playing = active && !hidden;
  const clip = useCoreClip(imdbIdFrom(id), backdrop && playing);

  useEffect(() => {
    const sync = (): void => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', sync);
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = (): void => setReduced(prefersReducedMotion());
    query.addEventListener('change', motion);
    const unsubscribe = subscribeMotionPreference(motion);
    return () => { document.removeEventListener('visibilitychange', sync); query.removeEventListener('change', motion); unsubscribe(); };
  }, []);

  useEffect(() => {
    setReady(false);
    setLoaded(false);
    if (!backdrop || !playing) return;
    const timer = window.setTimeout(() => setReady(true), 3_000);
    return () => window.clearTimeout(timer);
  }, [backdrop, id, playing]);

  useEffect(() => {
    if (!theme || !playing || !id) return;
    const controller = new AbortController();
    let audio: HTMLAudioElement | undefined;
    let cancelFade: (() => void) | undefined;
    void apiFetch(`/api/extras/theme?id=${encodeURIComponent(id)}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { url?: string };
      if (!body.url || controller.signal.aborted) return;
      audio = new Audio(new URL(body.url, response.url || window.location.href).href);
      audio.volume = 0;
      audio.loop = true;
      await audio.play();
      if (controller.signal.aborted) { audio.pause(); return; }
      cancelFade = fadeAudio(audio, 0.25, 2_000);
    }).catch(() => undefined);
    return () => {
      controller.abort();
      cancelFade?.();
      if (audio) {
        const leaving = audio;
        fadeAudio(leaving, 0, 2_000, () => { leaving.pause(); leaving.removeAttribute('src'); leaving.load(); });
      }
    };
  }, [id, playing, theme]);

  useEffect(() => {
    if (clip.url || !ready) return;
    // Fade the embed in only once YouTube says it is playing, so its black boot frames
    // and title card never replace the artwork.
    const listen = (event: MessageEvent): void => { if (youtubePlaying(event, iframe.current)) setLoaded(true); };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [clip.url, ready]);

  if (!ready || !backdrop || !playing) return null;
  if (clip.url) {
    return <div className="details__trailer-backdrop" data-loaded={loaded} aria-hidden="true">
      <video src={clip.url} muted loop autoPlay playsInline tabIndex={-1} onPlaying={() => setLoaded(true)} />
    </div>;
  }
  if (!clip.settled || !trailerId || !/^[\w-]{11}$/.test(trailerId)) return null;
  return <div className="details__trailer-backdrop details__trailer-backdrop--embed" data-loaded={loaded} aria-hidden="true">
    <iframe ref={iframe} tabIndex={-1} title="Trailer backdrop"
      onLoad={() => iframe.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'tvm-backdrop' }), '*')}
      src={`https://www.youtube-nocookie.com/embed/${trailerId}?autoplay=1&mute=1&loop=1&playlist=${trailerId}&controls=0&disablekb=1&playsinline=1&rel=0&iv_load_policy=3&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
      allow="autoplay; encrypted-media" referrerPolicy="strict-origin-when-cross-origin" />
  </div>;
}
