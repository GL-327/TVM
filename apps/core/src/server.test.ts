import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORE_HOST, DEFAULT_CORE_PORT, resolvePort } from './config.ts';
import { startCoreServer, type RunningCore } from './server.ts';
import { resolveStaticPath } from './static.ts';

describe('core API', () => {
  let core: RunningCore;
  let baseUrl: string;

  beforeAll(async () => {
    core = await startCoreServer(0);
    baseUrl = `http://${CORE_HOST}:${core.port}`;
  });

  afterAll(async () => {
    await core.close();
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
    const response = await fetch(`${baseUrl}/api/library`);
    expect(response.status).toBe(404);
  });

  it('404s the UI when no bundle is configured', async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(404);
  });

  it('binds loopback only, never the LAN', () => {
    expect(CORE_HOST).toBe('127.0.0.1');
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

    core = await startCoreServer(0, { uiDist });
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
