import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtProxyService, isAllowedArtUrl, type ArtProxyService } from './artProxy.ts';

describe('art proxy allowlist', () => {
  it('only hops known artwork CDNs', () => {
    expect(isAllowedArtUrl('https://image.tmdb.org/t/p/w342/abc.jpg')?.hostname).toBe('image.tmdb.org');
    expect(isAllowedArtUrl('https://images.metahub.space/poster/large/tt0111161/img')?.hostname).toBe(
      'images.metahub.space',
    );
    expect(isAllowedArtUrl('https://evil.example/secret.jpg')).toBeNull();
    expect(isAllowedArtUrl('file:///etc/passwd')).toBeNull();
    expect(isAllowedArtUrl('not a url')).toBeNull();
    expect(isAllowedArtUrl('https://image.tmdb.org.evil.example/a.jpg')).toBeNull();
    expect(isAllowedArtUrl('https://user:password@image.tmdb.org/a.jpg')).toBeNull();
    expect(isAllowedArtUrl('https://image.tmdb.org:8080/a.jpg')).toBeNull();
  });
});

describe('art proxy cache', () => {
  const servers: Server[] = [];
  const services: ArtProxyService[] = [];

  afterEach(async () => {
    for (const service of services.splice(0)) service.clear();
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    })));
  });

  async function serve(service: ArtProxyService): Promise<(path?: string, init?: RequestInit) => Promise<Response>> {
    services.push(service);
    const server = createServer((request, response) => {
      void service.send(response, new URL(request.url ?? '/', 'https://image.tmdb.org'), request);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return (path = '/poster.jpg', init) => fetch(`${origin}${path}`, init);
  }

  function jpeg(body = 'jpeg'): Response {
    return new Response(body, { headers: { 'content-type': 'image/jpeg' } });
  }

  it('downloads concurrent and subsequent requests for one image only once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const upstream = vi.fn(async () => { await gate; return jpeg(); });
    const request = await serve(createArtProxyService({ fetch: upstream }));
    const requests = Array.from({ length: 8 }, () => request());
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
    release();
    const replies = await Promise.all(requests);
    expect(await Promise.all(replies.map((reply) => reply.text()))).toEqual(Array(8).fill('jpeg'));
    expect(await (await request()).text()).toBe('jpeg');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('returns ETag revalidations and HEAD without another CDN fetch', async () => {
    const upstream = vi.fn(async () => jpeg());
    const request = await serve(createArtProxyService({ fetch: upstream }));
    const first = await request();
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    await first.text();
    const unchanged = await request(undefined, { headers: { 'if-none-match': `W/${etag}` } });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe('');
    const head = await request(undefined, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('4');
    expect(await head.text()).toBe('');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used image when the byte budget fills', async () => {
    const upstream = vi.fn(async () => jpeg('123'));
    const request = await serve(createArtProxyService({ fetch: upstream, maxBytes: 6 }));
    for (const path of ['/a', '/b', '/a', '/c', '/b']) await (await request(path)).text();
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it('refetches expired images and never caches an upstream failure', async () => {
    let time = 0;
    const upstream = vi.fn(async () => jpeg());
    upstream.mockImplementationOnce(async () => new Response('failed', { status: 503 }));
    const request = await serve(createArtProxyService({ fetch: upstream, now: () => time }));
    expect((await request()).status).toBe(503);
    expect(await (await request()).text()).toBe('jpeg');
    time += 86_400_001;
    expect(await (await request()).text()).toBe('jpeg');
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it('validates redirect destinations before making another request', async () => {
    const upstream = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private' },
    }));
    const request = await serve(createArtProxyService({ fetch: upstream }));
    const result = await request();
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ error: 'invalid_redirect' });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('follows relative CDN redirects using manual validation', async () => {
    const upstream = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.redirect).toBe('manual');
      return String(input).endsWith('/poster.jpg')
        ? new Response(null, { status: 302, headers: { location: '/final.jpg' } })
        : jpeg();
    });
    const request = await serve(createArtProxyService({ fetch: upstream }));
    expect(await (await request()).text()).toBe('jpeg');
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('cancels an oversized streaming body even without a Content-Length', async () => {
    const cancel = vi.fn();
    const upstream = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(8)); },
      cancel,
    }), { headers: { 'content-type': 'image/png' } }));
    const request = await serve(createArtProxyService({ fetch: upstream, maxImageBytes: 4 }));
    const result = await request();
    expect(result.status).toBe(413);
    expect(await result.json()).toEqual({ error: 'image_too_large' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('limits active downloads while allowing every queued image to finish', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let peak = 0;
    const upstream = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await gate;
      active -= 1;
      return jpeg();
    });
    const request = await serve(createArtProxyService({ fetch: upstream, maxConcurrent: 2 }));
    const requests = Array.from({ length: 8 }, (_, index) => request(`/${index}`));
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(2));
    release();
    expect((await Promise.all(requests)).every((reply) => reply.status === 200)).toBe(true);
    expect(peak).toBe(2);
    expect(upstream).toHaveBeenCalledTimes(8);
  });

  it('aborts unfinished downloads on cache clear and permits a clean retry', async () => {
    let signal: AbortSignal | undefined;
    const upstream = vi.fn<typeof fetch>(async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const service = createArtProxyService({ fetch: upstream });
    const request = await serve(service);
    const pending = request();
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
    service.clear();
    expect(signal?.aborted).toBe(true);
    expect((await pending).status).toBe(502);
    upstream.mockImplementation(async () => jpeg());
    expect(await (await request()).text()).toBe('jpeg');
  });
});
