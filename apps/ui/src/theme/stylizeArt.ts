import { posterSize } from './phosphor';
import { ArtCache } from './artCache';
import { paintPixels } from './paintPixels';

const cache = new ArtCache();
const failed = new Map<string, number>();
interface ArtJob {
  controller: AbortController;
  consumers: Set<symbol>;
  work: Promise<string | null>;
}
const inflight = new Map<string, ArtJob>();
let active = 0;
const waiters: Array<() => void> = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 2) {
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  } else active += 1;
  try {
    return await work();
  } finally {
    // Transfer the occupied slot before waking a waiter. Decrementing first
    // lets a new arrival steal it before the waiting promise can resume.
    const next = waiters.shift();
    if (next === undefined) active -= 1;
    else next();
  }
}

export type ArtKind = 'poster' | 'backdrop' | 'logo';

function cacheKey(src: string, kind: ArtKind): string {
  return `p8:${kind}:${src}`;
}

export function peekStylize(src: string, kind: ArtKind): string | undefined {
  if (src.startsWith('data:')) return src;
  return cache.get(cacheKey(src, kind));
}

export function stylizeFailed(src: string, kind: ArtKind): boolean {
  const key = cacheKey(src, kind);
  const until = failed.get(key);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  failed.delete(key);
  return false;
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

async function pixelsFrom(src: string, width: number, height: number, signal: AbortSignal): Promise<Uint8ClampedArray | null> {
  signal.throwIfAborted();
  const response = await fetch(hop(src), { signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]) });
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
  try {
    signal.throwIfAborted();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  } finally {
    bitmap.close();
  }
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

async function run(src: string, kind: ArtKind, signal: AbortSignal): Promise<string | null> {
  const { width, height } = posterSize(kind);
  const pixels = await pixelsFrom(src, width, height, signal);
  if (pixels === null) return null;
  signal.throwIfAborted();
  const out = await paintPixels(pixels, width, height, signal);
  signal.throwIfAborted();
  return toPng(out, width, height);
}

export function stylizeArt(src: string, kind: ArtKind = 'poster', signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted === true) return Promise.resolve(null);
  if (src === '') return Promise.resolve(null);
  if (src.startsWith('data:')) return Promise.resolve(src);
  const key = cacheKey(src, kind);
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  if (stylizeFailed(src, kind)) return Promise.resolve(null);
  let job = inflight.get(key);
  if (job === undefined || job.controller.signal.aborted) {
    const controller = new AbortController();
    const current: ArtJob = { controller, consumers: new Set(), work: Promise.resolve(null) };
    current.work = withSlot(() => run(src, kind, controller.signal))
      .catch(() => null)
      .then((url) => {
        if (url !== null) cache.set(key, url);
        else if (!controller.signal.aborted) {
          failed.set(key, Date.now() + 30_000);
          if (failed.size > 256) {
            const oldest = failed.keys().next().value;
            if (oldest !== undefined) failed.delete(oldest);
          }
        }
        if (inflight.get(key) === current) inflight.delete(key);
        return url;
      });
    inflight.set(key, current);
    job = current;
  }
  const shared = job;
  const consumer = Symbol();
  shared.consumers.add(consumer);
  const release = (): void => {
    shared.consumers.delete(consumer);
    if (shared.consumers.size === 0 && inflight.get(key) === shared) shared.controller.abort();
  };
  signal?.addEventListener('abort', release, { once: true });
  return shared.work.then((url) => {
    signal?.removeEventListener('abort', release);
    release();
    return signal?.aborted === true ? null : url;
  });
}
