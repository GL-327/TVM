import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { FocusButton } from '../components/FocusButton';
import { HeroArt } from '../components/HeroArt';
import { ImdbBadge } from '../components/ImdbBadge';
import { preferBackdrop } from '../data/artwork';
import { apiFetch } from '../data/media';
import { imdbIdFrom } from '../data/playId';
import { safeAnnouncementLink, type Announcement } from '../data/releaseConfig';
import type { Title } from '../data/catalog';
import type { ActiveEvent } from '../data/events';
import './spotlight.css';

const particles = Array.from({ length: 48 }, (_, i) => ({
  x: (i * 73 % 101) + '%', y: (i * 37 % 100) + '%',
  delay: -(i % 19) * .74 + 's', duration: 8 + i % 11 + 's',
  size: 1 + i % 4 + 'px', drift: (i % 9 - 4) * 13 + 'px',
}));

function useHeroClip(id: string | null, enabled: boolean): string | null {
  const [clip, setClip] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
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
        } else if (response.ok) {
          const body = await response.json() as { status?: string; url?: string };
          if (!controller.signal.aborted && body.status === 'ready' && body.url) setClip({ id, url: body.url });
        }
      } catch { /* The artwork stays in view whenever a clip is unavailable. */ }
    };
    void get();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [enabled, id]);
  return enabled && clip && clip.id === id ? clip.url : null;
}

function SpotlightLogo({ hero }: { hero: Title }): React.JSX.Element {
  const id = imdbIdFrom(hero.id);
  const [loaded, setLoaded] = useState(false);
  const url = id ? 'https://images.metahub.space/logo/medium/' + id + '/img' : null;
  return <h1 className="spotlight__title">
    <span className={loaded ? 'spotlight__title-text spotlight__visually-hidden' : 'spotlight__title-text'}>{hero.title}</span>
    {url && <span className="spotlight__logo" hidden={!loaded} style={{ '--title-mask': 'url("' + url + '")' } as CSSProperties}>
      <img src={url} alt="" onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} />
    </span>}
  </h1>;
}

