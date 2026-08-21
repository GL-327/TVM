import { posterSize, stylizePixels } from './phosphor';

const cache = new Map<string, string>();
const failed = new Set<string>();
const inflight = new Map<string, Promise<string | null>>();
let active = 0;
const waiters: Array<() => void> = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 2) {
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  }
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    waiters.shift()?.();
  }
}

export type ArtKind = 'poster' | 'backdrop' | 'logo';

function cacheKey(src: string, kind: ArtKind): string {
  return `p8:${kind}:${src}`;
}

export function peekStylize(src: string, kind: ArtKind): string | undefined {
  return cache.get(cacheKey(src, kind));
}

export function stylizeFailed(src: string, kind: ArtKind): boolean {
  return failed.has(cacheKey(src, kind));
}

function hop(src: string): string {
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  try {
    const url = new URL(src, typeof window !== 'undefined' ? window.location.href : 'http://127.0.0.1/');
    if (typeof window !== 'undefined' && url.origin === window.location.origin) return src;
  } catch {
    return src;
  }
  return `/api/art?src=${encodeURIComponent(src)}`;
}

async function pixelsFrom(src: string, width: number, height: number): Promise<Uint8ClampedArray | null> {
  const response = await fetch(hop(src));
  if (!response.ok) return null;
  const blob = await response.blob();
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'low',
    });
  } catch {
    bitmap = await createImageBitmap(blob);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) {
    bitmap.close();
    return null;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return ctx.getImageData(0, 0, width, height).data;
}

function toPng(data: Uint8ClampedArray, width: number, height: number): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const pixels = new Uint8ClampedArray(data.length);
  pixels.set(data);
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas.toDataURL('image/png');
}

async function run(src: string, kind: ArtKind): Promise<string | null> {
  const { width, height } = posterSize(kind);
  const pixels = await pixelsFrom(src, width, height);
  if (pixels === null) return null;
  const out = stylizePixels(pixels, width, height);
  return toPng(out, width, height);
}

export function stylizeArt(src: string, kind: ArtKind = 'poster'): Promise<string | null> {
  if (src === '') return Promise.resolve(null);
  if (src.startsWith('data:')) return Promise.resolve(src);
  const key = cacheKey(src, kind);
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  if (failed.has(key)) return Promise.resolve(null);
  const pending = inflight.get(key);
  if (pending !== undefined) return pending;
  const work = withSlot(() => run(src, kind)).then((url) => {
    if (url !== null) cache.set(key, url);
    else failed.add(key);
    return url;
  });
  inflight.set(key, work);
  void work.finally(() => inflight.delete(key));
  return work;
}
