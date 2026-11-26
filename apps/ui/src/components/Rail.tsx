import type { ReactElement, ReactNode } from 'react';
import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  cancelLoopingTrack,
  isFocusNearRailEnd,
  isLoopSeamJump,
  isScrollNearRailEnd,
  loopRepeatCopies,
  measureLoopSetWidth,
  normalizeLoopScroll,
  parkLoopScroll,
  readLoopSetWidth,
  shouldLoopRail,
} from '../nav/loopingRail';
import { isScrollAnimating, jumpAxis, scrollAxis, scrollTarget } from '../nav/scrollAnim';
import { IconChevronLeft } from './Icons';
import { installHoverYield } from './hoverYield';
import { watchRailBitmaps } from './railBitmaps';

export interface RailPagingState {
  id: string;
  hasMore: boolean;
  onNearEnd: () => void;
}

const RailPagingContext = createContext<RailPagingState | null>(null);

export function RailPaging({
  railId,
  hasMore,
  onNearEnd,
  children,
}: {
  railId: string;
  hasMore: boolean;
  onNearEnd: () => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <RailPagingContext.Provider value={{ id: railId, hasMore, onNearEnd }}>
      {children}
    </RailPagingContext.Provider>
  );
}

interface RailProps {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  id?: string;
  bare?: boolean;
  /**
   * Repeat the row endlessly.
   *
   * On by default so category carousels scroll in a continuous, infinite loop
   * by keyboard/remote arrows, mouse wheel, trackpad, and touch drag. Finite
   * personal shelves like Continue Watching can pass `loop={false}`.
   */
  loop?: boolean;
  className?: string;
  hasMore?: boolean;
  onNearEnd?: () => void;
}

function cameraBusy(track: HTMLElement): boolean {
  return track.dataset.wrapping === 'true' || isScrollAnimating(track);
}

function trackHasFocus(track: HTMLElement): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && track.contains(active);
}

function syncConveyor(
  track: HTMLElement,
  leadCopies: number,
  setLeadCopies: (next: number) => void,
  previousLoopState: { looping: boolean; scrollLeft: number },
): void {
  if (cameraBusy(track)) return;

  const clone = track.querySelector<HTMLElement>('[data-loop-clone="true"]');
  if (clone === null) {
    track.dataset.looping = 'false';
    return;
  }

  track.dataset.loopLead = String(leadCopies);
  const setWidth = measureLoopSetWidth(track);
  track.dataset.loopSet = String(setWidth);

  const desiredLead = loopRepeatCopies(setWidth, track.clientWidth);
  if (desiredLead > leadCopies) {
    setLeadCopies(desiredLead);
    return;
  }

  track.dataset.looping = 'true';
  if (setWidth <= 0) return;

  if (!previousLoopState.looping) {
    const target = normalizeLoopScroll(
      previousLoopState.scrollLeft + leadCopies * setWidth,
      setWidth,
      track.clientWidth,
      leadCopies,
    );
    jumpAxis(track, 'x', target);
    return;
  }

  if (track.scrollLeft < 1) {
    jumpAxis(track, 'x', leadCopies * setWidth);
    return;
  }
  if (trackHasFocus(track)) return;
  const next = parkLoopScroll(track);
  if (isLoopSeamJump(track.scrollLeft, next, setWidth)) jumpAxis(track, 'x', next);
}

