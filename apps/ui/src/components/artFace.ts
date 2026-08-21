export type ArtFace = 'clone' | 'pending' | 'ready' | 'fallback';

export function artFace(input: {
  src: string;
  decorative?: boolean;
  failedSrc?: string | null;
  loadedSrc?: string | null;
}): ArtFace {
  const src = input.src;
  if (src === '' || input.failedSrc === src) return 'fallback';
  if (input.loadedSrc === src) return 'ready';
  return 'pending';
}

export function artClassName(face: ArtFace, className?: string): string {
  const state =
    face === 'pending'
      ? 'art--pending'
      : face === 'fallback'
        ? 'art--fallback'
        : face === 'ready'
          ? 'art--ready'
          : 'art--clone';
  return [className, state].filter(Boolean).join(' ');
}

export const ART_REFERRER = 'no-referrer' as const;

export function syncBitmap(
  node: HTMLImageElement | null,
  src: string,
  onReady: (src: string) => void,
): void {
  if (node === null || !node.complete) return;
  // A 0×0 complete bitmap is still decoding (or a broken WebView stub). Wait
  // for onLoad / onError instead of treating it as a failed src.
  if (node.naturalWidth <= 0) return;
  onReady(src);
}

export function paintArtReady(node: HTMLImageElement | null): void {
  if (node === null || !node.complete || node.naturalWidth <= 0) return;
  markArtReady(node);
}

/** onLoad already means pixels exist — do not wait for a second complete check. */
export function markArtReady(node: HTMLImageElement | null): void {
  if (node === null) return;
  const parent = node.parentElement;
  if (parent === null) return;
  parent.classList.remove('art--pending');
  parent.classList.add('art--ready');
}
