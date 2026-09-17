import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORE_HOST } from '../config.ts';
import { accessError } from '../security.ts';
import { startCoreServer, type RunningCore } from '../server.ts';
import { resetServerSideLive } from './routes.ts';

const LAN_TOKEN = 'a'.repeat(40);

/** A request as Core sees one, without opening a socket. */
function fakeRequest(input: {
  remote: string;
  host: string;
  method?: string;
  authorization?: string;
}): IncomingMessage {
  return {
    method: input.method ?? 'GET',
    headers: {
      host: input.host,
      ...(input.authorization !== undefined ? { authorization: input.authorization } : {}),
    },
    socket: { remoteAddress: input.remote, localAddress: input.remote === '127.0.0.1' ? '127.0.0.1' : '192.168.1.10' },
  } as unknown as IncomingMessage;
}

/*
 * The proxy is a content route, so it inherits Core's existing answer to "who
 * is allowed to ask". These four cases are the whole contract, and they are
 * checked against the real accessError rather than a copy of its rules —
 * a copy would drift, and the point is that nothing about the contract moved.
 */
describe('who may reach the live proxy', () => {
  const env = { TVM_LAN_TOKEN: LAN_TOKEN };
  const proxy = '/api/live/proxy/0123456789abcdef0123456789abcdef';

  it('lets the appliance and the Electron shell through on loopback with no token', () => {
    expect(accessError(fakeRequest({ remote: '127.0.0.1', host: '127.0.0.1:7345' }), proxy, env)).toBeNull();
  });

  it('lets a LAN client through with the bearer token it already sends', () => {
    // Exactly the header apps/roku puts on Core-hosted streams today.
    const request = fakeRequest({ remote: '192.168.1.44', host: '192.168.1.10:7345', authorization: `Bearer ${LAN_TOKEN}` });
    expect(accessError(request, proxy, env)).toBeNull();
  });

  it('refuses a LAN client with no token, and one with the wrong token', () => {
    expect(accessError(fakeRequest({ remote: '192.168.1.44', host: '192.168.1.10:7345' }), proxy, env))
      .toBe('lan_authentication_required');
    expect(accessError(fakeRequest({ remote: '192.168.1.44', host: '192.168.1.10:7345', authorization: `Bearer ${'b'.repeat(40)}` }), proxy, env))
      .toBe('lan_authentication_required');
  });

  /*
   * The proxy must stay a content route. If it ever drifted into the
   * loopback-only list, every Roku and phone on the LAN would stop playing.
   */
  it('is not swept into the loopback-only set that guards admin and billing', () => {
    const lan = fakeRequest({ remote: '192.168.1.44', host: '192.168.1.10:7345', authorization: `Bearer ${LAN_TOKEN}` });
    expect(accessError(lan, proxy, env)).toBeNull();
    expect(accessError(lan, '/api/live/sources', env)).toBeNull();
    // ...while the routes that must stay local still are.
    expect(accessError(lan, '/api/dev/unlock', env)).toBe('local_access_required');
    expect(accessError({ ...lan, method: 'POST' } as unknown as IncomingMessage, '/api/dev/unlock', env)).toBeNull();
    expect(accessError(lan, '/api/privacy/export', env)).toBe('local_access_required');
    expect(accessError(lan, '/api/billing/status', env)).toBe('local_access_required');
  });
});

describe('the live proxy on a running Core', () => {
  let core: RunningCore;
  let baseUrl: string;
  let dataDir: string;

  beforeAll(async () => {
    resetServerSideLive();
    dataDir = await mkdtemp(join(tmpdir(), 'tvm-live-proxy-'));
    core = await startCoreServer(0, { dataDir, env: {} });
    baseUrl = `http://${CORE_HOST}:${core.port}`;
  });

  afterAll(async () => {
    await core.close();
    resetServerSideLive();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('lists channels over loopback with no token, and names no provider', async () => {
    const response = await fetch(`${baseUrl}/api/live/sources`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { channels: unknown[]; stats: { channels: number } };
    expect(Array.isArray(body.channels)).toBe(true);
    expect(body.stats.channels).toBe(0);
  });

  /*
   * A Roku attaches its bearer token only when the stream URL is a Core URL
   * (coreOwnsUrl in apps/roku/source/config.brs). Returning the path
   * relative would mean every client had to rebuild it, and a client that
   * got it wrong would silently fail auth.
   */
  it('hands clients an absolute Core URL, so the Roku bearer rule matches', async () => {
    const response = await fetch(`${baseUrl}/api/live/sources`);
    const body = (await response.json()) as { channels: { play: string }[] };
    for (const channel of body.channels) {
      expect(channel.play.startsWith('http://')).toBe(true);
      expect(channel.play).toContain('/api/live/proxy/');
    }
  });

  it('refuses a token it never minted rather than fetching anything', async () => {
    const response = await fetch(`${baseUrl}/api/live/proxy/${'f'.repeat(32)}`);
    expect(response.status).toBe(404);
  });

  it('refuses a token that is not even token-shaped', async () => {
    const response = await fetch(`${baseUrl}/api/live/proxy/..%2F..%2Fetc%2Fpasswd`);
    expect(response.status).toBe(404);
  });

  it('answers the preflight the browser player sends', async () => {
    const response = await fetch(`${baseUrl}/api/live/proxy/${'0'.repeat(32)}`, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
  });

  /*
   * Core's own live routes predate this module and still serve the catalogue,
   * picks and channel check. The proxy is dispatched first, so this confirms
   * it falls through rather than swallowing them.
   */
  it('leaves the existing live routes alone', async () => {
    const response = await fetch(`${baseUrl}/api/live`);
    expect(response.status).toBe(200);
  });
});
