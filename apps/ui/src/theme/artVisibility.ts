/** All poster placeholders share one observer; no per-poster scroll handlers. */
const callbacks = new Map<Element, () => void>();
let observer: IntersectionObserver | undefined;

export function whenArtNear(element: Element, ready: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    ready();
    return () => undefined;
  }
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const callback = callbacks.get(entry.target);
      callbacks.delete(entry.target);
      observer?.unobserve(entry.target);
      callback?.();
    }
    if (callbacks.size === 0) {
      observer?.disconnect();
      observer = undefined;
    }
  }, {
    rootMargin: '100% 640px',
    // Chromium supports overscan through nested page + rail clipping. Older
    // browsers ignore this addition and still load at viewport intersection.
    scrollMargin: '100% 640px',
  } as IntersectionObserverInit);
  callbacks.set(element, ready);
  observer.observe(element);
  return () => {
    callbacks.delete(element);
    observer?.unobserve(element);
    if (callbacks.size === 0) {
      observer?.disconnect();
      observer = undefined;
    }
  };
}