function LoopingTrack({
  children,
  loop,
  hasMore,
  onNearEnd,
}: {
  children: ReactNode;
  loop: boolean;
  hasMore: boolean;
  onNearEnd?: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const items = Children.toArray(children).filter(isValidElement);
  const [leadCopies, setLeadCopies] = useState(1);
  // Paging grows the row linearly until the source is exhausted, then flips to an endless ring.
  const looping = loop && !hasMore && shouldLoopRail(items.length);
  const stamp = items.map((child, index) => String(child.key ?? index)).join('|');
  const viewport = useRef<HTMLDivElement>(null);
  const prevLoopRef = useRef<{ looping: boolean; scrollLeft: number }>({
    looping,
    scrollLeft: 0,
  });

  useEffect(() => {
    setLeadCopies(1);
  }, [looping]);

  const paintCopy = (copyAttr: number, keyPrefix: string) =>
    items.map((child, index) =>
      cloneElement(child as ReactElement<{ loopCopy?: number }>, {
        key: `${String(child.key ?? index)}-${keyPrefix}`,
        loopCopy: copyAttr,
      }),
    );

  const painted = looping
    ? [
        ...Array.from({ length: leadCopies }, (_, idx) => paintCopy(0, `pre-${idx}`)).flat(),
        ...paintCopy(1, 'mid'),
        ...Array.from({ length: leadCopies }, (_, idx) => paintCopy(2, `post-${idx}`)).flat(),
      ]
    : items;

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const prev = prevLoopRef.current;
    if (!looping) {
      el.dataset.looping = 'false';
      el.dataset.loopLead = '1';
      prevLoopRef.current = { looping: false, scrollLeft: el.scrollLeft };
      return;
    }
    syncConveyor(el, leadCopies, setLeadCopies, prev);
    prevLoopRef.current = { looping: true, scrollLeft: el.scrollLeft };
  }, [looping, leadCopies, stamp]);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;

    const checkNearEnd = (): void => {
      if (!hasMore || onNearEnd === undefined || items.length === 0) return;
      const pitch = el.scrollWidth > 0 ? el.scrollWidth / items.length : 220;
      if (isScrollNearRailEnd(el.scrollLeft, el.clientWidth, el.scrollWidth, pitch)) {
        onNearEnd();
      }
    };

    const syncEdges = (): void => {
      const end = el.scrollWidth - el.clientWidth;
      const left = end > 2 && (looping || el.scrollLeft > 2);
      const right = end > 2 && (looping || el.scrollLeft < end - 2);
      viewport.current?.toggleAttribute('data-left', left);
      viewport.current?.toggleAttribute('data-right', right);
    };
    checkNearEnd();
    syncEdges();

    let resizeRaf = 0;
    const resize = new ResizeObserver(() => {
      if (resizeRaf !== 0) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        if (!el.isConnected) return;
        if (looping) {
          syncConveyor(el, leadCopies, setLeadCopies, { looping: true, scrollLeft: el.scrollLeft });
        }
        checkNearEnd();
        syncEdges();
      });
    });
    resize.observe(el);

    let parkRaf = 0;
    let idleTimer = 0;
    const tryParkLoop = (forceOuter = false): void => {
      if (!el.isConnected || el.dataset.looping !== 'true') return;
      if (cameraBusy(el)) return;
      if (!forceOuter && trackHasFocus(el)) return;
      const setWidth = readLoopSetWidth(el);
      const currentLead = Math.max(1, Number(el.dataset.loopLead ?? '1') || 1);
      if (forceOuter) {
        const minSafe = setWidth * 0.25;
        const maxSafe = el.scrollWidth - el.clientWidth - setWidth * 0.25;
        if (el.scrollLeft > minSafe && el.scrollLeft < maxSafe) return;
      }
      const next = normalizeLoopScroll(el.scrollLeft, setWidth, el.clientWidth, currentLead);
      if (!isLoopSeamJump(el.scrollLeft, next, setWidth)) return;
      jumpAxis(el, 'x', next);
    };

    const onScroll = (): void => {
      prevLoopRef.current = { looping, scrollLeft: el.scrollLeft };
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => tryParkLoop(true), 90);
      if (parkRaf !== 0) return;
      parkRaf = requestAnimationFrame(() => {
        parkRaf = 0;
        if (!el.isConnected) return;
        checkNearEnd();
        syncEdges();
        if (el.dataset.looping === 'true') tryParkLoop(false);
      });
    };

    const onFocusIn = (event: FocusEvent): void => {
      if (!hasMore || onNearEnd === undefined || !(event.target instanceof HTMLElement)) return;
      const cards = el.querySelectorAll<HTMLElement>('[data-focus-id]:not([data-loop-clone="true"])');
      const idx = Array.prototype.indexOf.call(cards, event.target);
      if (isFocusNearRailEnd(idx, items.length)) onNearEnd();
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('focusin', onFocusIn);
    return () => {
      cancelLoopingTrack(el);
      resize.disconnect();
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('focusin', onFocusIn);
      window.clearTimeout(idleTimer);
      if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
      if (parkRaf !== 0) cancelAnimationFrame(parkRaf);
    };
  }, [hasMore, items.length, leadCopies, looping, onNearEnd, stamp]);

  const scroll = (direction: number): void => {
    const track = ref.current;
    if (track) scrollAxis(track, 'x', scrollTarget(track, 'x') + direction * track.clientWidth * 0.78);
  };

  return (
    <div ref={viewport} className="rail__viewport">
      <div
        ref={ref}
        className="rail__track"
        data-wrap="row"
        data-loop-count={looping ? String(items.length) : undefined}
        data-loop-lead={looping ? String(leadCopies) : undefined}
      >
        {painted}
      </div>
      <button type="button" className="rail__chevron rail__chevron--left glass glass--chrome" tabIndex={-1}
        aria-label="Scroll rail left" onClick={() => scroll(-1)}><IconChevronLeft /></button>
      <button type="button" className="rail__chevron rail__chevron--right glass glass--chrome" tabIndex={-1}
        aria-label="Scroll rail right" onClick={() => scroll(1)}><IconChevronLeft /></button>
    </div>
  );
}

export function Rail({
  title,
  children,
  action,
  id,
  bare = false,
  loop = true,
  className,
  hasMore,
  onNearEnd,
}: RailProps): React.JSX.Element {
  const railRef = useRef<HTMLElement>(null);
  const paging = useContext(RailPagingContext);
  const effectiveHasMore = hasMore ?? paging?.hasMore ?? false;
  const effectiveOnNearEnd = onNearEnd ?? paging?.onNearEnd;

  useLayoutEffect(() => {
    const el = railRef.current;
    if (el === null) return undefined;
    installHoverYield();
    return watchRailBitmaps(el);
  }, []);

  return (
    <section ref={railRef} className={`rail${bare ? ' rail--bare' : ''}${className ? ` ${className}` : ''}`} data-rail={id ?? paging?.id}>
      {!bare && title !== undefined && title !== '' && (
        <header className="rail__header">
          <h2 className="rail__title">{title}</h2>
          {action}
        </header>
      )}
      <LoopingTrack loop={loop} hasMore={effectiveHasMore} onNearEnd={effectiveOnNearEnd}>
        {children}
      </LoopingTrack>
    </section>
  );
}
