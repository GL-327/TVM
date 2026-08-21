/** Start poster fetches when a card is near the camera.
 *
 * Native `loading=lazy` never starts inside `overflow-x` tracks. Eager-loading
 * every conveyor copy at once saturates decode so on-screen art stays blank.
 * Keep every `<img src>` in the DOM; only *arm* nearby bitmaps (row + neighbors).
 */

const SCROLLER = '.home, .page, .details, .service, .stream-page';

const CARD_SEL = '.poster, .channel-card, [data-focus-id]';

/** Horizontal overscan so the next few posters are decoded before they enter. */
export const BITMAP_OVERSCAN_MIN = 640;

export function bitmapOverscanX(viewWidth: number): number {
  if (!Number.isFinite(viewWidth) || viewWidth <= 0) return BITMAP_OVERSCAN_MIN;
  return Math.max(BITMAP_OVERSCAN_MIN, Math.round(viewWidth * 0.6));
}

export function nearScroller(el: HTMLElement, margin = 1.1): boolean {
  const scroller = el.closest(SCROLLER);
  const view =
    scroller !== null
      ? scroller.getBoundingClientRect()
      : { top: 0, bottom: typeof window === 'undefined' ? 0 : window.innerHeight };
  const box = el.getBoundingClientRect();
  const slack = Math.max(0, view.bottom - view.top) * margin;
  return box.bottom > view.top - slack && box.top < view.bottom + slack;
}

export function cardInCamera(
  card: { getBoundingClientRect: () => { left: number; right: number } },
  camera: { getBoundingClientRect: () => { left: number; right: number } },
  overscanX: number,
): boolean {
  const box = card.getBoundingClientRect();
  const view = camera.getBoundingClientRect();
  return box.right > view.left - overscanX && box.left < view.right + overscanX;
}

export function isLoopCloneImg(img: HTMLImageElement): boolean {
  return typeof img.closest === 'function' && img.closest('[data-loop-clone="true"]') !== null;
}

export function railHasFocus(root: HTMLElement): boolean {
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') return false;
  const active = document.activeElement;
  return active instanceof HTMLElement && typeof root.contains === 'function' && root.contains(active);
}

/** Nearby/overscan always; focused-row real posters; clones stay lazy until overscan. */
export function shouldArmBitmap(input: { inCamera: boolean; clone: boolean; focusedRow: boolean }): boolean {
  if (input.inCamera) return true;
  return input.focusedRow && !input.clone;
}

function cameraOf(root: HTMLElement): HTMLElement {
  const track = typeof root.querySelector === 'function' ? root.querySelector<HTMLElement>('.rail__track') : null;
  return track ?? root;
}

function cardOf(img: HTMLImageElement): HTMLElement {
  const card = typeof img.closest === 'function' ? img.closest<HTMLElement>(CARD_SEL) : null;
  return card ?? img;
}

/** Flip lazy → eager. Re-set src only when native lazy never started (empty currentSrc). */
export function armBitmap(img: HTMLImageElement): void {
  if (img.dataset.bitmapWoke === 'true') return;
  img.loading = 'eager';
  if (!isLoopCloneImg(img)) {
    img.fetchPriority = 'high';
  }
  img.dataset.bitmapWoke = 'true';
  const src = img.getAttribute('src');
  if (src === null || src === '') return;
  const current = 'currentSrc' in img ? img.currentSrc : '';
  if (current !== '') return;
  img.src = src;
}

function armAllBitmaps(root: HTMLElement): void {
  for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
    armBitmap(img);
  }
}

export function wakeBitmaps(root: HTMLElement): void {
  const camera = cameraOf(root);
  const canMeasure = typeof camera.getBoundingClientRect === 'function';
  const overscan = bitmapOverscanX(typeof camera.clientWidth === 'number' ? camera.clientWidth : 0);
  const focusedRow = railHasFocus(root);

  for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
    if (img.dataset.bitmapWoke === 'true') continue;
    const clone = isLoopCloneImg(img);
    if (canMeasure) {
      const card = cardOf(img);
      const inCamera =
        typeof card.getBoundingClientRect === 'function' && cardInCamera(card, camera, overscan);
      if (!shouldArmBitmap({ inCamera, clone, focusedRow })) continue;
    }
    armBitmap(img);
  }
}

export function watchRailBitmaps(root: HTMLElement): () => void {
  const track = cameraOf(root);
  let railNear = typeof root.getBoundingClientRect === 'function' ? nearScroller(root) : true;
  const waiting = new Set<HTMLImageElement>();
  let scrollRaf = 0;

  const flush = (img: HTMLImageElement): void => {
    if (!railNear) {
      waiting.add(img);
      return;
    }
    waiting.delete(img);
    armBitmap(img);
  };

  const flushWaiting = (): void => {
    if (!railNear) return;
    for (const img of [...waiting]) {
      if (!img.isConnected) {
        waiting.delete(img);
        continue;
      }
      armBitmap(img);
    }
  };

  const wakeIfNear = (): void => {
    railNear = typeof root.getBoundingClientRect === 'function' ? nearScroller(root) : true;
    if (railNear || railHasFocus(root)) wakeBitmaps(root);
  };

  if (typeof IntersectionObserver === 'undefined') {
    if (railNear) armAllBitmaps(root);
    const scroller = typeof root.closest === 'function' ? root.closest(SCROLLER) : null;
    const onScroll = (): void => {
      if (scrollRaf !== 0) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        railNear = typeof root.getBoundingClientRect === 'function' ? nearScroller(root) : true;
        if (railNear) armAllBitmaps(root);
      });
    };
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('focusin', wakeIfNear);
    return () => {
      scroller?.removeEventListener('scroll', onScroll);
      root.removeEventListener('focusin', wakeIfNear);
      if (scrollRaf !== 0) cancelAnimationFrame(scrollRaf);
      waiting.clear();
    };
  }

  const overscan = bitmapOverscanX(track.clientWidth);
  const cardIO = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (entry.target instanceof HTMLImageElement) flush(entry.target);
      }
    },
    { root: track, rootMargin: `80px ${overscan}px`, threshold: 0 },
  );

  const pageIO = new IntersectionObserver(
    (entries) => {
      railNear = entries.some((entry) => entry.isIntersecting);
      if (railNear) {
        flushWaiting();
        wakeBitmaps(root);
      }
    },
    {
      root: null,
      rootMargin: '110% 0px',
      threshold: 0,
    },
  );
  pageIO.observe(root);

  const observeImgs = (): void => {
    for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
      if (img.dataset.bitmapObserved === 'true') continue;
      img.dataset.bitmapObserved = 'true';
      cardIO.observe(img);
    }
  };
  observeImgs();
  if (railNear) wakeBitmaps(root);

  const mo = new MutationObserver(observeImgs);
  mo.observe(root, { childList: true, subtree: true });

  const onTrackScroll = (): void => {
    if (!railNear) return;
    if (scrollRaf !== 0) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      wakeBitmaps(root);
    });
  };
  track.addEventListener('scroll', onTrackScroll, { passive: true });
  root.addEventListener('focusin', wakeIfNear);

  return () => {
    cardIO.disconnect();
    pageIO.disconnect();
    mo.disconnect();
    track.removeEventListener('scroll', onTrackScroll);
    root.removeEventListener('focusin', wakeIfNear);
    if (scrollRaf !== 0) cancelAnimationFrame(scrollRaf);
    waiting.clear();
  };
}
