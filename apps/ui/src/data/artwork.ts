export type ArtworkKind = 'poster' | 'backdrop';

const METAHUB = 'https://images.metahub.space';
const TMDB = 'https://image.tmdb.org/t/p';
const HTTPS_HOSTS =
  /(?:^|\.)(?:image\.tmdb\.org|images\.metahub\.space|live\.metahub\.space|mzstatic\.com|tvmaze\.com|kitsu\.io|fanart\.tv)$/i;

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

function preferHttps(url: string): string {
  if (!url.startsWith('http://')) return url;
  try {
    const parsed = new URL(url);
    if (HTTPS_HOSTS.test(parsed.hostname)) {
      parsed.protocol = 'https:';
      return parsed.href;
    }
  } catch {
    return url;
  }
  return url;
}

/** Make a catalog/CDN still a real img src: protocol, host, TMDB path. */
export function normalizeArtUrl(url: string): string {
  const raw = url.trim();
  if (raw === '') return '';
  let next = raw;
  if (next.startsWith('//')) return preferHttps(`https:${next}`);
  if (/^https?:\/\//i.test(next)) return preferHttps(next);
  if (next.startsWith('/t/p/')) return `${TMDB.replace('/t/p', '')}${next}`;
  if (/^(?:www\.)?image\.tmdb\.org\//i.test(next)) return preferHttps(`https://${next.replace(/^www\./i, '')}`);
  if (/^(?:images|live)\.metahub\.space\//i.test(next)) return preferHttps(`https://${next}`);
  if (/^\/[A-Za-z0-9]+\.(?:jpg|jpeg|png|webp)$/i.test(next)) return `${TMDB}/original${next}`;
  return next;
}

/** Prefer a wide still over a poster, and bump known size tokens. */
export function upgradeImageUrl(url: string, kind: ArtworkKind): string {
  let next = normalizeArtUrl(url);
  if (next === '') return next;
  next = next.replace(/\/poster\/(?:small|medium)\//, '/poster/large/');
  next = next.replace(/\/background\/(?:small|medium)\//, '/background/large/');
  if (kind === 'backdrop') {
    next = next.replace(/\/t\/p\/(?:original|w(?:300|500|1280))\//, '/t/p/w780/');
  } else {
    next = next.replace(/\/t\/p\/(?:original|w(?:154|185|500|780))\//, '/t/p/w342/');
  }
  next = next.replace(/\/\d+x\d+bb/, '/780x780bb');
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
