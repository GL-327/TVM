import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CORE_HOST } from '../config.ts';
import { createAccountsService } from '../providers/accounts.ts';
import { accessError } from '../security.ts';
import { startCoreServer, type RunningCore } from '../server.ts';
import { hubPath } from '../update/paths.ts';
import { registrationInput } from './testSupport.ts';

vi.mock('../providers/secureFile.ts', async original => ({ ...await original<typeof import('../providers/secureFile.ts')>(), windowsProtect: (value: string) => value }));

const running: RunningCore[] = []; const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map(c => c.close()));
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});
async function boot() {
  const dataDir = await mkdtemp(join(tmpdir(), 'tvm-hub-http-')); dirs.push(dataDir);
  const accounts = createAccountsService({ dataDir, termsVersion: 'test' });
  const signed = accounts.signInDev();
  accounts.register({ email: 'other@example.com', password: 'correct horse battery' });
  const other = accounts.signIn({ email: 'other@example.com', password: 'correct horse battery' });
  const core = await startCoreServer(0, { dataDir, accounts, env: {} }); running.push(core);
  const call = async (path: string, options: { token?: string; device?: string; profile?: string; body?: unknown; method?: string; headers?: Record<string, string> } = {}) => {
    const response = await fetch(`http://${CORE_HOST}:${core.port}${path.startsWith('/api/') ? path : `/api/hub/v1${path}`}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: { ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token === undefined ? {} : { 'x-tvm-account': options.token }),
        ...(options.device === undefined ? {} : { 'x-tvm-device': options.device }),
        ...(options.profile === undefined ? {} : { 'x-tvm-profile': options.profile }), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as Record<string, any> };
  };
  const link = async (clientId = 'http-client', token = signed.token) => {
    const result = await call('/installations/register', { token, body: registrationInput(clientId) });
    expect(result.status).toBe(200);
    return { id: result.body['installation'].id as string, credential: `${result.body['installation'].id}.${result.body['deviceSecret']}` };
  };
  return { dataDir, accounts, token: signed.token, other: other.token, call, link };
}
describe('Hub HTTP integration', () => {
  it('requires account/device auth, returns versioned errors, and preserves middleware protections', async () => {
    const f = await boot();
    expect((await f.call('/overview')).body).toMatchObject({ error: 'auth_required', serverTime: expect.any(String), message: expect.any(String) });
    expect((await f.call('/presence', { body: { seq: 0, state: 'idle' } })).status).toBe(401);
    expect((await f.call('/api/hub/v2/overview', { token: f.token })).status).toBe(404);
    expect((await f.call('/unknown', { token: f.token })).status).toBe(404);
    expect((await f.call('/installations/register', { token: f.token, body: registrationInput(), headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await f.call('/installations/register', { token: f.token, body: registrationInput(), headers: { 'content-type': 'text/plain' } })).body['error']).toBe('json_required');
  });
  it('lists, renames, assigns rooms and scopes nowPlaying by profile/dev role', async () => {
    const f = await boot(); const a = await f.link('a', f.other);
    await f.call('/presence', { device: a.credential, body: { seq: 1, state: 'playing', nowPlaying: {
      mediaId: 'private-media', title: 'Private title', artworkUrl: null, positionSec: 10, durationSec: 100, profileId: 'profile-a',
    } } });
    const overview = await f.call('/overview', { token: f.other, device: a.credential });
    expect(overview.body).toMatchObject({ v: 1, heartbeatSec: 30, currentInstallationId: a.id, visibleSpokes: 6 });
    expect(overview.body['devices'][0]).toMatchObject({ nowPlaying: { restricted: true }, isCurrent: true, state: 'playing' });
    expect((await f.call('/overview', { token: f.other, profile: 'profile-a' })).body['devices'][0].nowPlaying.title).toBe('Private title');
    expect((await f.call(`/devices/${a.id}/rename`, { token: f.other, body: { name: 'Kitchen' } })).body['device'].name).toBe('Kitchen');
    expect((await f.call(`/devices/${a.id}/room`, { token: f.other, body: { room: 'Downstairs' } })).body['device'].room).toBe('Downstairs');
    expect((await f.call(`/devices/${a.id}/rename`, { token: f.other, body: { name: '' } })).body['error']).toBe('invalid_name');
    expect((await f.call('/overview', { token: f.other })).body['devices'][0].slot).toBe(0);
  });
  it('returns 404 for another account devices, commands and optional actor credentials', async () => {
    const f = await boot(); const a = await f.link();
    await f.call('/presence', { device: a.credential, body: { seq: 0, state: 'idle' } });
    const sent = await f.call('/commands', { token: f.token, device: a.credential, body: { v: 1, idempotencyKey: 'one', target: a.id, action: 'nav.back' } });
    expect(sent.body['command'].actor.installationId).toBe(a.id);
    expect((await f.call(`/commands/${sent.body['command'].id}`, { token: f.other })).status).toBe(404);
    expect((await f.call(`/devices/${a.id}/revoke`, { token: f.other, body: {} })).status).toBe(404);
    expect((await f.call('/commands', { token: f.other, body: { v: 1, idempotencyKey: 'x', target: a.id, action: 'nav.back' } })).status).toBe(404);
    expect((await f.call('/overview', { token: f.other, device: a.credential })).status).toBe(404);
    expect((await f.call('/overview', { token: f.other })).body['devices']).toEqual([]);
  });
  it('delivers and acknowledges commands, then revokes device credentials and pending commands', async () => {
    const f = await boot(); const a = await f.link();
    const presence = await f.call('/presence', { device: a.credential, body: { seq: 1, state: 'idle' } });
    expect(presence.body).toMatchObject({ heartbeatSec: 30, rev: expect.any(Number), pendingCommands: 0 });
    const sent = await f.call('/commands', { token: f.token, body: { v: 1, idempotencyKey: 'one', target: a.id, action: 'nav.back' } });
    const id = sent.body['command'].id as string;
    expect((await f.call('/inbox?after=0', { device: a.credential })).body['commands'].map((c: any) => c.id)).toEqual([id]);
    expect((await f.call(`/commands/${id}/ack`, { device: a.credential, body: { status: 'applied' } })).body['error']).toBe('invalid_transition');
    expect((await f.call(`/commands/${id}/ack`, { device: a.credential, body: { status: 'accepted' } })).status).toBe(200);
    await f.call(`/devices/${a.id}/revoke`, { token: f.token, body: {} });
    expect((await f.call(`/commands/${id}`, { token: f.token })).body['command']).toMatchObject({ status: 'rejected', reason: 'device_revoked' });
    expect((await f.call('/presence', { device: a.credential, body: { seq: 2, state: 'idle' } })).body['error']).toBe('device_revoked');
    expect((await f.call('/overview', { token: f.token })).body['devices']).toEqual([]);
    expect((await f.call('/overview?includeRevoked=1', { token: f.token })).body['devices'][0].state).toBe('revoked');
    const b = await f.link('b');
    expect((await f.call('/session/signout', { device: b.credential, body: {} })).body['ok']).toBe(true);
    expect((await f.call('/inbox', { device: b.credential })).body['error']).toBe('device_revoked');
  });
  it('pairs without account auth on the TV and redeems exactly once over concurrent HTTP requests', async () => {
    const f = await boot(); const p = (await f.call('/pair/start', { body: registrationInput() })).body;
    expect((await f.call(`/pair/lookup?userCode=${p['userCode']}`)).status).toBe(401);
    expect((await f.call(`/pair/lookup?userCode=${p['userCode']}`, { token: f.other })).body['request'].name).toBe('Living room');
    expect((await f.call('/pair/approve', { token: f.other, body: { userCode: p['userCode'] } })).body['ok']).toBe(true);
    const results = await Promise.all([0, 1].map(() => f.call('/pair/token', { body: { deviceCode: p['deviceCode'] } })));
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    expect(results.find(r => r.status === 400)!.body['error']).toBe('expired_token');
    const grant = results.find(r => r.status === 200)!.body;
    expect((await f.call('/api/account', { token: grant['accountToken'] })).body['signedIn']).toBe(true);
    expect((await f.call('/presence', { device: `${grant['installation'].id}.${grant['deviceSecret']}`, body: { seq: 0, state: 'idle' } })).status).toBe(200);
  });
  it('reports pending, slow_down, denied and per-session rate limiting with contract error codes', async () => {
    const f = await boot(); const p = (await f.call('/pair/start', { body: registrationInput() })).body;
    expect((await f.call('/pair/token', { body: { deviceCode: p['deviceCode'] } })).body['error']).toBe('authorization_pending');
    expect((await f.call('/pair/token', { body: { deviceCode: p['deviceCode'] } })).body['error']).toBe('slow_down');
    expect((await f.call('/pair/deny', { token: f.token, body: { userCode: p['userCode'] } })).status).toBe(200);
    expect((await f.call('/pair/token', { body: { deviceCode: p['deviceCode'] } })).body['error']).toBe('access_denied');
    for (let i = 0; i < 5; i++) expect((await f.call('/pair/lookup?userCode=AAAAAAAA', { token: f.token })).status).toBe(404);
    expect((await f.call('/pair/lookup?userCode=AAAAAAAA', { token: f.token })).body['error']).toBe('rate_limited');
    expect((await f.call('/pair/lookup?userCode=AAAAAAAA', { token: f.other })).status).toBe(404);
  });
  it('serves 503 instead of resetting a corrupt store', async () => {
    const f = await boot(); await f.link(); writeFileSync(hubPath(f.dataDir), 'corrupt');
    const failed = await f.call('/overview', { token: f.token });
    expect(failed.status).toBe(503); expect(failed.body).toMatchObject({ error: 'hub_unavailable', serverTime: expect.any(String) });
    expect((await f.call('/installations/register', { token: f.token, body: registrationInput() })).status).toBe(503);
  });
  it('leaves Hub behind the LAN gate and available to authenticated non-loopback callers', () => {
    const token = 'l'.repeat(32);
    const request = { headers: { host: '127.0.0.1:7345', 'content-type': 'application/json' },
      method: 'POST', socket: { remoteAddress: '192.168.1.9', localAddress: '127.0.0.1' } } as IncomingMessage;
    expect(accessError(request, '/api/hub/v1/pair/start', {})).toBe('lan_authentication_required');
    request.headers.authorization = `Bearer ${token}`;
    expect(accessError(request, '/api/hub/v1/pair/start', { TVM_LAN_TOKEN: token })).toBeNull();
    delete request.headers.authorization;
    expect(accessError(request, '/api/hub/v1/overview', {}, true)).toBeNull();
  });
});
