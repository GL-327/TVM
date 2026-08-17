export type ArtworkKind = 'poster' | 'backdrop';

const METAHUB = 'https://images.metahub.space';

export function imdbIdFrom(value: string): string | null {
  const match = value.match(/tt\d+/i);
  return match === null ? null : match[0].toLowerCase();
}

export function metahubPoster(imdb: string): string {
  return `${METAHUB}/poster/large/${imdb.toLowerCase()}/img`;
}

export function metahubBackdrop(imdb: string): string {
  return `${METAHUB}/background/large/${imdb.toLowerCase()}/img`;
}

/** Prefer a wide still over a poster, and bump known size tokens. */
export function upgradeImageUrl(url: string, kind: ArtworkKind): string {
  if (url === '') return url;
  let next = url;
  next = next.replace(/\/poster\/(?:small|medium)\//, '/poster/large/');
  next = next.replace(/\/background\/(?:small|medium)\//, '/background/large/');
  if (kind === 'backdrop') {
    next = next.replace(/\/t\/p\/w(?:300|500|780|1280)\//, '/t/p/original/');
  } else {
    next = next.replace(/\/t\/p\/w(?:154|185|342|500)\//, '/t/p/w780/');
  }
  next = next.replace(/\/\d+x\d+bb/, '/2000x2000bb');
  return next;
}

export function preferBackdrop(id: string, backdrop: string, poster: string): string {
  const wide = upgradeImageUrl(backdrop, 'backdrop');
  if (wide !== '') return wide;
  const imdb = imdbIdFrom(id);
  if (imdb !== null) return metahubBackdrop(imdb);
  return upgradeImageUrl(poster, 'backdrop');
}

export function preferPoster(id: string, poster: string, backdrop: string): string {
  const card = upgradeImageUrl(poster, 'poster');
  if (card !== '') return card;
  const imdb = imdbIdFrom(id);
  if (imdb !== null) return metahubPoster(imdb);
  return upgradeImageUrl(backdrop, 'poster');
}
