import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { FocusButton } from '../components/FocusButton';
import { HeroArt } from '../components/HeroArt';
import { mapRailPosters } from '../components/PosterCard';
import { Rail } from '../components/Rail';
import { Skeleton } from '../components/Skeleton';
import { preferBackdrop } from '../data/artwork';
import { fetchAppHub, isMockApp, type AppHubPayload } from '../data/apps';
import { APPS, MORE_APPS, type Title } from '../data/catalog';
import { asTitle } from '../data/media';
import { openDetails } from '../data/openDetails';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import './service.css';

type Lane = 'home' | 'shows' | 'movies' | 'list';

function inLane(title: Title, lane: Lane): boolean {
  if (lane === 'shows') return title.kind === 'series';
  if (lane === 'movies') return title.kind === 'movie';
  return true;
}

function navTabs(layout: string): Array<{ id: Lane; label: string }> {
  if (layout === 'netflix') {
    return [
      { id: 'home', label: 'Home' },
      { id: 'shows', label: 'Shows' },
      { id: 'movies', label: 'Movies' },
      { id: 'list', label: 'My List' },
    ];
  }
  if (layout === 'prime') {
    return [
      { id: 'home', label: 'Home' },
      { id: 'movies', label: 'Movies' },
      { id: 'shows', label: 'TV Shows' },
    ];
  }
  if (layout === 'disney' || layout === 'hulu') {
    return [
      { id: 'home', label: 'For You' },
      { id: 'movies', label: 'Movies' },
      { id: 'shows', label: 'Series' },
    ];
  }
  if (layout === 'peacock') {
    return [
      { id: 'home', label: 'Home' },
      { id: 'movies', label: 'Movies' },
      { id: 'shows', label: 'TV Shows' },
      { id: 'list', label: 'My Stuff' },
    ];
  }
  return [
    { id: 'home', label: 'Home' },
    { id: 'shows', label: 'Series' },
    { id: 'movies', label: 'Movies' },
  ];
}

function ServiceNav({
  hub,
  lane,
  onLane,
  onBack,
}: {
  hub: AppHubPayload;
  lane: Lane;
  onLane: (lane: Lane) => void;
  onBack: () => void;
}): React.JSX.Element {
  const layout = hub.layout;
  const tabs = navTabs(layout);
  const side = layout === 'prime' || layout === 'disney' || layout === 'hulu';

  return (
    <nav className="service-nav" aria-label={hub.name}>
      <FocusButton id="service-back" className="service-nav__back" onSelect={onBack}>
        Back
      </FocusButton>
      {side ? (
        <div className="service-side">
          <span className="service-side__dot" />
          <span className="service-side__dot" />
          <span className="service-side__dot service-side__dot--on" />
        </div>
      ) : null}
      <div className="service-nav__tabs">
        {tabs.map((tab) => (
          <FocusButton
            key={tab.id}
            id={`service-tab-${tab.id}`}
            className={`service-nav__tab${lane === tab.id ? ' service-nav__tab--on' : ''}`}
            onSelect={() => onLane(tab.id)}
          >
            {tab.label}
          </FocusButton>
        ))}
      </div>
      <div className="service-nav__brand">
        {hub.logo !== '' ? <img src={hub.logo} alt="" className="service-nav__logo" /> : null}
        <span>{hub.wordmark || hub.name}</span>
      </div>
    </nav>
  );
}

