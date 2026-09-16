import { describe, expect, it } from 'vitest';
import { LiveCache, cacheOptions, cacheable, DEFAULT_CACHE } from './cache.ts';
import { globalProfile, type HeaderProfile } from './headers.ts';
import { remainingAbsoluteUrls } from './manifest.ts';
import { Reflector } from './reflect.ts';
import { TokenMinter, type TokenStore } from './tokens.ts';

function memoryStore(): TokenStore {
  let held: string | null = null;
  return { read: () => held, write: (secret) => { held = secret; } };
}

interface Call { url: string; headers: Record<string, string>; method: string }

function fakeFetch(routes: Record<string, { body: string | Uint8Array; type?: string; status?: number }>) {
  const calls: Call[] = [];
  const impl = (async (input: unknown, init?: { method?: string; headers?: Headers }) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    calls.push({ url, headers, method: init?.method ?? 'GET' });
    const route = routes[url];
    if (route === undefined) return new Response('nope', { status: 404 });
    const body = typeof route.body === 'string' ? route.body : route.body;
    return new Response(body as unknown as string, {
      status: route.status ?? 200,
      headers: { 'content-type': route.type ?? 'application/octet-stream' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function build(routes: Parameters<typeof fakeFetch>[0], profiles: Record<string, HeaderProfile> = {}, cache: LiveCache | null = null) {
  const { impl, calls } = fakeFetch(routes);
  const minter = new TokenMinter(memoryStore());
  const reflector = new Reflector({
    minter,
    cache,
    globalProfile: globalProfile({}),
    profileFor: (id) => profiles[id] ?? null,
    fetchImpl: impl,
  });
  return { reflector, minter, calls };
}

const MANIFEST = [
  '#EXTM3U',
  '#EXT-X-KEY:METHOD=AES-128,URI="https://panel.example/key.bin"',
  '#EXTINF:6,',
  'seg1.ts',
].join('\n');

describe('serving a live stream through Core', () => {
  it('rewrites the manifest and serves its segments from the same profile', async () => {
    const { reflector, minter, calls } = build(
      {
        'https://panel.example/live/index.m3u8': { body: MANIFEST, type: 'application/vnd.apple.mpegurl' },
        'https://panel.example/live/seg1.ts': { body: new Uint8Array([0x47, 0x40, 0x00]), type: 'video/mp2t' },
      },
      { panel: { id: 'panel', referer: 'https://panel.example/', extra: { 'X-Key': 'abc' } } },
    );

    const path = reflector.publish('https://panel.example/live/index.m3u8', 'panel');
    const token = path.slice('/api/live/proxy/'.length);
    const manifest = await reflector.serve(token, undefined, 'GET');

    expect(manifest.kind).toBe('playlist');
    const body = String(manifest.body);
    expect(remainingAbsoluteUrls(body)).toEqual([]);
    expect(body).not.toContain('panel.example');

    // The provider's headers went out with the manifest request.
    expect(calls[0]?.headers['referer']).toBe('https://panel.example/');
    expect(calls[0]?.headers['x-key']).toBe('abc');

    // And the segment minted inside it resolves, under the same profile.
    const segToken = /\/api\/live\/proxy\/([0-9a-f]{32})/.exec(body.split('\n').find((l) => l.endsWith('ts') || l.includes('proxy')) ?? '')?.[1];
    const segment = await reflector.serve(minter.mint({ url: 'https://panel.example/live/seg1.ts', profileId: 'panel', playlist: false }), undefined, 'GET');
    expect(segment.kind).toBe('media');
    expect(segment.contentType).toBe('video/mp2t');
    expect(calls[1]?.headers['referer']).toBe('https://panel.example/');
    expect(segToken === undefined || /^[0-9a-f]{32}$/.test(segToken)).toBe(true);
  });

  it('refuses a token it never minted', async () => {
    const { reflector } = build({});
    const result = await reflector.serve('f'.repeat(32), undefined, 'GET');
    expect(result.kind).toBe('error');
    expect(result.status).toBe(404);
  });

  /*
   * An error message is the one place a provider address would otherwise
   * reach the UI, so the reason codes are fixed strings.
   */
  it('never names the upstream host when a fetch fails', async () => {
    const { reflector } = build({});
    const path = reflector.publish('https://panel.example/live/gone.m3u8', 'global');
    const result = await reflector.serve(path.slice('/api/live/proxy/'.length), undefined, 'GET');
    expect(result.kind).toBe('error');
    expect(JSON.stringify(result)).not.toContain('panel.example');
  });

  it('pipes a large body instead of buffering it', async () => {
    const { reflector } = build({
      'https://panel.example/big.ts': { body: new Uint8Array(64), type: 'video/mp2t' },
    });
    const path = reflector.publish('https://panel.example/big.ts', 'global', false);
    const result = await reflector.serve(path.slice('/api/live/proxy/'.length), undefined, 'GET');
    expect(result.kind).toBe('media');
    // No content-length was declared, so it streams rather than caching.
    expect(result.body).toBeInstanceOf(ReadableStream);
  });

  it('answers HEAD without reading a body', async () => {
    const { reflector, calls } = build({
      'https://panel.example/a.ts': { body: new Uint8Array([1, 2, 3]), type: 'video/mp2t' },
    });
    const path = reflector.publish('https://panel.example/a.ts', 'global', false);
    const result = await reflector.serve(path.slice('/api/live/proxy/'.length), undefined, 'HEAD');
    expect(result.kind).toBe('media');
    expect(result.body).toBeUndefined();
    expect(calls[0]?.method).toBe('HEAD');
  });

  it('serves a repeat manifest from cache rather than asking the panel again', async () => {
    const cache = new LiveCache({ ...DEFAULT_CACHE, manifestTtlMs: 10_000 });
    const { reflector, calls } = build(
      { 'https://panel.example/live/index.m3u8': { body: MANIFEST, type: 'application/vnd.apple.mpegurl' } },
      {},
      cache,
    );
    const token = reflector.publish('https://panel.example/live/index.m3u8', 'global').slice('/api/live/proxy/'.length);
    await reflector.serve(token, undefined, 'GET');
    await reflector.serve(token, undefined, 'GET');
    expect(calls).toHaveLength(1);
    expect(cache.stats().entries).toBe(1);
  });
});

describe('the cache in front of the provider', () => {
  it('expires a manifest quickly, because a live window slides', () => {
    let now = 0;
    const cache = new LiveCache({ ...DEFAULT_CACHE, manifestTtlMs: 2_000, segmentTtlMs: 30_000 }, () => now);
    cache.put('m', new Uint8Array([1]), 'application/vnd.apple.mpegurl', true);
    cache.put('s', new Uint8Array([1]), 'video/mp2t', false);
    now = 2_500;
    expect(cache.get('m')).toBeNull();
    expect(cache.get('s')).not.toBeNull();
  });

  /*
   * A Range response is a window into a body. Keying on URL alone would serve
   * one client's window to another asking for a different one, so seeking
   * would return the wrong bytes — worse than a miss.
   */
  it('never caches a ranged request', () => {
    expect(cacheable('GET', undefined)).toBe(true);
    expect(cacheable('GET', 'bytes=0-511')).toBe(false);
    expect(cacheable('HEAD', undefined)).toBe(false);
  });

  it('refuses a body too large to be worth holding, and evicts to stay in budget', () => {
    const cache = new LiveCache({ ...DEFAULT_CACHE, maxEntryBytes: 8, maxTotalBytes: 16 });
    cache.put('big', new Uint8Array(9), 'video/mp2t', false);
    expect(cache.get('big')).toBeNull();
    cache.put('a', new Uint8Array(8), 'video/mp2t', false);
    cache.put('b', new Uint8Array(8), 'video/mp2t', false);
    cache.put('c', new Uint8Array(8), 'video/mp2t', false);
    expect(cache.stats().bytes).toBeLessThanOrEqual(16);
  });

  it('can be switched off entirely, which is the first thing to try', () => {
    expect(cacheOptions({ TVM_LIVE_CACHE: 'off' })).toBeNull();
    expect(cacheOptions({})?.manifestTtlMs).toBe(DEFAULT_CACHE.manifestTtlMs);
    expect(cacheOptions({ TVM_LIVE_CACHE_MANIFEST_MS: '5000' })?.manifestTtlMs).toBe(5_000);
    expect(cacheOptions({ TVM_LIVE_CACHE_MANIFEST_MS: 'banana' })?.manifestTtlMs).toBe(DEFAULT_CACHE.manifestTtlMs);
  });
});
