import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCoreServer } from './server.ts';
import { rdTokenPath } from './update/paths.ts';
import { readSecret, writeSecret } from './providers/secrets.ts';

it('exports a real sandbox receipt without credentials and erases the device only after confirmation', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'tvm-privacy-'));
  const core = await startCoreServer(0, { dataDir, env: {} });
  const base = `http://127.0.0.1:${core.port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    writeSecret(rdTokenPath(dataDir), 'do-not-export-this-token');
    const order = await post('/api/billing/checkout', { planId: 'basic', consent: true, requestId: 'privacy-test-order', liveTv: false });
    expect(order.status).toBe(200);
    const exported = await fetch(base + '/api/privacy/export');
    expect(exported.headers.get('content-disposition')).toContain('attachment');
    const data = await exported.text();
    expect(data).toContain('privacy-test-order');
    expect(data).not.toContain('do-not-export-this-token');
    expect((await post('/api/privacy/erase', {})).status).toBe(400);
    expect(readSecret(rdTokenPath(dataDir))).toBe('do-not-export-this-token');
    expect((await post('/api/privacy/erase', { confirmation: 'ERASE_LOCAL_DATA' })).status).toBe(200);
    expect(readSecret(rdTokenPath(dataDir))).toBeNull();
    expect(await (await fetch(base + '/api/billing')).json()).toMatchObject({ subscription: 'free', receipts: [] });
    expect(await (await fetch(base + '/api/dev/status')).json()).toEqual({ unlocked: false });
    const bad = await fetch(base + '/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null' });
    expect(bad.status).toBe(400);
  } finally {
    await core.close(); await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 20_000);
