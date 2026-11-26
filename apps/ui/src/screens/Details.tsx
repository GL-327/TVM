import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Artwork } from '../components/Artwork';
import { BackButton } from '../components/BackButton';
import { Chip } from '../components/Chip';
import { ErrorState } from '../components/ErrorState';
import { FocusButton } from '../components/FocusButton';
import { ImdbBadge, openExternalUrl } from '../components/ImdbBadge';
import { mapRailPosters } from '../components/PosterCard';
import { Rail } from '../components/Rail';
import { Skeleton } from '../components/Skeleton';
import { ToastPill, useToast } from '../components/ToastPill';
import { TrailerModal } from '../components/TrailerModal';
import { DetailsMedia } from '../components/DetailsMedia';
import { QualityBadges } from '../components/QualityBadges';
import { useVersions, VersionSelect } from '../components/VersionSelect';
import { episodeIsWatched, uiExtraEnabled, useExtraPrefs } from '../data/uiExtras';
import { titleById, type Title } from '../data/catalog';
import { episodeHeading } from '../data/episodes';
import {
  fetchExtrasAnimeTitle,
  fetchExtrasCollection,
  fetchExtrasTrailers,
  fetchExtrasUpcoming,
  formatEpisodeCode,
  formatUpcomingDate,
  isAnimeCandidate,
  shouldShowAnimeEnglishTitle,
  visibleCollectionItems,
  type ExtrasAnimeTitle,
  type ExtrasCollection,
  type ExtrasTrailer,
  type ExtrasUpcomingEpisode,
} from '../data/extras';
import {
  addWatchlist,
  asTitle,
  fetchChildren,
  fetchMedia,
  fetchWatchlist,
  removeWatchlist,
  toMediaItem,
  type MediaItem,
} from '../data/media';
import { openDetails, titleFromDetailsParams } from '../data/openDetails';
import { isKidsProfile, peekActiveProfile } from '../data/profiles';
import { fetchServices, openServiceExternal, serviceUrlForTitle, type ConnectedServiceStatus } from '../data/services';
import { certificateLabel, formatAired, imdbIdFrom, imdbScore, imdbTitleUrl, playIdFor, seriesGraphUrl } from '../data/playId';
import { asSeason, episodesForSeason, seasonNumbers } from '../data/seasons';
import { requestFocus } from '../nav/focusEngine';
import { useFocusScope, useNavigate, useViewStack } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import './details.css';

function sameWork(current: Title, incoming: Title): boolean {
  if (current.id !== '' && incoming.id !== '' && current.id === incoming.id) return true;
  return current.title.toLowerCase() === incoming.title.toLowerCase();
}

function episodeCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'episode' : 'episodes'}`;
}

function DetailsShell({
  series,
  title,
  overlay,
  media,
  children,
}: {
  series: boolean;
  title?: Title;
  overlay?: ReactNode;
  media?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  const blocked = overlay !== undefined && overlay !== null;
  return (
    <main className={`details${series ? ' details--series' : ''}`}>
      <div className="details__stage" aria-hidden="true">
        {title !== undefined && <Artwork title={title} kind="backdrop" className="details__backdrop" eager />}
        {media}
        <div className="details__vignette" />
      </div>
      <div className="details__body" inert={blocked}>{children}</div>
      {overlay}
    </main>
  );
}

export function Details({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const scope = useFocusScope();
  const stack = useViewStack();
  const prefs = useExtraPrefs();
  const showTrailers = uiExtraEnabled('trailers', prefs);
  const loadTrailers = showTrailers || uiExtraEnabled('trailerBackdrops', prefs);
  const showCollection = uiExtraEnabled('collections', prefs);
  const showComingUp = uiExtraEnabled('comingUp', prefs);
  const showAnimeTitles = uiExtraEnabled('animeTitles', prefs);
  const showRatings = uiExtraEnabled('ratings', prefs);
  const id = typeof params['id'] === 'string' ? params['id'] : '';
  const catalog = titleById(id);
  const snapshot = titleFromDetailsParams(params, catalog);
  const [title, setTitle] = useState<Title | undefined>(snapshot);
  const [files, setFiles] = useState<MediaItem[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingEpisodes, setLoadingEpisodes] = useState(
    snapshot?.kind === 'series' || catalog?.kind === 'series',
  );
  const [season, setSeason] = useState<number | null>(null);
  const [loadingTitle, setLoadingTitle] = useState(snapshot === undefined && id !== '');
  const [attempt, setAttempt] = useState(0);
  const [connectedServices, setConnectedServices] = useState<ConnectedServiceStatus[]>([]);
  const [trailers, setTrailers] = useState<ExtrasTrailer[]>([]);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [collection, setCollection] = useState<ExtrasCollection | null>(null);
  const [upcoming, setUpcoming] = useState<ExtrasUpcomingEpisode | null>(null);
  const [animeInfo, setAnimeInfo] = useState<ExtrasAnimeTitle | null>(null);
  const [versionEpisode, setVersionEpisode] = useState('');
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const { message: toast, showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    void fetchServices().then((list) => {
      if (!cancelled) setConnectedServices(list.filter((svc) => svc.connected));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchWatchlist().then((items) => {
      if (!cancelled) setSaved(items.some((item) => item.id === id || item.id.startsWith(`${id}:`)));
    });
    if (id === '') return () => {
      cancelled = true;
    };
    if (snapshot === undefined) setLoadingTitle(true);
    void fetchMedia(id).then((item) => {
      if (cancelled || item === null) return;
      const incoming = asTitle(item);
      setTitle((current) => {
        if (current === undefined) return incoming;
        if (!sameWork(current, incoming)) return current;
        return {
          ...incoming,
          kind: current.kind === 'series' || incoming.kind === 'series' ? 'series' : incoming.kind,
          title: current.title !== '' ? current.title : incoming.title,
          poster: current.poster !== '' ? current.poster : incoming.poster,
          backdrop: current.backdrop !== '' ? current.backdrop : incoming.backdrop,
        };
      });
    }).finally(() => { if (!cancelled) setLoadingTitle(false); });
    return () => {
      cancelled = true;
    };
  }, [attempt, id]);

  useEffect(() => {
    let cancelled = false;
    const current = title;
    if (current === undefined) return undefined;
    const queryId = imdbIdFrom(current.id) ?? current.id;
    if (queryId === '') {
      setLoadingEpisodes(false);
      return undefined;
    }
    setLoadingEpisodes(true);
    void fetchChildren(queryId)
      .then((items) => {
        if (cancelled) return;
        setFiles(items);
        const hasEpisodes = items.some(
          (item) => asSeason(item.season) !== undefined || asSeason(item.episode) !== undefined,
        );
        if (hasEpisodes) {
          setTitle((prev) => (prev === undefined || prev.kind === 'series' ? prev : { ...prev, kind: 'series' }));
        }
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingEpisodes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, title?.id]);

  const seriesLike = title !== undefined && (title.kind === 'series' || files.some((file) => asSeason(file.season) !== undefined));

  const seasons = useMemo(() => seasonNumbers(files), [files]);

  const episodeCountBySeason = useMemo(() => {
    const counts = new Map<number, number>();
    for (const file of files) {
      const season = asSeason(file.season);
      if (season === undefined) continue;
      counts.set(season, (counts.get(season) ?? 0) + 1);
    }
    return counts;
  }, [files]);

  const visibleFiles = useMemo(() => episodesForSeason(files, season), [files, season]);
  const versionFile = visibleFiles.find((file) => file.id === versionEpisode) ?? visibleFiles[0] ?? files[0];
  const versionIdentity = { id: seriesLike && versionFile ? playIdFor(versionFile.id || id, versionFile.season, versionFile.episode) : playIdFor(id),
    season: seriesLike ? versionFile?.season : undefined, episode: seriesLike ? versionFile?.episode : undefined };
  const versions = useVersions(versionIdentity, uiExtraEnabled('versionPicker', prefs) || uiExtraEnabled('qualityBadges', prefs));

  useEffect(() => {
    setTrailers([]);
    setTrailerOpen(false);
    setCollection(null);
    setAnimeInfo(null);
    if (title === undefined) return undefined;
    let cancelled = false;
    const imdb = imdbIdFrom(title.id);
    if (imdb !== null) {
      if (loadTrailers) void fetchExtrasTrailers(imdb).then((list) => {
        if (!cancelled && list !== null) setTrailers(list);
      });
      if (showCollection) void fetchExtrasCollection(imdb).then((col) => {
        if (!cancelled && col !== null) setCollection(col);
      });
    }
    if (showAnimeTitles && isAnimeCandidate(title.genres) && title.title.trim() !== '') {
      void fetchExtrasAnimeTitle(title.title).then((info) => {
        if (!cancelled && info !== null) setAnimeInfo(info);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [loadTrailers, showAnimeTitles, showCollection, title?.genres, title?.id, title?.title]);

  useEffect(() => {
    if (!showComingUp || !seriesLike || title === undefined) {
      setUpcoming(null);
      return undefined;
    }
    const imdb = imdbIdFrom(title.id);
    if (imdb === null) {
      setUpcoming(null);
      return undefined;
    }
    let cancelled = false;
    void fetchExtrasUpcoming(imdb).then((next) => {
      if (!cancelled) setUpcoming(next);
    });
    return () => {
      cancelled = true;
    };
  }, [seriesLike, showComingUp, title?.id]);

  const collectionItems = useMemo(
    () => (title === undefined || !showCollection ? [] : visibleCollectionItems(collection, title.id)),
    [collection, showCollection, title],
  );

  const hasTitle = title !== undefined;
  const firstSeason = seasons[0];
  useEffect(() => {
    if (!hasTitle || season !== null) return;
    // Episode data may arrive after the viewer has already moved to a control.
    if (seriesLike && firstSeason !== undefined && document.activeElement?.closest('[data-focus-scope]')?.getAttribute('data-focus-scope') === scope
      && document.activeElement.getAttribute('data-focus-id') !== 'back') return;
    const next = seriesLike && firstSeason !== undefined ? `season-${firstSeason}` : seriesLike ? 'back' : 'play';
    const timer = window.setTimeout(() => requestFocus(`${scope}/${next}`), 0);
    return () => window.clearTimeout(timer);
  }, [scope, seriesLike, firstSeason, season, hasTitle]);

  useEffect(() => {
    if (season === null) return;
    const first = files.find((file) => file.season === season);
    if (first === undefined) return;
    const timer = window.setTimeout(() => requestFocus(`${scope}/ep-${first.id}`), 0);
    return () => window.clearTimeout(timer);
  }, [files, scope, season]);

  if (title === undefined) {
    if (loadingTitle) {
      return (
        <DetailsShell series={false}>
          <BackButton id="back" className="details__back" />
          <div className="details__hero">
            <div className="details__poster-stage">
              <Skeleton className="details__poster" label="Loading artwork" />
            </div>
            <div className="details__copy">
              <Skeleton className="skeleton--hero" label="Loading title" />
            </div>
          </div>
        </DetailsShell>
      );
    }
    return (
      <main className="page page--details">
        <ErrorState
          title="Missing title"
          body="This title could not be loaded. Check the connection, or choose another title."
          onRetry={() => setAttempt((value) => value + 1)}
          onBack={() => navigate.pop()}
        />
      </main>
    );
  }

  const score = imdbScore(title.rating);
  const certificate = certificateLabel(title.rating);
  const imdbUrl = imdbTitleUrl(title.id);
  const englishSubtitle = showAnimeTitles && animeInfo !== null ? shouldShowAnimeEnglishTitle(title.title, animeInfo.english) : null;
  const upcomingDate = upcoming !== null ? formatUpcomingDate(upcoming.airstamp) : null;
  const isAnimeTitle = animeInfo?.malId != null || title.genres.some((genre) => /^anime$/i.test(genre));

  const openWeb = (url: string, name: string): void => {
    navigate.push('service', { params: { id: name.toLowerCase(), url, title: name } });
  };

  const playItem = (item: MediaItem): void => {
    const playId = playIdFor(item.id || title.id, item.season, item.episode);
    navigate.pushModal('player', {
      params: {
        id: playId,
        title: title.title,
        ...(item.season !== undefined ? { season: item.season } : {}),
        ...(item.episode !== undefined ? { episode: item.episode } : {}),
        ...(title.genres.length > 0 ? { genres: [...title.genres] } : {}),
        ...(isAnimeTitle ? { anime: true } : {}),
      },
    });
  };

  const playFilm = (): void => {
    navigate.pushModal('player', {
      params: {
        id: playIdFor(title.id),
        title: title.title,
        ...(title.genres.length > 0 ? { genres: [...title.genres] } : {}),
        ...(isAnimeTitle ? { anime: true } : {}),
      },
    });
  };

  const toggleWatchlist = (): void => {
    if (saving) return;
    setSaving(true);
    void (saved ? removeWatchlist(title.id) : addWatchlist(toMediaItem(title)))
      .then((items) => {
        const nextSaved = items.some((item) => item.id === title.id);
        setSaved(nextSaved);
        showToast(nextSaved ? 'Added to My List' : 'Removed from My List');
      })
      .catch((error: unknown) => navigate.pushModal('notice', { params: {
        title: 'Watchlist', body: error instanceof Error ? error.message : 'Your watchlist could not be updated.',
      } }))
      .finally(() => setSaving(false));
  };

  return (
    <DetailsShell
      series={seriesLike}
      title={title}
      media={<DetailsMedia id={imdbIdFrom(title.id) ?? title.id} trailerId={trailers[0]?.youtubeId}
        active={stack.entries.at(-1)?.key === scope && !trailerOpen} />}
      overlay={
        showTrailers && trailerOpen && trailers.length > 0 ? (
          <TrailerModal
            title={title.title}
            trailers={trailers}
            onClose={() => {
              setTrailerOpen(false);
              requestFocus(`${scope}/trailer`);
            }}
          />
        ) : null
      }
    >
      <BackButton id="back" className="details__back" />
      <div className="details__hero">
        <div className="details__poster-stage">
          <Artwork title={title} kind="poster" className="details__poster" eager />
        </div>
        <div className="details__copy">
          <p className="stage__kicker">{seriesLike ? 'Series' : 'Film'}</p>
          <h1 className="stage__title">{title.title}</h1>
          {englishSubtitle !== null && (
            <p className="details__anime-subtitle">{englishSubtitle}</p>
          )}
          <p className="stage__meta">
            {showRatings && (score !== null || imdbUrl !== null) && (
              <ImdbBadge
                id="details-imdb-badge"
                mediaId={title.id}
                rating={score}
                isSeries={seriesLike}
                onOpenExternal={(url) => openExternalUrl(url)}
              />
            )}
            {certificate !== null && <Chip>{certificate}</Chip>}
            {title.year > 0 && <span>{title.year}</span>}
            {title.runtime !== undefined && title.runtime !== '' && <span>{title.runtime}</span>}
            {seriesLike && title.seasons !== undefined && title.seasons > 0 && (
              <span>{title.seasons === 1 ? '1 season' : `${title.seasons} seasons`}</span>
            )}
            {title.genres.slice(0, 3).map((genre) => (
              <Chip key={genre}>{genre}</Chip>
            ))}
          </p>
          <div className="hero__actions details__actions">
            {!seriesLike && (
              <FocusButton id="play" variant="primary" onSelect={playFilm}>
                {title.progress !== undefined ? 'Resume' : 'Play'}
              </FocusButton>
            )}
            {!isKidsProfile(peekActiveProfile()) && (
              <FocusButton id="download" className="tvm-button--glass" onSelect={() => navigate.pushModal('downloads', { params: { id: title.id, title: title.title, series: seriesLike, episodes: files } })}>Download</FocusButton>
            )}
            {imdbUrl !== null && (
              <FocusButton id="imdb" className="tvm-button--glass" onSelect={() => openExternalUrl(imdbUrl)}>
                IMDb
              </FocusButton>
            )}
            {seriesLike && (
              <FocusButton
                id="series-graph"
                className="tvm-button--glass"
                onSelect={() => openWeb(seriesGraphUrl(), 'Series Graph')}
              >
                Series Graph
              </FocusButton>
            )}
            <FocusButton id="watchlist" className="tvm-button--glass" onSelect={toggleWatchlist}>
              {saved ? 'Remove from My List' : 'Add to My List'}
            </FocusButton>
            {showTrailers && trailers.length > 0 && (
              <FocusButton id="trailer" className="tvm-button--glass" onSelect={() => setTrailerOpen(true)}>
                Trailer
              </FocusButton>
            )}
          </div>
          <p className="stage__synopsis" aria-hidden={!title.synopsis}>{title.synopsis}</p>
          <QualityBadges info={versions[0] ?? title} />
          {uiExtraEnabled('versionPicker', prefs) && versions.length > 0 && <div className="details__versions">
            {seriesLike && <label className="extras-select">Episode
              <select aria-label="Version for episode" onKeyDown={(event) => event.stopPropagation()} value={versionFile?.id ?? ''} onChange={(event) => setVersionEpisode(event.target.value)}>
                {(visibleFiles.length ? visibleFiles : files).map((file) => <option key={file.id} value={file.id}>
                  {formatEpisodeCode(file.season ?? 1, file.episode ?? 1)} · {episodeHeading(file)}
                </option>)}
              </select>
            </label>}
            <VersionSelect identity={versionIdentity} versions={versions} />
          </div>}
          {showComingUp && seriesLike && upcomingDate !== null && upcoming !== null && (
            <p className="details__coming-up">
              <span className="details__coming-up-badge glass glass--chrome">Coming up</span>
              <span>
                New episode {upcomingDate}
                {upcoming.name !== '' ? ` · ${formatEpisodeCode(upcoming.season, upcoming.episode)} ${upcoming.name}` : ''}
              </span>
            </p>
          )}
          {connectedServices.length > 0 && (
            <div className="details__watch-on" aria-label="Watch on connected services">
              <span className="details__watch-on-label">Watch on</span>
              <div className="details__watch-on-row" data-wrap="row">
                {connectedServices.map((svc) => (
                  <FocusButton
                    key={svc.id}
                    id={`watch-on-${svc.id}`}
                    className="tvm-button--glass"
                    onSelect={() => openServiceExternal(serviceUrlForTitle(svc, title.title), svc)}
                  >
                    Look for it on {svc.name}
                  </FocusButton>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {seriesLike && (
        <section className="episode-picker details__shelf" aria-label="Seasons and episodes">
          {season === null && (
            <div className="season-list" aria-label="Seasons">
              <h2 className="rail__title">Seasons</h2>
              {loadingEpisodes && seasons.length === 0 && (
                <>
                  <Skeleton className="skeleton--episode" label="Loading seasons" />
                  <Skeleton className="skeleton--episode" label="Loading seasons" />
                </>
              )}
              {!loadingEpisodes && seasons.length === 0 && (
                <div>
                  <p className="page__lede">No episodes are available yet. Try loading them again.</p>
                  <FocusButton id="episodes-retry" onSelect={() => setAttempt((value) => value + 1)}>Retry episodes</FocusButton>
                </div>
              )}
              {seasons.map((value) => (
                <FocusButton
                  key={value}
                  id={`season-${value}`}
                  className="season-row-btn"
                  onSelect={() => setSeason(value)}
                >
                  <span className="season-row-btn__name">Season {value}</span>
                  <span className="season-row-btn__count">{episodeCountLabel(episodeCountBySeason.get(value) ?? 0)}</span>
                </FocusButton>
              ))}
            </div>
          )}
          {season !== null && (
            <div className="episode-list" aria-label="Episodes">
              <div className="episode-list__nav">
                <FocusButton
                  id="seasons-back"
                  className="tvm-button--glass"
                  onSelect={() => {
                    const current = season;
                    setSeason(null);
                    if (current !== null) {
                      window.setTimeout(() => requestFocus(`${scope}/season-${current}`), 0);
                    }
                  }}
                >
                  All seasons
                </FocusButton>
                <h2 className="rail__title">Season {season}</h2>
              </div>
              {visibleFiles.map((file) => {
                const label =
                  file.season !== undefined && file.episode !== undefined
                    ? `S${String(file.season).padStart(2, '0')}E${String(file.episode).padStart(2, '0')}`
                    : 'Episode';
                const episodeScore = showRatings ? imdbScore(file.rating) : null;
                const aired = file.aired !== undefined ? formatAired(file.aired) : null;
                const hideSpoilers = uiExtraEnabled('spoilerBlur', prefs) && !episodeIsWatched(file);
                const hideSummary = hideSpoilers && !revealed.has(file.id);
                return (
                  <div key={file.id} className="episode-download-row">
                  <FocusButton
                    key={file.id}
                    id={`ep-${file.id}`}
                    className="episode-item"
                    onSelect={() => playItem(file)}
                  >
                    <span className={`episode-item__still${hideSpoilers ? ' episode-item__still--blurred' : ''}`} aria-hidden="true">
                      {file.poster !== '' && (
                        <img src={file.poster} alt="" loading="lazy" decoding="async" />
                      )}
                    </span>
                    <span className="episode-item__num">{label}</span>
                    <span className="episode-item__copy">
                      <span className="episode-item__name">{episodeHeading(file)}</span>
                      {(episodeScore !== null || aired !== null) && (
                        <span className="episode-item__meta">
                          {episodeScore !== null && <span>IMDb {episodeScore}</span>}
                          {aired !== null && <span>{aired}</span>}
                        </span>
                      )}
                      {file.synopsis !== '' && !hideSummary && <span className="episode-item__synopsis">{file.synopsis}</span>}
                    </span>
                  </FocusButton>
                  {hideSummary && file.synopsis !== '' && <FocusButton id={`summary-${file.id}`} className="episode-download-row__action" onSelect={() => setRevealed((current) => new Set([...current, file.id]))}>Show summary</FocusButton>}
                  <FocusButton id={`download-ep-${file.id}`} className="episode-download-row__action" onSelect={() => navigate.pushModal('downloads', { params: { id: title.id, title: title.title, series: true, episodes: files, season: file.season, episode: file.episode, episodeId: file.id } })}>Download</FocusButton>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
      {collectionItems.length > 0 && (
        <section className="details__collection" aria-label={collection?.name ?? 'Collection'}>
          <Rail id="details-collection" title={collection?.name ?? 'Collection'} loop={false}>
            {mapRailPosters(collectionItems.map(asTitle), 'collection', (picked) => openDetails(navigate, picked))}
          </Rail>
        </section>
      )}
      <ToastPill message={toast} />
    </DetailsShell>
  );
}
