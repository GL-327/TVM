export interface ArtworkUrls {
  poster: string;
  backdrop: string;
}

const UA = 'TVM/0.1 (GLogic Studios; https://github.com/GL-327/TVM)';
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

const HTTPS_HOSTS =
  /(?:^|\.)(?:image\.tmdb\.org|images\.metahub\.space|live\.metahub\.space|mzstatic\.com|tvmaze\.com|kitsu\.io|fanart\.tv)$/i;

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
  if (next.startsWith('/t/p/')) return `https://image.tmdb.org${next}`;
  if (/^(?:www\.)?image\.tmdb\.org\//i.test(next)) return preferHttps(`https://${next.replace(/^www\./i, '')}`);
  if (/^(?:images|live)\.metahub\.space\//i.test(next)) return preferHttps(`https://${next}`);
  if (/^\/[A-Za-z0-9]+\.(?:jpg|jpeg|png|webp)$/i.test(next)) return `https://image.tmdb.org/t/p/original${next}`;
  return next;
}

export function upgradeImageUrl(url: string, kind: 'poster' | 'backdrop'): string {
  let next = normalizeArtUrl(url);
  if (next === '') return next;
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

export function artworkQueries(title: string): string[] {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (clean.length < 2) return [];
  const queries = [clean];
  const withoutSeason = clean.replace(/\s+(s\d{1,2}.*|season\s+\d+.*)$/i, '').trim();
  if (withoutSeason !== clean && withoutSeason.length >= 2) queries.push(withoutSeason);
  const words = clean.split(' ');
  if (words.length > 2) queries.push(words.slice(0, 2).join(' '));
  return [...new Set(queries)].filter((query) => query.length >= 2).slice(0, 2);
}

function itunesArt(art: string | undefined): ArtworkUrls | null {
  if (art === undefined || art === '') return null;
  const large = art.replace(/(\d+)x\d+bb/, '2000x2000bb');
  return { poster: large, backdrop: large };
}

async function fromItunes(
  term: string,
  media: 'movie' | 'tvShow',
  fetchImpl: typeof fetch,
): Promise<ArtworkUrls | null> {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({
    term,
    media,
    limit: '1',
  }).toString()}`;
  const response = await fetchImpl(url, { headers: { 'user-agent': UA } });
  if (!response.ok) return null;
  const body = (await response.json()) as { results?: Array<{ artworkUrl100?: string }> };
  return itunesArt(body.results?.[0]?.artworkUrl100);
}

async function fromTvmaze(term: string, fetchImpl: typeof fetch): Promise<ArtworkUrls | null> {
  const url = `https://api.tvmaze.com/singlesearch/shows?${new URLSearchParams({ q: term }).toString()}`;
  const response = await fetchImpl(url, { headers: { 'user-agent': UA } });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    image?: { medium?: string; original?: string } | null;
  };
  const poster = body.image?.medium ?? body.image?.original ?? '';
  const backdrop = body.image?.original ?? body.image?.medium ?? '';
  if (poster === '' && backdrop === '') return null;
  return { poster: poster || backdrop, backdrop: backdrop || poster };
}

export async function artworkFor(
  title: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ArtworkUrls | null> {
  for (const query of artworkQueries(title)) {
    try {
      const [movie, show, tv] = await Promise.all([
        fromItunes(query, 'movie', fetchImpl),
        fromItunes(query, 'tvShow', fetchImpl),
        fromTvmaze(query, fetchImpl),
      ]);
      if (movie !== null) return movie;
      if (show !== null) return show;
      if (tv !== null) return tv;
    } catch {
      // Try the next, shorter query.
    }
  }
  return null;
}
