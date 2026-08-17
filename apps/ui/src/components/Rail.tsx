import type { ReactElement, ReactNode } from 'react';
import { Children, cloneElement, isValidElement, useEffect, useLayoutEffect, useRef } from 'react';
import { LOOP_COPIES, normalizeLoopScroll, shouldLoopRail } from '../nav/loopingRail';
import { jumpAxis } from '../nav/revealFocused';

interface RailProps {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  id?: string;
  bare?: boolean;
}

function LoopingTrack({ children }: { children: ReactNode }): React.JSX.Element {
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
      if (lock) return;
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
      className="rail__track"
      data-looping={looping ? 'true' : undefined}
      data-loop-count={looping ? String(items.length) : undefined}
    >
      {painted}
    </div>
  );
}

export function Rail({ title, children, action, id, bare = false }: RailProps): React.JSX.Element {
  return (
    <section className={`rail${bare ? ' rail--bare' : ''}`} data-rail={id}>
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
