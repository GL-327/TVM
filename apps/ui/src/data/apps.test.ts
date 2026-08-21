import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appTileOpen,
  fallbackAppHub,
  fallbackApps,
  fetchAppHub,
  invalidateAppHubs,
  isHubApp,
  isMockApp,
  peekAppHub,
  prefetchAppHub,
  searchApps,
} from './apps';

const dir = dirname(fileURLToPath(import.meta.url));

const HUB = {
  id: 'netflix',
  name: 'Netflix',
  accent: '#e50914',
  layout: 'netflix',
  wordmark: 'NETFLIX',
  logo: '/apps/netflix.svg',
  disclaimer: 'Not the licensed Netflix app.',
  hero: null,
  continueWatching: [],
  rails: [],
};

afterEach(() => {
  invalidateAppHubs();
  vi.unstubAllGlobals();
});

describe('mock apps', () => {
  it('treats the seven streamers as in-app mocks', () => {
    expect(isMockApp('netflix')).toBe(true);
    expect(isMockApp('prime')).toBe(true);
    expect(isMockApp('max')).toBe(true);
    expect(isMockApp('appletv')).toBe(true);
    expect(isMockApp('disney')).toBe(true);
    expect(isMockApp('hulu')).toBe(true);
    expect(isMockApp('peacock')).toBe(true);
    expect(isMockApp('youtube')).toBe(false);
    expect(isMockApp('freevee')).toBe(false);
    expect(isHubApp('youtube')).toBe(true);
    expect(isHubApp('iplayer')).toBe(true);
  });

  it('opens every catalog tile on the service hub, including locked mocks', () => {
    expect(appTileOpen('netflix')).toEqual({ kind: 'service', id: 'netflix' });
    expect(appTileOpen('youtube')).toEqual({ kind: 'service', id: 'youtube' });
    expect(appTileOpen('peacock')).toEqual({ kind: 'service', id: 'peacock' });
    expect(appTileOpen('tvm-stream')).toEqual({ kind: 'library' });
  });

  it('puts Peacock at the end of the ribbon after HBO Max and Apple TV', () => {
    const ids = fallbackApps().ribbon.map((app) => app.id);
    expect(ids).toEqual(['tvm-stream', 'netflix', 'prime', 'max', 'appletv', 'disney', 'hulu', 'peacock']);
  });

  it('dedupes in-flight hub catalog fetches and caches the result', async () => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const fetchImpl = vi.fn((_url?: RequestInfo) => pending);
    vi.stubGlobal('fetch', fetchImpl);

    const first = fetchAppHub('netflix');
    const second = fetchAppHub('netflix');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(peekAppHub('netflix')).toBeNull();

    resolve(new Response(JSON.stringify(HUB), { status: 200 }));
    await expect(first).resolves.toMatchObject({ id: 'netflix' });
    await expect(second).resolves.toMatchObject({ id: 'netflix' });
    expect(peekAppHub('netflix')?.id).toBe('netflix');

    await expect(fetchAppHub('netflix')).resolves.toMatchObject({ id: 'netflix' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('prefetches hub catalogs and ignores TVM Stream', () => {
    const fetchImpl = vi.fn((_url?: RequestInfo) => Promise.resolve(new Response(JSON.stringify(HUB), { status: 200 })));
    vi.stubGlobal('fetch', fetchImpl);

    prefetchAppHub('tvm-stream');
    prefetchAppHub('netflix');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/api/apps/netflix');
  });

  it('opens a local hub catalog when the core endpoint is down', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('missing', { status: 404 })));
    vi.stubGlobal('fetch', fetchImpl);
    const hub = await fetchAppHub('netflix');
    expect(hub.id).toBe('netflix');
    expect(hub.layout).toBe('netflix');
    expect(hub.rails.length).toBeGreaterThan(0);
    expect(peekAppHub('netflix')?.rails.length).toBeGreaterThan(0);
  });

  it('builds a local hub with the mock layout id', () => {
    const hub = fallbackAppHub('prime');
    expect(hub.layout).toBe('prime');
    expect(hub.hero).not.toBeNull();
  });

  it('matches apps by name for Home search', () => {
    expect(searchApps('netflix').map((app) => app.id)).toContain('netflix');
    expect(searchApps('stream').map((app) => app.id)).toContain('tvm-stream');
    expect(searchApps('x')).toEqual([]);
  });
});

describe('service hubs', () => {
  it('does not trap mock apps behind a plan wall', () => {
    const src = readFileSync(join(dir, '../screens/Service.tsx'), 'utf8');
    const apps = readFileSync(join(dir, '../screens/Apps.tsx'), 'utf8');
    expect(src).not.toContain('is on Ultra and MAX');
    expect(src).toContain('ServiceHubScreen');
    expect(apps).not.toContain('mockAppLocked');
  });
});
