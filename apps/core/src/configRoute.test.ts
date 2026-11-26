import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createCoreServer } from './server.ts';
import { createRemoteAccountsService } from './providers/remoteAccounts.ts';

async function get(fetchImpl: typeof fetch, times = 1) {
  const dataDir = await mkdtemp(join(tmpdir(), 'tvm-config-'));
  const accounts = createRemoteAccountsService({ dataDir, termsVersion: 't', env: {}, fetch: fetchImpl });
  const server = createCoreServer({ dataDir, env: {}, accounts });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    let last: Record<string, unknown> = {};
    for (let i = 0; i < times; i++) {
      last = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/config`)).json() as Record<string, unknown>;
    }
    return last;
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

describe('GET /api/config', () => {
  it('passes the service config and flags through, cached', async () => {
    const api = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      announcement: null, minVersion: '1.4.0', flags: { patchNotesPopup: true, junk: 'x' }, openSignups: true, mail: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await get(api, 2)).toMatchObject({ minVersion: '1.4.0', flags: { patchNotesPopup: true }, openSignups: true });
    expect(api).toHaveBeenCalledTimes(1);
  });
  it('returns defaults when the service is unreachable', async () => {
    const api = vi.fn<typeof fetch>(async () => { throw new Error('down'); });
    expect(await get(api)).toEqual({ announcement: null, minVersion: null, flags: {}, openSignups: false, mail: false });
  });
});
