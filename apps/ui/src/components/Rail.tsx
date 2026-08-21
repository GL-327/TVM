import type { ReactElement, ReactNode } from 'react';
import { Children, cloneElement, isValidElement, useEffect, useLayoutEffect, useRef } from 'react';
import {
  isLoopSeamJump,
  measureLoopSetWidth,
  normalizeLoopScroll,
  oneSetFitsCamera,
  parkLoopScroll,
  readLoopSetWidth,
  shouldLoopRail,
} from '../nav/loopingRail';
import { isScrollAnimating, jumpAxis } from '../nav/scrollAnim';
import { watchRailBitmaps } from './railBitmaps';

interface RailProps {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  id?: string;
  bare?: boolean;
}

function showLoopClones(track: HTMLElement, show: boolean): void {
  for (const node of track.querySelectorAll<HTMLElement>('[data-loop-clone="true"]')) {
    node.hidden = !show;
  }
}

function cameraBusy(track: HTMLElement): boolean {
  return track.dataset.wrapping === 'true' || isScrollAnimating(track);
}

function trackHasFocus(track: HTMLElement): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && track.contains(active);
}

function syncConveyor(track: HTMLElement): void {
  if (cameraBusy(track)) return;

  const clone = track.querySelector<HTMLElement>('[data-loop-clone="true"]');
  if (clone === null) {
    track.dataset.looping = 'false';
    return;
  }

  const clonesHidden = clone.hidden === true;
  if (clonesHidden) {
    const saved = Number(track.dataset.loopSet ?? '0');
    if (saved > track.clientWidth + 2) {
      showLoopClones(track, true);
      track.dataset.looping = 'true';
      requestAnimationFrame(() => {
        if (!track.isConnected || cameraBusy(track)) return;
        const setWidth = measureLoopSetWidth(track);
        track.dataset.loopSet = String(setWidth);
        jumpAxis(track, 'x', setWidth > 1 ? setWidth : saved);
      });
    } else {
      track.dataset.looping = 'false';
    }
    return;
  }

  const setWidth = measureLoopSetWidth(track);
  track.dataset.loopSet = String(setWidth);
  if (oneSetFitsCamera(track, setWidth)) {
    track.dataset.looping = 'false';
    showLoopClones(track, false);
    jumpAxis(track, 'x', 0);
    return;
  }

  track.dataset.looping = 'true';
  if (setWidth <= 0) return;
  if (track.scrollLeft < 1) {
    jumpAxis(track, 'x', setWidth);
    return;
  }
  if (trackHasFocus(track)) return;
  const next = parkLoopScroll(track);
  if (isLoopSeamJump(track.scrollLeft, next, setWidth)) jumpAxis(track, 'x', next);
}

function LoopingTrack({ children }: { children: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const items = Children.toArray(children).filter(isValidElement);
  const looping = shouldLoopRail(items.length);
  const stamp = items.map((child, index) => String(child.key ?? index)).join('|');

  const painted = looping
    ? [0, 1, 2].flatMap((copy) =>
        items.map((child, index) =>
          cloneElement(child as ReactElement<{ loopCopy?: number }>, {
            key: `${String(child.key ?? index)}-${copy}`,
            loopCopy: copy,
          }),
        ),
      )
    : items;

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || !looping) {
      if (el !== null) el.dataset.looping = 'false';
      return;
    }
    syncConveyor(el);
  }, [looping, stamp]);

  useEffect(() => {
    const el = ref.current;
    if (el === null || !looping) return;
    let resizeRaf = 0;
    const resize = new ResizeObserver(() => {
      if (resizeRaf !== 0) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        if (el.isConnected) syncConveyor(el);
      });
    });
    resize.observe(el);
    let parkRaf = 0;
    const onScroll = (): void => {
      if (parkRaf !== 0) return;
      parkRaf = requestAnimationFrame(() => {
        parkRaf = 0;
        if (!el.isConnected) return;
        if (el.dataset.looping !== 'true') return;
        if (cameraBusy(el)) return;
        if (trackHasFocus(el)) return;
        const setWidth = readLoopSetWidth(el);
        const next = normalizeLoopScroll(el.scrollLeft, setWidth, el.clientWidth);
        if (!isLoopSeamJump(el.scrollLeft, next, setWidth)) return;
        jumpAxis(el, 'x', next);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      resize.disconnect();
      el.removeEventListener('scroll', onScroll);
      if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
      if (parkRaf !== 0) cancelAnimationFrame(parkRaf);
    };
  }, [looping, stamp]);

  return (
    <div
      ref={ref}
      className="rail__track"
      data-wrap="row"
      data-loop-count={looping ? String(items.length) : undefined}
    >
      {painted}
    </div>
  );
}

export function Rail({ title, children, action, id, bare = false }: RailProps): React.JSX.Element {
  const railRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = railRef.current;
    if (el === null) return undefined;
    return watchRailBitmaps(el);
  }, []);

  return (
    <section ref={railRef} className={`rail${bare ? ' rail--bare' : ''}`} data-rail={id}>
      {!bare && title !== undefined && title !== '' && (
        <header className="rail__header">
          <h2 className="rail__title">{title}</h2>
          {action}
        </header>
      )}
      <LoopingTrack>{children}</LoopingTrack>
    </section>
  );
}
