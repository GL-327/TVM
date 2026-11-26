import { useEffect, useRef, type RefObject } from 'react';

const cardSelector = '[data-ambient-art]';
const dwellMs = 180;

/** Two viewport layers, updated outside React. Only the current picture and its replacement are painted. */
export function BrowseAmbience({ page }: { page: RefObject<HTMLElement | null> }): React.JSX.Element {
  const scene = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = page.current;
    const backdrop = scene.current;
    if (!root || !backdrop) return;
    const layers = Array.from(backdrop.querySelectorAll<HTMLElement>('.browse-ambience__art'));
    let front: HTMLElement | undefined;
    let pointed: HTMLElement | null = null;
    let focused: HTMLElement | null = null;
    let scheduled: HTMLElement | null = null;
    let timer = 0;
    let pending: HTMLImageElement | null = null;

    const cardAt = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element ? target.closest<HTMLElement>(cardSelector) : null;

    const show = (card: HTMLElement | null): void => {
      const src = card?.dataset.ambientArt ?? '';
      const hue = card?.dataset.ambientHue ?? '';
      if (front?.dataset.source === src && front.dataset.hue === hue) return;
      const next = layers.find((layer) => layer !== front);
      if (!next) return;
      const paint = (image?: HTMLImageElement): void => {
        const picture = next.querySelector('img');
        if (picture) {
          if (image) picture.src = image.src;
          picture.hidden = !image;
        }
        next.style.setProperty('--art-hue', hue || '30');
        next.dataset.source = src;
        next.dataset.hue = hue;
        next.dataset.visible = 'true';
        front?.removeAttribute('data-visible');
        front = next;
      };
      if (src === '') {
        if (!card) front?.removeAttribute('data-visible');
        else paint();
        if (!card) front = undefined;
        return;
      }
      const image = new Image();
      pending = image;
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.src = src;
      void image.decode().then(() => { if (pending === image) paint(image); },
        () => { if (pending === image) paint(); });
    };

    const schedule = (): void => {
      const card = pointed ?? focused;
      if (card === scheduled) return;
      scheduled = card;
      pending = null;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => show(card?.isConnected ? card : null), dwellMs);
    };
    const over = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse') return;
      pointed = cardAt(event.target);
      schedule();
    };
    const leave = (): void => { pointed = null; schedule(); };
    const onFocus = (event: FocusEvent): void => { focused = cardAt(event.target); schedule(); };
    const onBlur = (event: FocusEvent): void => {
      focused = event.relatedTarget instanceof Node && root.contains(event.relatedTarget) ? cardAt(event.relatedTarget) : null;
      schedule();
    };
    const onKey = (): void => { pointed = null; schedule(); };

    root.addEventListener('pointerover', over, { passive: true });
    root.addEventListener('pointerleave', leave, { passive: true });
    root.addEventListener('focusin', onFocus);
    root.addEventListener('focusout', onBlur);
    root.addEventListener('keydown', onKey, true);
    return () => {
      pending = null;
      window.clearTimeout(timer);
      root.removeEventListener('pointerover', over);
      root.removeEventListener('pointerleave', leave);
      root.removeEventListener('focusin', onFocus);
      root.removeEventListener('focusout', onBlur);
      root.removeEventListener('keydown', onKey, true);
    };
  }, [page]);

  return <div ref={scene} className="browse-ambience" aria-hidden="true">
    <div className="browse-ambience__art"><img alt="" hidden referrerPolicy="no-referrer" /></div>
    <div className="browse-ambience__art"><img alt="" hidden referrerPolicy="no-referrer" /></div>
  </div>;
}
