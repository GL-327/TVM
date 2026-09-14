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

/** Two in-flight decodes. A third would hitch the D-pad camera on a mid PC. */
export const DECODE_SLOTS = 2;

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= DECODE_SLOTS) {
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

/**
 * phosphor: quantised to a CRT palette (heavy, 1-bit feel).
 * mosaic: the picture at tile resolution with its own colours; the CSS
 * `image-rendering: pixelated` upscale gives a faint 8-bit edge.
 */
export type ArtStyle = 'phosphor' | 'mosaic';

function cacheKey(src: string, kind: ArtKind, style: ArtStyle): string {
  return `${style === 'mosaic' ? 'm8' : 'p8'}:${kind}:${src}`;
}

export function peekStylize(src: string, kind: ArtKind, style: ArtStyle = 'phosphor'): string | undefined {
  if (src.startsWith('data:')) return src;
  return cache.get(cacheKey(src, kind, style));
}

export function stylizeFailed(src: string, kind: ArtKind, style: ArtStyle = 'phosphor'): boolean {
  const key = cacheKey(src, kind, style);
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

/**
 * Mosaic only needs tile-sized pixels. Prefer the CDN's small still so we do
 * not decode a 342px poster (or a hero still) just to downsample it.
 */
export function cheapArtUrl(src: string): string {
  return src
    .replace(/\/poster\/large\//, '/poster/medium/')
    .replace(/\/background\/large\//, '/background/medium/')
    .replace(/\/t\/p\/(?:original|w(?:342|500|780|1280))\//, '/t/p/w185/');
}

function yieldForPaint(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = (): void => {
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    const done = (): void => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(done, { timeout: 120 });
      signal.addEventListener('abort', () => cancelIdleCallback(id), { once: true });
    } else {
      setTimeout(done, 0);
    }
  });
}

async function bitmapFrom(
  src: string,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<ImageBitmap | null> {
  signal.throwIfAborted();
  const response = await fetch(hop(src), { signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]) });
  if (!response.ok) return null;
  const blob = await response.blob();
  try {
    return await createImageBitmap(blob, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'low',
    });
  } catch {
    return createImageBitmap(blob);
  }
}

async function pixelsFrom(
  src: string,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<Uint8ClampedArray | null> {
  const bitmap = await bitmapFrom(src, width, height, signal);
  if (bitmap === null) return null;
  try {
    await yieldForPaint(signal);
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

/** Mosaic is a downsample. Skip getImageData + putImageData; those hitch the camera. */
async function mosaicFrom(src: string, width: number, height: number, signal: AbortSignal): Promise<string | null> {
  const bitmap = await bitmapFrom(cheapArtUrl(src), width, height, signal);
  if (bitmap === null) return null;
  try {
    await yieldForPaint(signal);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx === null) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}

async function run(src: string, kind: ArtKind, style: ArtStyle, signal: AbortSignal): Promise<string | null> {
  const { width, height } = posterSize(kind);
  if (style === 'mosaic') return mosaicFrom(src, width, height, signal);
  const pixels = await pixelsFrom(src, width, height, signal);
  if (pixels === null) return null;
  signal.throwIfAborted();
  const out = await paintPixels(pixels, width, height, signal);
  signal.throwIfAborted();
  return toPng(out, width, height);
}

export function stylizeArt(
  src: string,
  kind: ArtKind = 'poster',
  signal?: AbortSignal,
  style: ArtStyle = 'phosphor',
): Promise<string | null> {
  if (signal?.aborted === true) return Promise.resolve(null);
  if (src === '') return Promise.resolve(null);
  if (src.startsWith('data:')) return Promise.resolve(src);
  // Hero / landscape stills stay on the compositor. Converting them blanks
  // the backdrop and steals both decode slots from the rail.
  if (kind === 'backdrop') return Promise.resolve(null);
  const key = cacheKey(src, kind, style);
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  if (stylizeFailed(src, kind, style)) return Promise.resolve(null);
  let job = inflight.get(key);
  if (job === undefined || job.controller.signal.aborted) {
    const controller = new AbortController();
    const current: ArtJob = { controller, consumers: new Set(), work: Promise.resolve(null) };
    current.work = withSlot(() => run(src, kind, style, controller.signal))
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
