import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { openModals, visibleScreen } from '@tvm/nav';
import { AppCard } from '../components/AppCard';
import { Artwork } from '../components/Artwork';
import { FocusButton } from '../components/FocusButton';
import { IconChevronLeft, IconLive, IconPlay, IconSearch, IconStream } from '../components/Icons';
import { PatchNotesPopup } from '../components/PatchNotesPopup';
import { mapRailPosters } from '../components/PosterCard';
import { Rail } from '../components/Rail';
import { Ribbon } from '../components/Ribbon';
import { Skeleton } from '../components/Skeleton';
import { fallbackApps, fetchApps, openAppTile } from '../data/apps';
import { TVM_STREAM, type Title } from '../data/catalog';
import { bundledFreeChannels, fetchFreeChannels, filterChannelsByAge } from '../data/freeLive';
import { asTitle, fetchHome, peekHome } from '../data/media';
import { getServicesContent } from '../data/content';
import { openServiceExternal } from '../data/services';
import { playIdFor } from '../data/playId';
import { openDetails } from '../data/openDetails';
import { filterItemsByAge } from '../data/parental';
import { effectiveProfileMaxAge, fetchProfiles, peekActiveProfile, subscribeProfiles } from '../data/profiles';
import { livePlayerParams } from '../player/features/LiveOverlay';
import { useNavigate, useViewStack } from '../nav/ViewStackContext';

