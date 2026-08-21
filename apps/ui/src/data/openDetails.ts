import type { Title } from './catalog';
import type { Navigate } from '../nav/ViewStackContext';
import { playIdFor } from './playId';

export function detailsParams(title: Title): Record<string, unknown> {
  return {
    id: title.id,
    kind: title.kind,
    title: title.title,
    year: title.year,
    poster: title.poster,
    backdrop: title.backdrop,
    synopsis: title.synopsis,
    rating: title.rating,
    runtime: title.runtime,
    hue: title.hue,
    genres: [...title.genres],
    ...(title.seasons !== undefined ? { seasons: title.seasons } : {}),
  };
}

export function openDetails(navigate: Navigate, title: Title): void {
  navigate.push('details', { params: detailsParams(title) });
}

export function openPlayback(navigate: Navigate, title: Title): void {
  if (title.kind === 'series') {
    openDetails(navigate, title);
    return;
  }
  navigate.pushModal('player', {
    params: {
      id: playIdFor(title.id),
      title: title.title,
    },
  });
}

export function titleFromDetailsParams(
  params: Readonly<Record<string, unknown>>,
  fallback: Title | undefined,
): Title | undefined {
  const id = typeof params['id'] === 'string' ? params['id'] : '';
  const name = typeof params['title'] === 'string' ? params['title'] : fallback?.title ?? '';
  if (name === '' && fallback === undefined) return undefined;
  const kind = params['kind'] === 'series' || fallback?.kind === 'series' ? 'series' : 'movie';
  const genres = Array.isArray(params['genres'])
    ? params['genres'].filter((entry): entry is string => typeof entry === 'string')
    : (fallback?.genres ?? []);
  return {
    id: id !== '' ? id : (fallback?.id ?? ''),
    title: name !== '' ? name : (fallback?.title ?? ''),
    year: typeof params['year'] === 'number' ? params['year'] : (fallback?.year ?? 0),
    kind,
    synopsis: typeof params['synopsis'] === 'string' ? params['synopsis'] : (fallback?.synopsis ?? ''),
    poster: typeof params['poster'] === 'string' ? params['poster'] : (fallback?.poster ?? ''),
    backdrop: typeof params['backdrop'] === 'string' ? params['backdrop'] : (fallback?.backdrop ?? ''),
    genres,
    rating: typeof params['rating'] === 'string' ? params['rating'] : (fallback?.rating ?? ''),
    runtime: typeof params['runtime'] === 'string' ? params['runtime'] : fallback?.runtime,
    hue: typeof params['hue'] === 'number' ? params['hue'] : (fallback?.hue ?? 0),
    seasons: typeof params['seasons'] === 'number' ? params['seasons'] : fallback?.seasons,
    playable: true,
  };
}
