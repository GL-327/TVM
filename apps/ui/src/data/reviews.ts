import { apiFetch } from './media';
import { imdbTitleUrl } from './playId';

export interface ReviewEntry {
  author: string;
  stars: number | null;
  text: string;
  likes: number | null;
  url: string | null;
}

export interface ReviewsPayload {
  imdbId: string;
  imdbUrl: string;
  rating: number | null;
  source: 'letterboxd' | null;
  sourceUrl: string | null;
  average: number | null;
  reviews: ReviewEntry[];
}

const cache = new Map<string, ReviewsPayload>();

export function emptyReviews(imdbId: string): ReviewsPayload {
  return {
    imdbId,
    imdbUrl: imdbTitleUrl(imdbId) ?? `https://www.imdb.com/title/${encodeURIComponent(imdbId)}/`,
    rating: null,
    source: null,
    sourceUrl: null,
    average: null,
    reviews: [],
  };
}

export async function fetchReviews(imdbId: string): Promise<ReviewsPayload> {
  const key = imdbId.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  try {
    const res = await apiFetch(`/api/reviews?id=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return emptyReviews(key);
    const body = (await res.json()) as Partial<ReviewsPayload>;
    const payload: ReviewsPayload = {
      imdbId: typeof body.imdbId === 'string' ? body.imdbId : key,
      imdbUrl: typeof body.imdbUrl === 'string' ? body.imdbUrl : emptyReviews(key).imdbUrl,
      rating: typeof body.rating === 'number' ? body.rating : null,
      source: body.source === 'letterboxd' ? 'letterboxd' : null,
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : null,
      average: typeof body.average === 'number' ? body.average : null,
      reviews: Array.isArray(body.reviews)
        ? body.reviews.slice(0, 3).map((r) => ({
            author: typeof r?.author === 'string' ? r.author : 'Reviewer',
            stars: typeof r?.stars === 'number' ? r.stars : null,
            text: typeof r?.text === 'string' ? r.text : '',
            likes: typeof r?.likes === 'number' ? r.likes : null,
            url: typeof r?.url === 'string' ? r.url : null,
          }))
        : [],
    };
    cache.set(key, payload);
    return payload;
  } catch {
    return emptyReviews(key);
  }
}

export function formatStars(stars: number | null): string {
  if (stars === null || !Number.isFinite(stars) || stars <= 0) return '';
  const clamped = Math.max(0, Math.min(5, stars));
  const full = Math.floor(clamped);
  const half = clamped - full >= 0.5 ? '½' : '';
  return `${'★'.repeat(full)}${half}`;
}
