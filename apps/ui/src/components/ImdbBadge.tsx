import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { emptyReviews, fetchReviews, formatStars, type ReviewsPayload } from '../data/reviews';
import { imdbIdFrom, imdbScore, imdbTitleUrl } from '../data/playId';
import { useScopedFocusKey } from '../nav/ViewStackContext';
import './imdbBadge.css';

export interface ImdbBadgeProps {
  id?: string;
  mediaId: string;
  rating: string | number | null | undefined;
  isSeries?: boolean;
  compact?: boolean;
  onOpenExternal?: (url: string) => void;
}

const HOVER_DELAY_MS = 350;

export function openExternalUrl(url: string): void {
  if (typeof window === 'undefined') return;
  try {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (win === null) window.location.assign(url);
  } catch {
    // Blocked popup: safe no-op.
  }
}

export function ImdbBadge({
  id = 'imdb-badge',
  mediaId,
  rating,
  isSeries = false,
  compact = false,
  onOpenExternal,
}: ImdbBadgeProps): React.JSX.Element | null {
  const score = imdbScore(rating !== null && rating !== undefined ? String(rating) : '');
  const imdbId = imdbIdFrom(mediaId);
  const imdbUrl = imdbId !== null ? imdbTitleUrl(imdbId) : null;
  const focusKey = useScopedFocusKey(id);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<ReviewsPayload | null>(null);
  const delayRef = useRef<number>(0);
  const closeRef = useRef<number>(0);
  const hoveredRef = useRef(false);
  const lastTouchRef = useRef(false);

  const openUrl = useCallback(
    (url: string): void => {
      if (onOpenExternal !== undefined) onOpenExternal(url);
      else openExternalUrl(url);
    },
    [onOpenExternal],
  );

  const ensureLoaded = useCallback((): void => {
    if (imdbId === null || isSeries) {
      if (imdbId !== null) setPayload(emptyReviews(imdbId));
      return;
    }
    if (payload !== null && payload.imdbId === imdbId) return;
    setLoading(true);
    void fetchReviews(imdbId).then((next) => {
      setPayload(next);
      setLoading(false);
    });
  }, [imdbId, isSeries, payload]);

  const scheduleOpen = useCallback((): void => {
    window.clearTimeout(closeRef.current);
    if (open) return;
    window.clearTimeout(delayRef.current);
    delayRef.current = window.setTimeout(() => {
      setOpen(true);
      ensureLoaded();
    }, HOVER_DELAY_MS);
  }, [ensureLoaded, open]);

  const scheduleClose = useCallback((): void => {
    window.clearTimeout(delayRef.current);
    window.clearTimeout(closeRef.current);
    closeRef.current = window.setTimeout(() => {
      if (!hoveredRef.current) setOpen(false);
    }, 180);
  }, []);

  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    onFocus: () => {
      scheduleOpen();
    },
    onBlur: () => {
      scheduleClose();
    },
  });

  useEffect(() => {
    if (focused) scheduleOpen();
    else scheduleClose();
  }, [focused, scheduleOpen, scheduleClose]);

  useEffect(
    () => () => {
      window.clearTimeout(delayRef.current);
      window.clearTimeout(closeRef.current);
    },
    [],
  );

  if (score === null && imdbUrl === null) return null;

  const resolvedUrl = payload?.imdbUrl ?? imdbUrl ?? 'https://www.imdb.com/';
  const reviews = isSeries ? [] : (payload?.reviews ?? []);

  return (
    <span
      className={`imdb-badge-wrap${compact ? ' imdb-badge-wrap--compact' : ''}`}
      onPointerEnter={(event) => {
        hoveredRef.current = true;
        if (event.pointerType !== 'touch') scheduleOpen();
      }}
      onPointerLeave={() => {
        hoveredRef.current = false;
        scheduleClose();
      }}
    >
      <button
        ref={ref}
        type="button"
        tabIndex={-1}
        data-focus-id={id}
        data-focused={focused ? 'true' : undefined}
        className={`imdb-pill${compact ? ' imdb-pill--compact' : ''}`}
        aria-label={score !== null ? `IMDb ${score} out of 10. Open IMDb or view reviews.` : 'Open IMDb'}
        aria-expanded={open}
        onPointerDown={(event) => {
          lastTouchRef.current = event.pointerType === 'touch';
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (lastTouchRef.current && !open) {
            lastTouchRef.current = false;
            setOpen(true);
            ensureLoaded();
            return;
          }
          lastTouchRef.current = false;
          openUrl(resolvedUrl);
        }}
      >
        <span className="imdb-pill__brand">IMDb</span>
        {score !== null && (
          <span className="imdb-pill__score">
            <strong>{score}</strong>
            <span>/10</span>
          </span>
        )}
      </button>

      {open && (
        <div
          className="imdb-popover glass glass--sheet glass-appear"
          role="dialog"
          aria-label="Reviews and IMDb rating"
          onPointerEnter={() => {
            hoveredRef.current = true;
            window.clearTimeout(closeRef.current);
          }}
          onPointerLeave={() => {
            hoveredRef.current = false;
            scheduleClose();
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="imdb-popover__head">
            <span className="imdb-pill imdb-pill--compact">
              <span className="imdb-pill__brand">IMDb</span>
              {score !== null && (
                <span className="imdb-pill__score">
                  <strong>{score}</strong>
                  <span>/10</span>
                </span>
              )}
            </span>
            <span className="imdb-popover__source">
              {!isSeries && payload?.source === 'letterboxd' ? 'Top reviews on Letterboxd' : 'IMDb'}
            </span>
          </div>

          {loading ? (
            <p className="imdb-popover__empty">Loading reviews…</p>
          ) : reviews.length > 0 ? (
            <ul className="imdb-popover__list">
              {reviews.slice(0, 3).map((review, index) => (
                <li key={`${review.author}-${index}`} className="imdb-popover__item">
                  <div className="imdb-popover__meta">
                    <strong>{review.author}</strong>
                    {review.stars !== null && <span className="imdb-popover__stars">{formatStars(review.stars)}</span>}
                  </div>
                  <p className="imdb-popover__text">{review.text}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="imdb-popover__empty">
              {score !== null ? `Rated ${score}/10 on IMDb.` : 'See ratings and cast on IMDb.'}
            </p>
          )}

          <a
            href={resolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="imdb-popover__more glass glass--chrome"
            onClick={(event) => {
              if (onOpenExternal !== undefined) {
                event.preventDefault();
                openUrl(resolvedUrl);
              }
            }}
          >
            {reviews.length > 0 ? 'More reviews on IMDb' : 'Read reviews on IMDb'}
          </a>
        </div>
      )}
    </span>
  );
}
