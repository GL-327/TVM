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
    const node = thumb.current;
    // React commits child layout effects before attaching parent refs, so track.current
    // is null on initial mount; falling back to parentElement guarantees first-paint measurement.
    const host = track.current ?? node?.parentElement ?? null;
    if (!host || !node) return;

    let alive = true;
    let retryFrame = 0;

    const findTarget = (): HTMLElement | undefined => {
      const items = Array.from(host.querySelectorAll<HTMLElement>('[data-focus-id]'));
      if (selected) {
        const matched = items.find((item) => item.dataset.focusId === selected);
        if (matched) return matched;
      }
      return host.querySelector<HTMLElement>(
        '[aria-pressed="true"], [aria-checked="true"], .glass-segment__option--active',
      ) ?? undefined;
    };

    const readGeometry = (button: HTMLElement): { left: number; width: number } => {
      let left = button.offsetLeft;
      let width = button.offsetWidth;
      if (!width && typeof button.getBoundingClientRect === 'function') {
        const hostRect = host.getBoundingClientRect();
        const btnRect = button.getBoundingClientRect();
        if (btnRect.width > 0) {
          left = Math.round(btnRect.left - hostRect.left + host.scrollLeft);
          width = Math.round(btnRect.width);
        }
      }
      return { left, width };
    };

    const measure = (animate: boolean): void => {
      if (!alive) return;
      const button = findTarget();
      if (!button) {
        node.style.opacity = '0';
        return;
      }
      const { left, width } = readGeometry(button);
      if (!width) {
        node.style.opacity = '0';
        if (!retryFrame && typeof requestAnimationFrame === 'function') {
          retryFrame = requestAnimationFrame(() => {
            retryFrame = 0;
            measure(false);
          });
        }
        return;
      }
      const before = history ?? previous.current;
      const fromLeft = before.left;
      const fromWidth = before.width;
      Object.assign(node.style, { left: `${left}px`, width: `${width}px`, opacity: '1' });
      Object.assign(before, { left, width });
      if (!animate || !fromWidth || fromLeft === left || typeof node.animate !== 'function') return;
      node.getAnimations?.().forEach((animation) => animation.cancel());
      if (prefersReducedMotion()) {
        node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
        return;
      }
      const dx = fromLeft - left;
      const scaleFrom = fromWidth / width;
      const distanceRatio = Math.min(Math.abs(dx) / Math.max(width, 44), 1);
      const stretch = Math.min(1.25, 1.15 + 0.10 * distanceRatio);
      const settleOvershoot = -Math.sign(dx) * Math.min(2, Math.max(0.8, Math.abs(dx) * 0.02));
      node.animate([
        { transform: `translateX(${dx}px) scaleX(${scaleFrom.toFixed(3)}) scaleY(1)` },
        { transform: `translateX(${(dx * 0.30).toFixed(2)}px) scaleX(${stretch.toFixed(3)}) scaleY(0.93)`, offset: 0.40 },
        { transform: `translateX(${settleOvershoot.toFixed(2)}px) scaleX(0.985) scaleY(1.01)`, offset: 0.78 },
        { transform: 'translateX(0) scaleX(1) scaleY(1)' },
      ], { duration: 380, easing: 'cubic-bezier(0.22, 0.8, 0.23, 1)' });
    };

    measure(true);

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measure(false))
      : null;
    const observeTargets = (): void => {
      if (!observer) return;
      observer.disconnect();
      observer.observe(host);
      host.querySelectorAll<HTMLElement>('[data-focus-id]').forEach((child) => observer.observe(child));
    };
    observeTargets();

    const mutationObserver = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => {
          observeTargets();
          measure(false);
        })
      : null;
    mutationObserver?.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-focus-id', 'aria-pressed', 'aria-checked'],
    });

    // Re-measure once Geist webfonts finish loading so tab metrics stay exact.
    const onFontsReady = (): void => measure(false);
    const fontSet = typeof document !== 'undefined' ? document.fonts : undefined;
    void fontSet?.ready?.then(onFontsReady).catch(() => undefined);
    fontSet?.addEventListener?.('loadingdone', onFontsReady);

    return () => {
      alive = false;
      if (retryFrame) cancelAnimationFrame(retryFrame);
      observer?.disconnect();
      mutationObserver?.disconnect();
      fontSet?.removeEventListener?.('loadingdone', onFontsReady);
    };
  }, [history, selected, track]);

  return <span ref={thumb} className={className} aria-hidden="true" />;
}