const popularChannels = ['bbc-one', 'bbc-two', 'bbc-news', 'cbbc', 'dw-english', 'weathernation'];

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function ChannelLogo({ logo }: { logo?: string }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  return logo && !broken
    ? <img src={logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    : <IconLive />;
}

export function Hub(): React.JSX.Element {
  const navigate = useNavigate();
  const stack = useViewStack();
  const active = visibleScreen(stack).name === 'hub' && openModals(stack).length === 0;
  const [profile, setProfile] = useState(peekActiveProfile);
  const [home, setHome] = useState(peekHome);
  const [loading, setLoading] = useState(() => peekHome() === null);
  const [apps, setApps] = useState(() => fallbackApps().grid);
  const [channels, setChannels] = useState(() => bundledFreeChannels());
  const maxAge = effectiveProfileMaxAge(profile);

  useEffect(() => {
    let current = true;
    const sync = (): void => setProfile(peekActiveProfile());
    const unsubscribe = subscribeProfiles(sync);
    void fetchProfiles().then(() => { if (current) sync(); });
    void fetchApps().then((data) => { if (current) setApps(data.grid); });
    void fetchFreeChannels().then((data) => { if (current) setChannels(data); });
    return () => { current = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!active) return;
    let current = true;
    void fetchHome().then((data) => {
      if (!current) return;
      if (data !== null) setHome(data);
      setLoading(false);
    });
    return () => { current = false; };
  }, [active, profile?.id]);

  const watching = useMemo(
    () => filterItemsByAge(home?.continueWatching ?? [], maxAge).map(asTitle),
    [home, maxAge],
  );
  const hero = useMemo(() => {
    if (home === null) return undefined;
    const items = [home.featured, ...(home.rails ?? []).flatMap((rail) => rail.items)].filter((item) => item != null);
    const item = filterItemsByAge(items, maxAge).find((item) => item.backdrop !== '');
    return item ? asTitle(item) : watching[0];
  }, [home, maxAge, watching]);
  const resume = useCallback((title: Title): void => {
    const item = home?.continueWatching?.find((entry) => entry.id === title.id);
    const episodeId = /^(tt\d+):(\d+):(\d+)$/.exec(title.id);
    const season = item?.season ?? (episodeId ? Number(episodeId[2]) : undefined);
    const episode = item?.episode ?? (episodeId ? Number(episodeId[3]) : undefined);
    if (title.kind === 'series' && (season === undefined || episode === undefined)) {
      openDetails(navigate, title);
      return;
    }
    navigate.pushModal('player', { params: {
      id: playIdFor(title.id, season, episode), title: title.title, season, episode, genres: title.genres,
    } });
  }, [home, navigate]);
  const appTiles = apps.some((app) => app.id === TVM_STREAM.id) ? apps : [TVM_STREAM, ...apps];
  const externalServices = getServicesContent().services.filter((service) => !appTiles.some((app) => app.id === service.id));
  const free = useMemo(() => filterChannelsByAge(channels, maxAge).filter((channel) => !!channel.url), [channels, maxAge]);
  const pickedChannels = [
    ...popularChannels.flatMap((id) => free.filter((channel) => channel.id === 'live:free:' + id)),
    ...free.filter((channel) => !popularChannels.some((id) => channel.id === 'live:free:' + id)),
  ].slice(0, 6);
  const goHome = (): void => navigate.push('home');
  const browse = (lane: 'movies' | 'shows'): void => navigate.push('library', { params: { lane } });
  const search = (): void => navigate.pushModal('search', { params: { from: 'home' } });
  const name = profile?.name.trim();

  return (
    <main className="home hub">
      <Ribbon active="hub" />
      <div className="hub__body">
        <section className="hub__hero" aria-labelledby="hub-welcome"
          style={{ '--hub-hue': hero?.hue ?? 30 } as CSSProperties}>
          {hero && <Artwork title={hero} kind="backdrop" className="hub__hero-art" decorative eager />}
          <div className="hub__welcome">
            <h1 id="hub-welcome">{greeting(new Date().getHours())}{name ? ', ' + name : ''}</h1>
            <p>What are you in the mood for?</p>
            <FocusButton id="hub-browse" variant="primary" onSelect={goHome} tabIndex={0}>
              <IconPlay /> Browse Home
            </FocusButton>
          </div>
          {hero && <div className="hub__hero-caption"><span>On Home</span><strong>{hero.title}</strong></div>}
        </section>

        <nav className="hub__shortcuts" aria-label="Quick links" data-wrap="row">
          <FocusButton id="hub-movies" onSelect={() => browse('movies')} tabIndex={0}><IconStream /> Movies</FocusButton>
          <FocusButton id="hub-series" onSelect={() => browse('shows')} tabIndex={0}><IconWatchlistFrame /> Series</FocusButton>
          <FocusButton id="launch-live" onSelect={() => navigate.push('live')} tabIndex={0}><IconLive /> Live TV</FocusButton>
          <FocusButton id="hub-search" onSelect={search} tabIndex={0}><IconSearch /> Search</FocusButton>
        </nav>

        {watching.length > 0 && <Rail title="Continue watching" id="hub-continue" loop={false}>
          {mapRailPosters(watching, 'hub-continue', resume, { layout: 'landscape' })}
        </Rail>}
        {loading && <Rail title="Continue watching" id="hub-continue-loading" loop={false}>
          <Skeleton className="hub__loading" label="Loading continue watching" />
        </Rail>}

        <Rail title="Apps & services" id="hub-apps" loop={false}
          action={<FocusButton id="launch-apps" variant="quiet" onSelect={() => navigate.push('apps')} tabIndex={0}>
            All apps <IconChevronLeft />
          </FocusButton>}>
          {appTiles.map((app) => <AppCard key={app.id} app={app.id === TVM_STREAM.id ? { ...app, icon: undefined } : app} id={app.id === 'tvm-stream' ? 'launch-stream' : 'hub-app-' + app.id}
            onSelect={() => openAppTile(navigate, app)} />)}
          {externalServices.map((service) => <AppCard key={service.id} id={'hub-service-' + service.id}
            app={{ ...service, accent: '#282327', url: service.home }}
            onSelect={() => { openServiceExternal(service.home, service); }} />)}
        </Rail>

        {pickedChannels.length > 0 && <Rail title="Free live TV" id="hub-live" loop={false}
          action={<FocusButton id="hub-guide" variant="quiet" onSelect={() => navigate.push('live')} tabIndex={0}>
            Open guide <IconChevronLeft />
          </FocusButton>}>
          {pickedChannels.map((channel) => <FocusButton key={channel.id} id={'hub-' + channel.id} className="hub__channel"
            ariaLabel={'Watch ' + channel.name} onSelect={() => navigate.pushModal('player', { params: {
              ...livePlayerParams(channel), link: channel.url, channelGeo: channel.geo ?? null,
              freeQueue: free.map(({ id, name, url, geo }) => ({ id, name, url: url ?? '', geo: geo ?? null })),
            } })}>
            <span className="hub__channel-logo"><ChannelLogo key={channel.logo} logo={channel.logo} /></span>
            <span>{channel.name}</span>
          </FocusButton>)}
        </Rail>}
        <div className="hub__list">
          <FocusButton id="launch-watchlist" variant="quiet" onSelect={() => navigate.push('watchlist')} tabIndex={0}>My List</FocusButton>
        </div>
      </div>
      <PatchNotesPopup />
    </main>
  );
}

function IconWatchlistFrame(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8h16v11H4zM7 5h10M10 2h4m1 11.5L10 11v5z" />
  </svg>;
}
