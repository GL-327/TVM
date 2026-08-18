import type { ReactElement, ReactNode } from 'react';
import { Children, cloneElement, isValidElement, useEffect, useLayoutEffect, useRef } from 'react';
import { LOOP_COPIES, isWrappingTrack, normalizeLoopScroll, shouldLoopRail } from '../nav/loopingRail';
import { jumpAxis } from '../nav/revealFocused';

interface LoopingRowProps {
  className: string;
  children: ReactNode;
  label?: string;
}

export function LoopingRow({ className, children, label }: LoopingRowProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const items = Children.toArray(children).filter(isValidElement);
  const looping = shouldLoopRail(items.length);

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
    if (el === null || !looping) return;
    const setWidth = el.scrollWidth / LOOP_COPIES;
    if (setWidth > 0) jumpAxis(el, 'x', setWidth);
  }, [looping, items.length]);

  useEffect(() => {
    const el = ref.current;
    if (el === null || !looping) return;
    let lock = false;
    const onScroll = (): void => {
      if (lock || isWrappingTrack(el) || el.dataset.wrapping === 'true') return;
      const setWidth = el.scrollWidth / LOOP_COPIES;
      const next = normalizeLoopScroll(el.scrollLeft, setWidth);
      if (Math.abs(next - el.scrollLeft) < 1) return;
      lock = true;
      jumpAxis(el, 'x', next);
      lock = false;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [looping, items.length]);

  return (
    <div
      ref={ref}
      className={className}
      aria-label={label}
      data-looping={looping ? 'true' : undefined}
      data-loop-count={looping ? String(items.length) : undefined}
    >
      {painted}
    </div>
  );
}
