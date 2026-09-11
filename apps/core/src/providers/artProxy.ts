import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ART_HOSTS =
  /(?:^|\.)(?:image\.tmdb\.org|images\.metahub\.space|live\.metahub\.space|mzstatic\.com|tvmaze\.com|kitsu\.io|fanart\.tv)$/i;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function isAllowedArtUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username !== '' || parsed.password !== '' || parsed.port !== '') return null;
  if (!ART_HOSTS.test(parsed.hostname)) return null;
  parsed.hash = '';
  return parsed;
}

interface Artwork {
  body: Buffer;
  contentType: string;
  etag: string;
  expires: number;
}

interface ArtProxyOptions {
  fetch?: typeof fetch;
  maxBytes?: number;
  maxImageBytes?: number;
  maxEntries?: number;
  maxConcurrent?: number;
  now?: () => number;
}

class ArtError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** One bounded cache per core instance; repeated cards share a single CDN download. */
export function createArtProxyService(options: ArtProxyOptions = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const maxBytes = options.maxBytes ?? 24 * 1024 * 1024;
  const maxImageBytes = options.maxImageBytes ?? 8 * 1024 * 1024;
  const maxEntries = options.maxEntries ?? 192;
  const maxConcurrent = options.maxConcurrent ?? 6;
  const cache = new Map<string, Artwork>();
  const inflight = new Map<string, Promise<Artwork>>();
  const controllers = new Set<AbortController>();
  const waiting: Array<() => void> = [];
  let cacheBytes = 0;
  let active = 0;
  let generation = 0;

  const remove = (key: string): void => {
    const entry = cache.get(key);
    if (entry !== undefined) cacheBytes -= entry.body.length;
    cache.delete(key);
  };

  const download = async (target: URL, signal: AbortSignal): Promise<Artwork> => {
    let url = target;
    // Re-check every Location: a permitted CDN must not redirect the proxy off its allowlist.
    for (let hop = 0; hop <= 4; hop += 1) {
      const upstream = await fetchImpl(url.href, {
        headers: { 'user-agent': 'tvm-core', accept: 'image/*' },
        redirect: 'manual',
        signal,
      });
      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        await upstream.body?.cancel();
        const location = upstream.headers.get('location');
        const next = location === null ? null : isAllowedArtUrl(new URL(location, url).href);
        if (next === null || hop === 4) throw new ArtError(502, 'invalid_redirect');
        url = next;
        continue;
      }
      if (!upstream.ok || upstream.body === null) {
        await upstream.body?.cancel();
        throw new ArtError(upstream.ok ? 502 : upstream.status, `upstream ${upstream.status}`);
      }
      const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
      if (!contentType.toLowerCase().startsWith('image/')) {
        await upstream.body.cancel();
        throw new ArtError(400, 'not_image');
      }
      if (Number(upstream.headers.get('content-length')) > maxImageBytes) {
        await upstream.body.cancel();
        throw new ArtError(413, 'image_too_large');
      }
      const reader = upstream.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > maxImageBytes) throw new ArtError(413, 'image_too_large');
          chunks.push(chunk.value);
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
      const body = Buffer.concat(chunks, size);
      return {
        body,
        contentType,
        etag: `"${createHash('sha256').update(body).digest('base64url')}"`,
        expires: now() + CACHE_TTL_MS,
      };
    }
    throw new ArtError(502, 'invalid_redirect');
  };

  const load = async (target: URL): Promise<Artwork> => {
    const key = target.href;
    const hit = cache.get(key);
    if (hit !== undefined) {
      if (hit.expires > now()) {
        cache.delete(key);
        cache.set(key, hit);
        return hit;
      }
      remove(key);
    }
    const pending = inflight.get(key);
    if (pending !== undefined) return pending;
    if (waiting.length >= 96) throw new ArtError(503, 'artwork_busy');

    const version = generation;
    const run = async (): Promise<Artwork> => {
      if (active >= maxConcurrent) await new Promise<void>((resolve) => waiting.push(resolve));
      else active += 1;
      const controller = new AbortController();
      controllers.add(controller);
      try {
        if (version !== generation) throw new ArtError(503, 'cache_cleared');
        const image = await download(target, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
        if (version === generation && image.body.length <= maxBytes) {
          for (const [expiredKey, entry] of cache) {
            if (entry.expires <= now()) remove(expiredKey);
          }
          while (cache.size >= maxEntries || cacheBytes + image.body.length > maxBytes) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            remove(oldest);
          }
          cache.set(key, image);
          cacheBytes += image.body.length;
        }
        return image;
      } finally {
        controllers.delete(controller);
        const next = waiting.shift();
        if (next !== undefined) next();
        else active -= 1;
      }
    };
    const promise = run().finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  };

  return {
    async send(response: ServerResponse, target: URL, request?: IncomingMessage): Promise<void> {
      try {
        const checked = isAllowedArtUrl(target.href);
        if (checked === null) throw new ArtError(400, 'invalid_url');
        const image = await load(checked);
        if (response.destroyed) return;
        const headers = {
          'content-type': image.contentType,
          'cache-control': `public, max-age=${Math.max(0, Math.floor((image.expires - now()) / 1000))}`,
          'x-content-type-options': 'nosniff',
          etag: image.etag,
        };
        const conditional = request?.headers['if-none-match'];
        if (typeof conditional === 'string' && conditional.split(',').some((tag) => {
          const value = tag.trim().replace(/^W\//, '');
          return value === '*' || value === image.etag;
        })) {
          response.writeHead(304, headers);
          response.end();
          return;
        }
        response.writeHead(200, { ...headers, 'content-length': image.body.length });
        response.end(request?.method === 'HEAD' ? undefined : image.body);
      } catch (error) {
        if (response.destroyed) return;
        const status = error instanceof ArtError ? error.status : 502;
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ error: error instanceof ArtError ? error.message : 'unreachable' }));
      }
    },
    clear(): void {
      generation += 1;
      cache.clear();
      cacheBytes = 0;
      inflight.clear();
      for (const controller of controllers) controller.abort();
    },
  };
}

export type ArtProxyService = ReturnType<typeof createArtProxyService>;
