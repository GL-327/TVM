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

export function wakeBitmaps(root: HTMLElement, candidates?: Iterable<HTMLImageElement>): void {
  const camera = cameraOf(root);
  const canMeasure = typeof camera.getBoundingClientRect === 'function';
  // Read the viewport once, before writes. The old path measured it for every
  // image in all three conveyor copies on every scroll frame.
  const view = canMeasure ? camera.getBoundingClientRect() : null;
  const overscan = bitmapOverscanX(typeof camera.clientWidth === 'number' ? camera.clientWidth : 0);
  const focusedRow = railHasFocus(root);

  const ready: HTMLImageElement[] = [];
  for (const img of candidates ?? root.querySelectorAll<HTMLImageElement>('img')) {
    if (img.dataset.bitmapWoke === 'true') continue;
    const clone = isLoopCloneImg(img);
    if (canMeasure) {
      const card = cardOf(img);
      const box = typeof card.getBoundingClientRect === 'function' ? card.getBoundingClientRect() : null;
      const inCamera = box !== null && view !== null && box.right > view.left - overscan && box.left < view.right + overscan;
      if (!shouldArmBitmap({ inCamera, clone, focusedRow })) continue;
    }
    ready.push(img);
  }
  for (const img of ready) armBitmap(img);
}

export function watchRailBitmaps(root: HTMLElement): () => void {
  const track = cameraOf(root);
  let railNear = typeof root.getBoundingClientRect === 'function' ? nearScroller(root) : true;
  // Watcher-local ownership survives React's setup → cleanup → setup cycle.
  // Persistent bitmapObserved DOM flags used to strand images after cleanup.
  const pending = new Set<HTMLImageElement>();
  let scrollRaf = 0;
  let wake = (): void => wakeBitmaps(root);

  const wakeIfNear = (): void => {
    railNear = typeof root.getBoundingClientRect === 'function' ? nearScroller(root) : true;
    if (railNear || railHasFocus(root)) wake();
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
      pending.clear();
    };
  }

  const overscan = bitmapOverscanX(track.clientWidth);
  const cardIO = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (!railNear || !(entry.target instanceof HTMLImageElement)) continue;
        const img = entry.target;
        if (!pending.has(img)) continue;
        armBitmap(img);
        cardIO.unobserve(img);
        pending.delete(img);
      }
    },
    { root: track, rootMargin: `80px ${overscan}px`, threshold: 0 },
  );

  const prune = (): void => {
    for (const img of pending) {
      if (!root.contains(img) || img.dataset.bitmapWoke === 'true') {
        cardIO.unobserve(img);
        pending.delete(img);
      }
    }
  };
  wake = (): void => {
    if (pending.size === 0) return;
    prune();
    wakeBitmaps(root, pending);
    prune();
  };

  const pageIO = new IntersectionObserver(
    (entries) => {
      railNear = entries.some((entry) => entry.isIntersecting);
      if (railNear) {
        wake();
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
    prune();
    for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
      if (pending.has(img) || img.dataset.bitmapWoke === 'true') continue;
      pending.add(img);
      cardIO.observe(img);
    }
    if (railNear) wake();
  };
  observeImgs();

  const mo = new MutationObserver(observeImgs);
  mo.observe(root, { childList: true, subtree: true });

  const onTrackScroll = (): void => {
    if (!railNear) return;
    if (scrollRaf !== 0) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      wake();
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
    pending.clear();
  };
}