function ServiceHome({ appId }: { appId: string }): React.JSX.Element {
  const navigate = useNavigate();
  const [hub, setHub] = useState<AppHubPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [lane, setLane] = useState<Lane>('home');

  useEffect(() => {
    let cancelled = false;
    void fetchAppHub(appId).then((payload) => {
      if (cancelled) return;
      if (payload === null) setFailed(true);
      else setHub(payload);
    });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  const openTitle = (title: Title): void => {
    openDetails(navigate, title);
  };

  const watching = useMemo(() => (hub?.continueWatching ?? []).map(asTitle), [hub]);
  const hero = hub?.hero !== null && hub?.hero !== undefined ? asTitle(hub.hero) : watching[0];
  const rails = useMemo(() => {
    if (hub === null) return [];
    return hub.rails
      .map((rail) => ({
        ...rail,
        titles: rail.items.map(asTitle).filter((title) => inLane(title, lane)),
      }))
      .filter((rail) => rail.titles.length > 0);
  }, [hub, lane]);

  if (failed) {
    return (
      <main className="page page--library">
        <EmptyState
          title="This app could not load"
          body="TVM could not reach the local catalog for this service."
          actions={
            <FocusButton id="close" onSelect={() => navigate.pop()}>
              Back
            </FocusButton>
          }
        />
      </main>
    );
  }

  if (hub === null || hero === undefined) {
    return (
      <main className={`service service--${appId}`}>
        <FocusButton id="service-back" className="service-nav__back" onSelect={() => navigate.home()}>
          Back
        </FocusButton>
        <Skeleton className="service-skeleton" />
      </main>
    );
  }

  const layout = hub.layout;
  const heroSrc = preferBackdrop(hero.id, hero.backdrop, hero.poster);
  const playLabel =
    layout === 'prime' ? 'Play' : layout === 'max' ? 'Go to Series' : layout === 'peacock' ? 'Watch Now' : 'Play';
  const liked = rails[0]?.titles.slice(0, 10) ?? [];
  const landscape = layout === 'prime' || layout === 'peacock' || layout === 'appletv';

  return (
    <main className={`service service--${layout}`}>
      <ServiceNav hub={hub} lane={lane} onLane={setLane} onBack={() => navigate.home()} />
      {lane !== 'list' && (
        <section className="service-hero">
          <HeroArt src={heroSrc} hue={hero.hue} />
          <div className="service-hero__veil" aria-hidden="true" />
          <div className="service-hero__copy">
            {layout === 'max' ? <p className="service-hero__kicker">HBO ORIGINAL</p> : null}
            {layout === 'peacock' ? <p className="service-hero__kicker">STREAMING ON PEACOCK</p> : null}
            {layout === 'disney' ? <p className="service-hero__badge">Now Streaming</p> : null}
            <h1 className="service-hero__title">{hero.title}</h1>
            <p className="service-hero__meta">
              {[hero.year > 0 ? String(hero.year) : '', hero.rating, hero.kind === 'series' ? 'TV Show' : 'Movie']
                .filter(Boolean)
                .join(' · ')}
            </p>
            {hero.synopsis !== '' && <p className="service-hero__syn">{hero.synopsis}</p>}
            <div className="service-hero__actions">
              <FocusButton id="service-play" variant="primary" className="service-hero__play" onSelect={() => openTitle(hero)}>
                {playLabel}
              </FocusButton>
              <FocusButton id="service-info" className="service-hero__more" onSelect={() => openTitle(hero)}>
                {layout === 'appletv' ? 'Info' : 'More Info'}
              </FocusButton>
            </div>
          </div>
        </section>
      )}

      {watching.length > 0 && lane !== 'movies' && (
        <Rail title="Continue Watching">
          {mapRailPosters(watching, `${hub.id}-continue`, openTitle, {
            layout: layout === 'netflix' ? 'portrait' : 'landscape',
          })}
        </Rail>
      )}

      {layout === 'netflix' && liked.length > 0 && lane === 'list' && (
        <Rail title="TV Shows & Movies You've Liked">
          {mapRailPosters(liked, `${hub.id}-liked`, openTitle, { layout: 'landscape' })}
        </Rail>
      )}

      {lane !== 'list' &&
        rails.map((rail) => (
          <Rail key={rail.id} title={rail.title}>
            {mapRailPosters(rail.titles, rail.id, openTitle, { layout: landscape ? 'landscape' : 'portrait' })}
          </Rail>
        ))}
    </main>
  );
}

function ServiceEmbed({ id, url, name }: { id: string; url: string; name: string }): React.JSX.Element {
  const navigate = useNavigate();
  const [message, setMessage] = useState(`Opening ${name} in this window…`);

  useEffect(() => {
    if (!url.startsWith('https://')) {
      setMessage('This service is not available as an embedded site.');
      return;
    }
    const bridge = window.tvmServiceBrowser;
    if (bridge === undefined) {
      setMessage('This service opens as a TVM catalog on this device.');
      return;
    }
    let cancelled = false;
    void bridge
      .start({ id: id === '' ? name.toLowerCase() : id, url, title: name })
      .then(() => {
        if (!cancelled) setMessage(`${name} stays in this window. Back or Home returns to TVM.`);
      })
      .catch(() => {
        if (!cancelled) setMessage(`${name} could not be opened in this window.`);
      });
    const stop = bridge.onEvent((event) => {
      if (event.type === 'closed') navigate.pop();
    });
    return () => {
      cancelled = true;
      stop();
      void bridge.stop();
    };
  }, [id, name, navigate, url]);

  return (
    <main className="page page--library service-fallback">
      <EmptyState
        eyebrow={name}
        title={name}
        body={message}
        actions={
          <FocusButton id="close" variant="primary" onSelect={() => navigate.pop()}>
            Back
          </FocusButton>
        }
      />
    </main>
  );
}

export function Service({ params }: ScreenProps): React.JSX.Element {
  const id = typeof params['id'] === 'string' ? params['id'] : '';
  const requested = typeof params['url'] === 'string' ? params['url'] : '';
  const named = typeof params['title'] === 'string' ? params['title'] : '';
  const app = [...APPS, ...MORE_APPS].find((entry) => entry.id === id);
  const url = requested.startsWith('https://') ? requested : (app?.url ?? '');
  const name = named !== '' ? named : (app?.name ?? 'Page');

  if (isMockApp(id) || url === 'internal:mock' || url === '') {
    return <ServiceHome appId={id === '' ? 'netflix' : id} />;
  }

  return <ServiceEmbed id={id} url={url} name={name} />;
}
