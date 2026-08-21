import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Artwork } from '../components/Artwork';
import { Chip } from '../components/Chip';
import { ErrorState } from '../components/ErrorState';
import { FocusButton } from '../components/FocusButton';
import { Skeleton } from '../components/Skeleton';
import { titleById, type Title } from '../data/catalog';
import { episodeHeading } from '../data/episodes';
import {
  addWatchlist,
  asTitle,
  fetchChildren,
  fetchMedia,
  fetchRdStatus,
  fetchWatchlist,
  removeWatchlist,
  toMediaItem,
  type MediaItem,
  type RdStatus,
} from '../data/media';
import { titleFromDetailsParams } from '../data/openDetails';
import { playbackErrorMessage } from '../data/playbackErrors';
import { certificateLabel, formatAired, imdbIdFrom, imdbScore, imdbTitleUrl, playIdFor, seriesGraphUrl } from '../data/playId';
import { asSeason, episodesForSeason, seasonNumbers } from '../data/seasons';
import { requestFocus } from '../nav/focusEngine';
import { useFocusScope, useNavigate } from '../nav/ViewStackContext';
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
  children,
}: {
  series: boolean;
  title?: Title;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <main className={`details${series ? ' details--series' : ''}`}>
      <div className="details__stage" aria-hidden="true">
        {title !== undefined && <Artwork title={title} kind="backdrop" className="details__backdrop" eager />}
        <div className="details__vignette" />
      </div>
      <div className="details__body">{children}</div>
    </main>
  );
}

export function Details({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const scope = useFocusScope();
  const id = typeof params['id'] === 'string' ? params['id'] : '';
  const catalog = titleById(id);
  const snapshot = titleFromDetailsParams(params, catalog);
  const [title, setTitle] = useState<Title | undefined>(snapshot);
  const [files, setFiles] = useState<MediaItem[]>([]);
  const [saved, setSaved] = useState(false);
  const [loadingEpisodes, setLoadingEpisodes] = useState(
    snapshot?.kind === 'series' || catalog?.kind === 'series',
  );
  const [season, setSeason] = useState<number | null>(null);
  const [rd, setRd] = useState<RdStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchRdStatus().then((status) => {
      if (!cancelled) setRd(status);
    });
    void fetchWatchlist().then((items) => {
      if (!cancelled) setSaved(items.some((item) => item.id === id || item.id.startsWith(`${id}:`)));
    });
    if (id === '') return () => {
      cancelled = true;
    };
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
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

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
  }, [title?.id]);

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

  useEffect(() => {
    if (title === undefined || season !== null) return;
    const next = seriesLike && seasons[0] !== undefined ? `season-${seasons[0]}` : seriesLike ? 'back' : 'play';
    const timer = window.setTimeout(() => requestFocus(`${scope}/${next}`), 0);
    return () => window.clearTimeout(timer);
  }, [scope, seriesLike, seasons, season, title]);

  useEffect(() => {
    if (season === null) return;
    const first = files.find((file) => file.season === season);
    if (first === undefined) return;
    const timer = window.setTimeout(() => requestFocus(`${scope}/ep-${first.id}`), 0);
    return () => window.clearTimeout(timer);
  }, [files, scope, season]);

  if (title === undefined) {
    if (id !== '') {
      return (
        <DetailsShell series={false}>
          <div className="details__hero">
            <div className="details__poster-stage">
              <Skeleton className="details__poster" label="Loading artwork" />
            </div>
            <div className="details__copy">
              <Skeleton className="skeleton--hero" label="Loading title" />
              <div className="hero__actions details__actions">
                <FocusButton id="back" onSelect={() => navigate.pop()}>
                  Back
                </FocusButton>
              </div>
            </div>
          </div>
        </DetailsShell>
      );
    }
    return (
      <main className="page page--details">
        <ErrorState
          title="Missing title"
          body="That title is not in the catalog."
          onBack={() => navigate.pop()}
        />
      </main>
    );
  }

  const score = imdbScore(title.rating);
  const certificate = certificateLabel(title.rating);
  const imdbUrl = imdbTitleUrl(title.id);
  const needsToken = rd !== null && (!rd.configured || rd.error !== null);

  const openWeb = (url: string, name: string): void => {
    navigate.push('service', { params: { id: name.toLowerCase(), url, title: name } });
  };

  const askForToken = (): void => {
    navigate.pushModal('notice', {
      params: {
        title: 'Real-Debrid',
        body: playbackErrorMessage(!rd?.configured ? 'not-configured' : 'needs-auth'),
        action: 'tvm-stream',
      },
    });
  };

  const playItem = (item: MediaItem): void => {
    if (needsToken) {
      askForToken();
      return;
    }
    const playId = playIdFor(item.id.startsWith('tt') ? item.id : title.id, item.season, item.episode);
    navigate.pushModal('player', {
      params: {
        id: playId,
        title: title.title,
        ...(item.season !== undefined ? { season: item.season } : {}),
        ...(item.episode !== undefined ? { episode: item.episode } : {}),
      },
    });
  };

  const playFilm = (): void => {
    if (needsToken) {
      askForToken();
      return;
    }
    navigate.pushModal('player', {
      params: {
        id: playIdFor(title.id),
        title: title.title,
      },
    });
  };

  const toggleWatchlist = (): void => {
    if (saved) {
      void removeWatchlist(title.id).then((items) => setSaved(items.some((item) => item.id === title.id)));
      return;
    }
    void addWatchlist(toMediaItem(title)).then((items) => setSaved(items.some((item) => item.id === title.id)));
  };

  return (
    <DetailsShell series={seriesLike} title={title}>
      <div className="details__hero">
        <div className="details__poster-stage">
          <Artwork title={title} kind="poster" className="details__poster" eager />
        </div>
        <div className="details__copy">
          <p className="stage__kicker">{seriesLike ? 'Series' : 'Film'}</p>
          <h1 className="stage__title">{title.title}</h1>
          <p className="stage__meta">
            {score !== null && <span className="details__imdb">IMDb {score}</span>}
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
            {imdbUrl !== null && (
              <FocusButton id="imdb" className="tvm-button--glass" onSelect={() => openWeb(imdbUrl, 'IMDb')}>
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
            <FocusButton id="back" className="tvm-button--glass" onSelect={() => navigate.pop()}>
              Back
            </FocusButton>
          </div>
          <p className="stage__synopsis">{title.synopsis}</p>
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
                <p className="page__lede">Episodes have not loaded for this series yet.</p>
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
                const episodeScore = imdbScore(file.rating);
                const aired = file.aired !== undefined ? formatAired(file.aired) : null;
                return (
                  <FocusButton
                    key={file.id}
                    id={`ep-${file.id}`}
                    className="episode-item"
                    onSelect={() => playItem(file)}
                  >
                    <span className="episode-item__still" aria-hidden="true">
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
                      {file.synopsis !== '' && <span className="episode-item__synopsis">{file.synopsis}</span>}
                    </span>
                  </FocusButton>
                );
              })}
            </div>
          )}
        </section>
      )}
    </DetailsShell>
  );
}
