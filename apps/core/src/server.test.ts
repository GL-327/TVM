import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORE_HOST, DEFAULT_CORE_PORT, resolveBindHost, resolvePort } from './config.ts';
import { startCoreServer, type RunningCore, mediaPublicOrigin, portOfHost } from './server.ts';
import { resolveStaticPath } from './static.ts';

describe('HTML5 hop origin', () => {
  it('sends Vite Host hops to Core and keeps Roku/Core Hosts', () => {
    expect(portOfHost('127.0.0.1:5173')).toBe(5173);
    expect(mediaPublicOrigin('127.0.0.1:5173', 7345)).toBe('http://127.0.0.1:7345');
    expect(mediaPublicOrigin('127.0.0.1:7345', 7345)).toBe('http://127.0.0.1:7345');
    expect(mediaPublicOrigin('192.168.1.9:7345', 7345)).toBe('http://192.168.1.9:7345');
    expect(mediaPublicOrigin('127.0.0.1:5173', 8000)).toBe('http://127.0.0.1:8000');
    expect(mediaPublicOrigin(undefined, 7345)).toBe('http://127.0.0.1:7345');
  });
});

describe('core API', () => {
  let core: RunningCore;
  let baseUrl: string;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'tvm-core-api-'));
    core = await startCoreServer(0, { dataDir, env: {} });
    baseUrl = `http://${CORE_HOST}:${core.port}`;
  });

  afterAll(async () => {
    await core.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('reports health', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { status: string; version: string; uptimeSeconds: number };
    expect(body.status).toBe('ok');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('404s unknown api routes', async () => {
    const response = await fetch(`${baseUrl}/api/does-not-exist`);
    expect(response.status).toBe(404);
  });

  it('refuses art hops off the allowlist', async () => {
    const blocked = await fetch(`${baseUrl}/api/art?src=${encodeURIComponent('https://evil.example/secret.jpg')}`);
    expect(blocked.status).toBe(400);
    const missing = await fetch(`${baseUrl}/api/art`);
    expect(missing.status).toBe(400);
  });

  it('returns an empty library when Real-Debrid is not configured', async () => {
    const response = await fetch(`${baseUrl}/api/library`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it('starts with one profile and will not exceed the Free plan', async () => {
    const listed = await fetch(`${baseUrl}/api/profiles`);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { activeId: string; profiles: { id: string }[] };
    expect(body.profiles).toHaveLength(1);
    expect(body.activeId).toBe('profile-1');

    const extra = await fetch(`${baseUrl}/api/profiles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Extra' }),
    });
    expect(extra.status).toBe(400);
  });

  it('clears cache and factory-resets user data', async () => {
    const cache = await fetch(`${baseUrl}/api/maintenance/clear-cache`, { method: 'POST' });
    expect(cache.status).toBe(200);
    expect(await cache.json()).toEqual({ ok: true });

    const reset = await fetch(`${baseUrl}/api/maintenance/factory-reset`, { method: 'POST' });
    expect(reset.status).toBe(200);
    const profiles = await fetch(`${baseUrl}/api/profiles`);
    const body = (await profiles.json()) as { profiles: unknown[] };
    expect(body.profiles).toHaveLength(1);
  });

  it('does not switch to a Linux desktop outside the appliance', async () => {
    const listed = await fetch(`${baseUrl}/api/system/session`);
    expect(listed.status).toBe(200);
    const status = (await listed.json()) as { appliance: boolean };
    expect(status.appliance).toBe(false);

    const switched = await fetch(`${baseUrl}/api/system/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'desktop' }),
    });
    expect(switched.status).toBe(409);
    expect(await switched.json()).toEqual({ ok: false, reason: 'not_appliance' });
  });

  it('returns an empty live playlist and watchlist by default', async () => {
    const live = await fetch(`${baseUrl}/api/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({
      url: null,
      host: null,
      username: null,
      configured: false,
      channels: [],
      error: null,
      picked: 0,
      total: 0,
    });

    const watchlist = await fetch(`${baseUrl}/api/watchlist`);
    expect(watchlist.status).toBe(200);
    expect(await watchlist.json()).toEqual({ items: [] });
  });

  it('404s the UI when no bundle is configured', async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(404);
  });

  it('binds loopback only, never the LAN', () => {
    expect(CORE_HOST).toBe('127.0.0.1');
    expect(resolveBindHost({})).toBe('127.0.0.1');
  });

  it('refuses plan changes without developer unlock', async () => {
    const response = await fetch(`${baseUrl}/api/plan`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'max' }),
    });
    expect(response.status).toBe(403);
    const plan = await fetch(`${baseUrl}/api/plan`);
    expect(await plan.json()).toMatchObject({ id: 'free' });
  });

  it('checks out Free and rejects a garbage card without echoing digits', async () => {
    const free = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId: 'free' }),
    });
    expect(free.status).toBe(200);
    expect(await free.json()).toMatchObject({ id: 'free', mocks: false });

    const bad = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planId: 'premium',
        name: 'Arthur',
        number: '1111111111111111',
        expiry: '12/99',
        cvc: '123',
      }),
    });
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: string };
    expect(body.error).toMatch(/card number/i);
    expect(JSON.stringify(body)).not.toContain('1111111111111111');
  });

  it('lets a paid plan drop Live TV and refuses it on Free', async () => {
    const paid = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planId: 'basic',
        name: 'Arthur Foxall',
        number: '4242424242424242',
        expiry: '12/99',
        cvc: '123',
        liveTv: false,
      }),
    });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ id: 'basic', liveTv: false, pricePence: 499 });

    const added = await fetch(`${baseUrl}/api/plan/live-tv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({ id: 'basic', liveTv: true, pricePence: 799 });

    await fetch(`${baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId: 'free' }),
    });
    const refused = await fetch(`${baseUrl}/api/plan/live-tv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(refused.status).toBe(400);
  });

  it('sells the Synthwave pack on checkout', async () => {
    const paid = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planId: 'basic',
        name: 'Arthur Foxall',
        number: '4242424242424242',
        expiry: '12/99',
        cvc: '123',
        liveTv: false,
        synthwave: true,
      }),
    });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ id: 'basic', synthwave: true, pricePence: 998 });
  });

  it('rejects a wrong developer code without a hint', async () => {
    const response = await fetch(`${baseUrl}/api/dev/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ unlocked: false, error: 'That code is not valid.' });
  });
});

describe('core serving the UI bundle', () => {
  let core: RunningCore;
  let baseUrl: string;
  let uiDist: string;

  beforeAll(async () => {
    uiDist = await mkdtemp(join(tmpdir(), 'tvm-ui-'));
    await writeFile(join(uiDist, 'index.html'), '<!doctype html><title>TVM</title>');
    await writeFile(join(uiDist, 'app.js'), 'export const ok = true;');

    core = await startCoreServer(0, { uiDist, dataDir: uiDist });
    baseUrl = `http://${CORE_HOST}:${core.port}`;
  });

  afterAll(async () => {
    await core.close();
    await rm(uiDist, { recursive: true, force: true });
  });

  it('serves index.html at the root', async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('TVM');
  });

  it('serves assets with their own content type', async () => {
    const response = await fetch(`${baseUrl}/app.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/javascript');
  });

  it('falls back to index.html so a reload keeps working', async () => {
    const response = await fetch(`${baseUrl}/settings/display`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('TVM');
  });

  it('keeps /api separate from the bundle', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});

describe('resolveStaticPath', () => {
  const root = process.platform === 'win32' ? 'C:\\tvm\\ui' : '/tvm/ui';

  it('resolves paths inside the bundle', () => {
    expect(resolveStaticPath(root, '/index.html')).not.toBeNull();
    expect(resolveStaticPath(root, '/assets/app.js')).not.toBeNull();
  });

  it('rejects traversal out of the bundle', () => {
    expect(resolveStaticPath(root, '/../../etc/passwd')).toBeNull();
    expect(resolveStaticPath(root, '/assets/../../../secrets')).toBeNull();
  });

  it('rejects encoded traversal and null bytes', () => {
    expect(resolveStaticPath(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(resolveStaticPath(root, '/index.html%00.png')).toBeNull();
  });
});

describe('resolvePort', () => {
  it('defaults when unset', () => {
    expect(resolvePort({})).toBe(DEFAULT_CORE_PORT);
    expect(resolvePort({ TVM_CORE_PORT: '' })).toBe(DEFAULT_CORE_PORT);
  });

  it('accepts a valid port', () => {
    expect(resolvePort({ TVM_CORE_PORT: '8080' })).toBe(8080);
  });

  it('rejects nonsense rather than falling back silently', () => {
    expect(() => resolvePort({ TVM_CORE_PORT: 'abc' })).toThrow(/port number/);
    expect(() => resolvePort({ TVM_CORE_PORT: '99999' })).toThrow(/port number/);
  });
});

describe('resolveBindHost', () => {
  it('defaults to loopback when unset', () => {
    expect(resolveBindHost({})).toBe(CORE_HOST);
    expect(resolveBindHost({ TVM_CORE_BIND: '' })).toBe(CORE_HOST);
    expect(resolveBindHost({ TVM_ENV: 'production' })).toBe(CORE_HOST);
  });

  it('stays on loopback even in development so a laptop without Wi-Fi can start', () => {
    expect(resolveBindHost({ TVM_ENV: 'development' })).toBe(CORE_HOST);
    expect(resolveBindHost({ TVM_ENV: 'development', TVM_CORE_BIND: '' })).toBe(CORE_HOST);
    expect(resolveBindHost({ TVM_ENV: 'development', TVM_CORE_BIND: '127.0.0.1' })).toBe('127.0.0.1');
  });

  it('accepts an explicit loopback or LAN bind', () => {
    expect(resolveBindHost({ TVM_CORE_BIND: '127.0.0.1' })).toBe('127.0.0.1');
    expect(resolveBindHost({ TVM_CORE_BIND: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveBindHost({ TVM_CORE_BIND: '192.168.1.10' })).toBe('192.168.1.10');
  });

  it('rejects nonsense rather than falling back silently', () => {
    expect(() => resolveBindHost({ TVM_CORE_BIND: 'localhost' })).toThrow(/IPv4/);
    expect(() => resolveBindHost({ TVM_CORE_BIND: '999.1.1.1' })).toThrow(/IPv4/);
    expect(() => resolveBindHost({ TVM_CORE_BIND: '::' })).toThrow(/IPv4/);
  });
});

describe('roku client contract', () => {
  let core: RunningCore;
  let baseUrl: string;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'tvm-roku-contract-'));
    core = await startCoreServer(0, { dataDir, env: {} });
    baseUrl = `http://${CORE_HOST}:${core.port}`;
  });

  afterAll(async () => {
    await core.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('serves the endpoints a Roku TV client needs', async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    const home = await fetch(`${baseUrl}/api/home`);
    const library = await fetch(`${baseUrl}/api/library`);
    const search = await fetch(`${baseUrl}/api/search?q=test`);
    const live = await fetch(`${baseUrl}/api/live`);
    const profiles = await fetch(`${baseUrl}/api/profiles`);
    const watchlist = await fetch(`${baseUrl}/api/watchlist`);
    const rd = await fetch(`${baseUrl}/api/rd/status`);
    const unknownApp = await fetch(`${baseUrl}/api/apps/not-a-studio`);
    const appsList = await fetch(`${baseUrl}/api/apps`);
    const plan = await fetch(`${baseUrl}/api/plan`);
    expect(plan.status).toBe(200);
    expect(await plan.json()).toMatchObject({ id: 'free', name: 'TVM Free', mocks: false });

    const fatItem = {
      id: 'tt0000001',
      title: 'Contract Probe',
      year: 2026,
      kind: 'movie',
      synopsis: 'x'.repeat(4500),
      poster: '',
      backdrop: '',
      genres: ['Drama'],
      rating: '7.1',
      playable: false,
      hue: 12,
    };
    const fatBody = JSON.stringify({ item: fatItem });
    const put = await fetch(`${baseUrl}/api/watchlist`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: fatBody,
    });
    const play = await fetch(`${baseUrl}/api/playback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'tt0000001' }),
    });

    expect(health.status).toBe(200);
    expect(home.status).toBe(200);
    expect(library.status).toBe(200);
    expect(search.status).toBe(200);
    expect(live.status).toBe(200);
    expect(profiles.status).toBe(200);
    expect(watchlist.status).toBe(200);
    expect(rd.status).toBe(200);
    expect(unknownApp.status).toBe(404);
    expect(appsList.status).toBe(200);
    expect(plan.status).toBe(200);
    expect(play.status).toBeGreaterThanOrEqual(200);
    expect(put.status).toBe(200);
  });
});

describe('roku preview serving', () => {
  it('serves the preview only in development', async () => {
    const preview = await mkdtemp(join(tmpdir(), 'tvm-roku-preview-'));
    const dataDir = await mkdtemp(join(tmpdir(), 'tvm-roku-preview-data-'));
    await writeFile(join(preview, 'index.html'), '<!doctype html><title>Roku preview</title>');
    await writeFile(join(preview, 'preview.js'), 'window.TVM_PREVIEW = true;');

    const core = await startCoreServer(0, {
      dataDir,
      rokuPreview: preview,
      env: { TVM_ENV: 'development' },
    });
    const baseUrl = `http://${CORE_HOST}:${core.port}`;

    try {
      const page = await fetch(`${baseUrl}/roku-preview/`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(await page.text()).toContain('Roku preview');

      const script = await fetch(`${baseUrl}/roku-preview/preview.js`);
      expect(script.status).toBe(200);
      expect(await script.text()).toContain('TVM_PREVIEW');

      const missing = await fetch(`${baseUrl}/roku-preview/missing.js`);
      expect(missing.status).toBe(404);

      const traversal = await fetch(`${baseUrl}/roku-preview/../../package.json`);
      expect(traversal.status).toBe(404);
    } finally {
      await core.close();
      await rm(preview, { recursive: true, force: true });
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('does not serve the preview outside development', async () => {
    const preview = await mkdtemp(join(tmpdir(), 'tvm-roku-preview-off-'));
    const dataDir = await mkdtemp(join(tmpdir(), 'tvm-roku-preview-off-data-'));
    await writeFile(join(preview, 'index.html'), '<!doctype html><title>Roku preview</title>');

    const core = await startCoreServer(0, {
      dataDir,
      rokuPreview: preview,
      env: {},
    });
    const baseUrl = `http://${CORE_HOST}:${core.port}`;

    try {
      const page = await fetch(`${baseUrl}/roku-preview/`);
      expect(page.status).toBe(404);
    } finally {
      await core.close();
      await rm(preview, { recursive: true, force: true });
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
