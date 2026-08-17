import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { FocusButton } from '../../components/FocusButton';
import { HeroArt } from '../../components/HeroArt';
import { mapRailPosters } from '../../components/PosterCard';
import { Rail } from '../../components/Rail';
import { Skeleton } from '../../components/Skeleton';
import { preferBackdrop } from '../../data/artwork';
import { fetchAppHub, type AppHubPayload } from '../../data/apps';
import type { Title } from '../../data/catalog';
import { asTitle } from '../../data/media';
import { openDetails } from '../../data/openDetails';
import { useNavigate } from '../../nav/ViewStackContext';
import { moreLabel, playLabel, ServiceNav, ServiceShell, type Lane } from './chrome';

function inLane(title: Title, lane: Lane): boolean {
  if (lane === 'shows') return title.kind === 'series';
  if (lane === 'movies') return title.kind === 'movie';
  return true;
}

export function ServiceHome({ appId }: { appId: string }): React.JSX.Element {
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
      <ServiceShell layout={appId}>
        <FocusButton id="service-back" className="service-nav__back" onSelect={() => navigate.home()}>
          Back
        </FocusButton>
        <Skeleton className="service-skeleton" />
      </ServiceShell>
    );
  }

  const layout = hub.layout;
  const heroSrc = preferBackdrop(hero.id, hero.backdrop, hero.poster);
  const liked = rails[0]?.titles.slice(0, 10) ?? [];
  const landscape = layout === 'prime' || layout === 'peacock' || layout === 'appletv';
  const portrait = layout === 'netflix' || layout === 'disney';

  return (
    <ServiceShell layout={layout}>
      <ServiceNav hub={hub} lane={lane} onLane={setLane} onBack={() => navigate.home()} />
      {lane !== 'list' && (
        <section className="service-hero">
          <HeroArt src={heroSrc} hue={hero.hue} />
          <div className="service-hero__veil" aria-hidden="true" />
          <div className="service-hero__copy">
            {layout === 'max' ? <p className="service-hero__kicker">HBO ORIGINAL</p> : null}
            {layout === 'peacock' ? <p className="service-hero__kicker">STREAMING ON PEACOCK</p> : null}
            {layout === 'hulu' ? <p className="service-hero__kicker">Hulu Original</p> : null}
            {layout === 'prime' ? <p className="service-hero__kicker">Included with Prime</p> : null}
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
                {playLabel(layout)}
              </FocusButton>
              <FocusButton id="service-info" className="service-hero__more" onSelect={() => openTitle(hero)}>
                {moreLabel(layout)}
              </FocusButton>
            </div>
          </div>
        </section>
      )}

      {watching.length > 0 && lane !== 'movies' && (
        <Rail title="Continue Watching">
          {mapRailPosters(watching, `${hub.id}-continue`, openTitle, {
            layout: portrait ? 'portrait' : 'landscape',
          })}
        </Rail>
      )}

      {layout === 'max' && liked.length > 0 && lane === 'home' && (
        <Rail title="MAX Exclusive">
          {mapRailPosters(liked, `${hub.id}-exclusive`, openTitle, { layout: 'landscape' })}
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
            {mapRailPosters(rail.titles, rail.id, openTitle, {
              layout: landscape ? 'landscape' : portrait ? 'portrait' : 'portrait',
            })}
          </Rail>
        ))}
    </ServiceShell>
  );
}
