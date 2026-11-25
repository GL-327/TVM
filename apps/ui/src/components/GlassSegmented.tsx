import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FocusButton } from './FocusButton';
import { prefersReducedMotion } from '../theme/motion';

export interface SegmentedOption<T extends string = string> {
  id: T;
  label: string;
}

interface GlassSegmentedProps<T extends string = string> {
  idPrefix: string;
  ariaLabel: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Pill segmented control with an animated Liquid Glass thumb that slides and
 * stretches softly along the travel axis before settling on the active option.
 */
export function GlassSegmented<T extends string = string>({
  idPrefix,
  ariaLabel,
  options,
  value,
  onChange,
  className,
}: GlassSegmentedProps<T>): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const prevIndexRef = useRef<number>(-1);
  const [thumbBox, setThumbBox] = useState<{ x: number; w: number }>({ x: 0, w: 0 });

  const activeIndex = Math.max(
    0,
    options.findIndex((item) => item.id === value),
  );

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track === null) return undefined;

    const measure = (): void => {
      const target = track.querySelector<HTMLElement>(`[data-segment-index="${activeIndex}"]`);
      if (target === null) return;
      const x = target.offsetLeft;
      const w = target.offsetWidth;
      if (w > 0) setThumbBox({ x, w });
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [activeIndex, options.length]);

  useEffect(() => {
    const thumb = thumbRef.current;
    const prev = prevIndexRef.current;
    prevIndexRef.current = activeIndex;
    if (isNaN(prev) || thumb === null || prev === -1 || prev === activeIndex) return;
    if (prefersReducedMotion() || typeof thumb.animate !== 'function') return;

    thumb.animate(
      [
        { transform: `translateX(${thumbBox.x}px) scaleX(1) scaleY(1)` },
        { transform: `translateX(${thumbBox.x}px) scaleX(1.18) scaleY(0.94)`, offset: 0.42 },
        { transform: `translateX(${thumbBox.x}px) scaleX(1) scaleY(1)` },
      ],
      {
        duration: 400,
        easing: 'cubic-bezier(0.34, 1.36, 0.64, 1)',
      },
    );
  }, [activeIndex, thumbBox.x]);

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={`glass-segment${className ? ` ${className}` : ''}`}
      data-wrap="row"
    >
      <div
        ref={thumbRef}
        className="glass-segment__thumb glass--thumb"
        aria-hidden="true"
        style={{
          width: thumbBox.w > 0 ? `${thumbBox.w}px` : undefined,
          transform: `translateX(${thumbBox.x}px)`,
          opacity: thumbBox.w > 0 ? 1 : 0,
        }}
      />
      {options.map((option, idx) => {
        const selected = option.id === value;
        return (
          <div key={option.id} data-segment-index={idx} style={{ display: 'contents' }}>
            <FocusButton
              id={`${idPrefix}-${option.id}`}
              className={`glass-segment__option${selected ? ' glass-segment__option--active' : ''}`}
              ariaLabel={option.label}
              onSelect={() => onChange(option.id)}
            >
              {option.label}
            </FocusButton>
          </div>
        );
      })}
    </div>
  );
}