export function Spotlight({ hero, event, enabled, active, reduced, rating, announcement, onPlay, onDetails, onSurprise }: {
  hero: Title | undefined; event: ActiveEvent | null; enabled: boolean; active: boolean; reduced: boolean;
  rating: boolean; announcement?: Announcement | null; onPlay: () => void; onDetails: () => void; onSurprise?: () => void;
}): React.JSX.Element {
  const stage = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const pointerFrame = useRef(0);
  const imdb = hero ? imdbIdFrom(hero.id) : null;
  const clip = useHeroClip(imdb, enabled && !reduced);
  const [readyClip, setReadyClip] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    if (active && !reduced) void node.play().catch(() => undefined);
    else node.pause();
  }, [active, clip, reduced]);
  useEffect(() => () => cancelAnimationFrame(pointerFrame.current), []);

  const parallax = (event: PointerEvent<HTMLElement>): void => {
    if (reduced || event.pointerType !== 'mouse' || pointerFrame.current || !stage.current) return;
    const { clientX, clientY } = event;
    pointerFrame.current = requestAnimationFrame(() => {
      pointerFrame.current = 0;
      const node = stage.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      node.style.setProperty('--spotlight-x', String((clientX - rect.left) / rect.width - .5));
      node.style.setProperty('--spotlight-y', String((clientY - rect.top) / rect.height - .5));
    });
  };

  const effect = event?.effect ?? (event ? 'dust' : 'none');
  const style = event ? { '--spotlight-accent': event.accent, '--spotlight-glow': event.glow } as CSSProperties : undefined;
  const link = safeAnnouncementLink(announcement?.link);
  const days = event ? Math.max(1, Math.ceil((+new Date(event.release + 'T00:00:00') - Date.now()) / 86_400_000)) : 0;
  const meta = [hero && hero.year > 0 ? String(hero.year) : '', ...(hero?.genres.slice(0, 2) ?? []),
    event?.items.length ? event.items.length + (event.items.length === 1 ? ' film' : ' films') : ''].filter(Boolean);

  return <section ref={stage} className={'stage stage--home spotlight' + (event ? ' spotlight--event' : '')}
    data-active={active && !reduced} style={style} onPointerMove={parallax} onPointerLeave={() => {
      stage.current?.style.removeProperty('--spotlight-x'); stage.current?.style.removeProperty('--spotlight-y');
    }}>
    <div className="spotlight__media" aria-hidden="true">
      {hero && <HeroArt src={preferBackdrop(hero.id, hero.backdrop, hero.poster)} hue={hero.hue} />}
      {clip && <video key={clip} ref={video} src={clip} muted={muted} loop playsInline preload="auto"
        className={'spotlight__video' + (clip === readyClip && active ? ' spotlight__video--ready' : '')}
        onPlaying={() => { setReadyClip(clip); setPlaying(true); }} onPause={() => setPlaying(false)}
        onError={() => { setPlaying(false); setReadyClip(null); }} />}
    </div>
    <div className="spotlight__scrim" aria-hidden="true" />
    {event && <div className="spotlight__glow" aria-hidden="true" />}
    {!reduced && effect !== 'none' && <div className={'spotlight__particles spotlight__particles--' + effect} aria-hidden="true">
      {particles.map(({ x, y, delay, duration, size, drift }, i) => <i key={i} style={{
        '--x': x, '--y': y, '--delay': delay, '--duration': duration, '--size': size, '--drift': drift,
      } as CSSProperties} />)}
    </div>}
    {announcement && <aside className={'spotlight__announcement spotlight__announcement--' + announcement.level} role="status">
      <span>{announcement.text}</span>{link && <a href={link} target="_blank" rel="noreferrer">Details ↗</a>}
    </aside>}
    <div className="spotlight__copy" key={hero?.id ?? 'empty'}>
      {hero && <p className="spotlight__kicker"><i aria-hidden="true" />
        {event ? event.released ? 'In cinemas now' : 'In cinemas in ' + days + (days === 1 ? ' day' : ' days') : 'Featured on TVM'}
      </p>}
      {hero ? <SpotlightLogo key={hero.id} hero={hero} /> : <h1 className="spotlight__title">Welcome to TVM</h1>}
      {event?.line || hero?.synopsis ? <p className="spotlight__line">{event?.line || hero?.synopsis}</p> : null}
      {(meta.length > 0 || hero?.rating) && <div className="spotlight__meta">
        {meta.map((item) => <span key={item}>{item}</span>)}
        {rating && hero?.rating && <ImdbBadge compact id="hero-imdb" mediaId={hero.id} rating={hero.rating} isSeries={hero.kind === 'series'} />}
      </div>}
      <div className="spotlight__actions" data-wrap="row">
        <FocusButton id="hero-play" variant="primary" tabIndex={0} onSelect={onPlay}>
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5 14 8 4 13.5Z" /></svg>
          {event ? 'Watch the saga' : hero ? 'Play' : 'Browse TVM'}
        </FocusButton>
        {hero && <FocusButton id="hero-info" className="tvm-button--glass" tabIndex={0} onSelect={onDetails}>Details</FocusButton>}
        {onSurprise && <FocusButton id="home-surprise" className="tvm-button--glass" tabIndex={0} onSelect={onSurprise}>Surprise me</FocusButton>}
        {playing && active && <FocusButton id="hero-mute" className="tvm-button--glass spotlight__mute" tabIndex={0}
          title={muted ? 'Unmute preview' : 'Mute preview'} ariaLabel={muted ? 'Unmute preview' : 'Mute preview'}
          onSelect={() => setMuted(!muted)}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 9h4l5-4v14l-5-4H3Z" />{muted ? <path d="m16 9 5 6m0-6-5 6" /> : <path d="M16 8a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14" />}
          </svg>
        </FocusButton>}
      </div>
    </div>
  </section>;
}
