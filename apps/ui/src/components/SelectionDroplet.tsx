import { useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion } from '../theme/motion';

export function SelectionDroplet({ track, selected, className, history }: {
  track: RefObject<HTMLElement | null>;
  selected: string;
  className: string;
  history?: { left: number; width: number };
}): React.JSX.Element {
  const thumb = useRef<HTMLSpanElement>(null);
  const previous = useRef({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const host = track.current;
    const node = thumb.current;
    if (!host || !node) return;
    const measure = (animate: boolean): void => {
      const button = Array.from(host.querySelectorAll<HTMLElement>('[data-focus-id]'))
        .find((item) => item.dataset.focusId === selected);
      if (!button || !button.offsetWidth) {
        node.style.opacity = '0';
        return;
      }
      const { offsetLeft: left, offsetWidth: width } = button;
      const before = history ?? previous.current;
      const fromLeft = before.left;
      const fromWidth = before.width;
      Object.assign(node.style, { left: left + 'px', width: width + 'px', opacity: '1' });
      Object.assign(before, { left, width });
      if (!animate || !fromWidth || fromLeft === left) return;
      node.getAnimations().forEach((animation) => animation.cancel());
      if (prefersReducedMotion()) {
        node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
        return;
      }
      node.animate([
        { transform: 'translateX(' + (fromLeft - left) + 'px) scaleX(' + fromWidth / width + ')' },
        { transform: 'translateX(' + (fromLeft - left) * .3 + 'px) scaleX(1.25) scaleY(.94)', offset: .42 },
        { transform: 'translateX(0) scaleX(1)' },
      ], { duration: 380, easing: 'cubic-bezier(.22,.8,.23,1)' });
    };
    measure(true);
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(host);
    return () => observer.disconnect();
  }, [history, selected, track]);

  return <span ref={thumb} className={className} aria-hidden="true" />;
}
