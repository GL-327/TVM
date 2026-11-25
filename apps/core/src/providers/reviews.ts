/*
 * Ratings and top reviews for the Details page.
 *
 * The rating is IMDb's (Cinemeta carries it). IMDb turns away automated
 * requests for its reviews, so the reviews come from Letterboxd, which
 * resolves an IMDb id to its film page and lists the most liked reviews.
 * Letterboxd covers films only; series get the rating and an IMDb link.
 * Anything that fails returns no reviews rather than an error.
 */

export interface Review {
  author: string;
  /** 0–5 in halves, or null when the reviewer gave no stars. */
  stars: number | null;
  text: string;
  likes: number | null;
  url: string;
}

export interface ReviewsPayload {
  imdbId: string;
  imdbUrl: string;
  rating: number | null;
  source: 'letterboxd' | null;
  sourceUrl: string | null;
  /** Letterboxd's average, 0–5. */
  average: number | null;
  reviews: Review[];
}

const LETTERBOXD = 'https://letterboxd.com';
const FETCH_MS = 9_000;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED = 300;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
export const REVIEW_TEXT_MAX = 420;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

export function plainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function starsFromLabel(label: string): number | null {
  const full = (label.match(/★/g) ?? []).length;
  const half = label.includes('½') ? 0.5 : 0;
  const value = full + half;
  return value > 0 ? Math.min(5, value) : null;
}

export function clampReview(text: string, max = REVIEW_TEXT_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Reviews from a Letterboxd film page's popular reviews, most liked first. */
export function parseLetterboxdReviews(html: string, limit = 3): Review[] {
  const reviews: Review[] = [];
  for (const block of html.split('<article class="production-viewing').slice(1)) {
    if (/contains-spoilers|This review may contain spoilers/i.test(block)) continue;
    const body = block.match(/js-review-body[^>]*>([\s\S]*?)<\/div>/)?.[1];
    if (body === undefined) continue;
    const text = plainText(body);
    if (text.length < 40) continue;
    const author = decodeEntities(block.match(/class="displayname">([^<]{1,80})</)?.[1]?.trim() ?? '');
    const path = block.match(/href="(\/[^"\s]+\/film\/[^"\s]+\/)"\s+class="context"/)?.[1];
    const rating = block.match(/class="glyph -rating"[^>]*aria-label="([^"]*)"/)?.[1] ?? '';
    const likes = Number(block.match(/data-count="(\d+)"/)?.[1] ?? Number.NaN);
    reviews.push({
      author: author === '' ? 'Letterboxd member' : author,
      stars: starsFromLabel(rating),
      text: clampReview(text),
      likes: Number.isFinite(likes) ? likes : null,
      url: path === undefined ? LETTERBOXD : `${LETTERBOXD}${path}`,
    });
  }
  reviews.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
  return reviews.slice(0, limit);
}

export function letterboxdAverage(html: string): number | null {
  const match = html.match(/name="twitter:data2" content="([\d.]+) out of 5"/);
  const value = match === null ? Number.NaN : Number(match[1]);
  return Number.isFinite(value) && value > 0 && value <= 5 ? value : null;
}

export function imdbUrl(imdbId: string): string {
  return `https://www.imdb.com/title/${imdbId}/`;
}

export function createReviewsService(options: { fetch?: typeof fetch; now?: () => number; rating?: (imdbId: string) => Promise<number | null> } = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; data: ReviewsPayload }>();
  const inflight = new Map<string, Promise<ReviewsPayload>>();

  const page = async (url: string): Promise<{ html: string; url: string } | null> => {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_MS),
      headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'en-GB,en;q=0.9' },
    });
    if (!response.ok) return null;
    return { html: await response.text(), url: response.url || url };
  };

  const load = async (imdbId: string): Promise<ReviewsPayload> => {
    const rating = (await options.rating?.(imdbId).catch(() => null)) ?? null;
    const base: ReviewsPayload = { imdbId, imdbUrl: imdbUrl(imdbId), rating, source: null, sourceUrl: null, average: null, reviews: [] };
    try {
      const film = await page(`${LETTERBOXD}/imdb/${imdbId}/`);
      if (film === null || !/letterboxd\.com\/film\/[^/]+\/?$/.test(film.url)) return base;
      const filmUrl = film.url.endsWith('/') ? film.url : `${film.url}/`;
      // The film page carries its popular reviews; the separate reviews page
      // turns away non-browser clients.
      return {
        ...base,
        source: 'letterboxd',
        sourceUrl: filmUrl,
        average: letterboxdAverage(film.html),
        reviews: parseLetterboxdReviews(film.html),
      };
    } catch {
      return base;
    }
  };

  return {
    async get(id: string): Promise<ReviewsPayload | null> {
      const imdbId = id.match(/tt\d{5,10}/i)?.[0]?.toLowerCase();
      if (imdbId === undefined) return null;
      const hit = cache.get(imdbId);
      if (hit !== undefined && now() - hit.at < TTL_MS) return hit.data;
      const running = inflight.get(imdbId);
      if (running !== undefined) return running;
      const task = load(imdbId)
        .then((data) => {
          // Only remember answers that found something, so a network blip is retried.
          if (data.source !== null || data.rating !== null) {
            cache.set(imdbId, { at: now(), data });
            if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
          }
          return data;
        })
        .finally(() => inflight.delete(imdbId));
      inflight.set(imdbId, task);
      return task;
    },
  };
}

export type ReviewsService = ReturnType<typeof createReviewsService>;
