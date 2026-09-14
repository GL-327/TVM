import { useEffect, useRef, useState } from 'react';
import { fetchHome, type HomePayload } from '../../data/media';
import { useThemeId } from '../useThemeId';
import { prefersReducedMotion, subscribeMotionPreference } from '../motion';
import { currentAnimePlatform, eyeTarget, useAnimeScene } from './catalog';
import { AnimeTableau } from './Tableau';
export function AnimeStage(): React.JSX.Element | null { return useThemeId() === 'anime' ? <Stage /> : null; }
function Stage(): React.JSX.Element {
  const scene = useAnimeScene();
  const [beat, setBeat] = useState(0);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [signal, setSignal] = useState('Choose a story');
  const [home, setHome] = useState<HomePayload | null>(null);
  const [burst, setBurst] = useState(false);
  const [quiet, setQuiet] = useState(() => prefersReducedMotion() || matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [platform, setPlatform] = useState(currentAnimePlatform);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setQuiet(prefersReducedMotion() || media.matches);
    const unsubscribe = subscribeMotionPreference(update);
    media.addEventListener('change', update);
    return () => { unsubscribe(); media.removeEventListener('change', update); };
  }, []);
  useEffect(() => {
    let live = true;
    const refresh = (): void => { void fetchHome().then(value => { if (live) setHome(value); }); };
    const loaded = (event: Event): void => setHome((event as CustomEvent<HomePayload | null>).detail);
    refresh(); window.addEventListener('tvm:progress', refresh); window.addEventListener('tvm:home', loaded);
    return () => { live = false; window.removeEventListener('tvm:progress', refresh); window.removeEventListener('tvm:home', loaded); };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.animeScene = scene.id;
    setBeat(0); setBurst(false);
    let spent = false;
    let burstTimer: ReturnType<typeof setTimeout> | undefined;
    let last: Element | null = null;
    let target = { x: 0, y: 0 };
    let position = { x: 0, y: 0 };
    const readPlatform = (): void => setPlatform(currentAnimePlatform());
    const focus = (): void => {
      const active = document.querySelector('[data-focused="true"]') ?? document.activeElement;
      if (!active || active === last || root.current?.contains(active)) return;
      last = active;
      const rect = active.getBoundingClientRect();
      target = eyeTarget(platform, target, { x: (rect.x + rect.width / 2) / innerWidth * 2 - 1, y: (rect.y + rect.height / 2) / innerHeight * 2 - 1 });
      setBeat(n => n + 1);
      setSignal(active.querySelector('.poster__title')?.textContent ?? active.getAttribute('aria-label') ?? active.textContent?.trim().slice(0, 70) ?? 'Choose a story');
    };
    const pointer = (event: PointerEvent): void => {
      target = eyeTarget(platform, { x: event.clientX / innerWidth * 2 - 1, y: event.clientY / innerHeight * 2 - 1 }, target);
    };
    const select = (event: MouseEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('.poster, [data-focus-id*="play"]')) return;
      if (scene.id === 'just-this-once' && spent) return;
      spent = true; setBeat(n => n + 1);
      if (!quiet) { setBurst(true); clearTimeout(burstTimer); burstTimer = setTimeout(() => setBurst(false), 1500); }
    };
    const observer = new MutationObserver(focus);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-focused'] });
    document.addEventListener('focusin', focus); document.addEventListener('pointermove', pointer, { passive: true }); document.addEventListener('click', select, true); window.addEventListener('resize', readPlatform);
    // 20 Hz only for the gaze, no render loop in Performance/reduced motion or hidden tabs.
    const timer = !quiet && scene.id === 'gojo-six-eyes' ? setInterval(() => {
      if (document.hidden || document.querySelector('[data-screen="player"]')) return;
      position = { x: position.x + (target.x - position.x) * .14, y: position.y + (target.y - position.y) * .14 };
      setGaze({ x: position.x + Math.sin(Date.now() / 2000) * .025, y: position.y });
    }, 50) : undefined;
    return () => { observer.disconnect(); document.removeEventListener('focusin', focus); document.removeEventListener('pointermove', pointer); document.removeEventListener('click', select, true); window.removeEventListener('resize', readPlatform); clearInterval(timer); clearTimeout(burstTimer); delete document.documentElement.dataset.animeScene; };
  }, [scene.id, platform, quiet]);
  return <div ref={root} className="anime-stage" data-platform={platform} data-quiet={quiet} data-burst={burst}>
    <AnimeTableau id={scene.id} beat={beat} generation={home?.adaptationGeneration ?? 0} gaze={gaze} />
    <div className="anime-stage__caption"><span>ANIME / {String(beat % 9 + 1).padStart(2, '0')}</span><strong>{scene.title}</strong><small>{scene.id === 'mahoraga' ? `${home?.adaptationGeneration ?? 0} adaptations · ${home?.finished?.[0]?.title ?? 'Finish a story to turn the wheel'}` : scene.id === 'nerv-grid' ? `Signal: ${signal}` : scene.id === 'just-this-once' && burst ? 'JUST THIS ONCE — DOMAIN RELEASED' : scene.summary}</small></div>
  </div>;
}
