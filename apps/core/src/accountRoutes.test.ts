import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoreServer } from './server.ts';
import { createRemoteAccountsService } from './providers/remoteAccounts.ts';
import { mockAccountsApi } from './providers/remoteAccountsTestSupport.ts';
import { TERMS_VERSION } from './providers/terms.ts';
import { readSealed } from './providers/vault.ts';

vi.mock('./providers/secureFile.ts', async original => ({ ...await original<typeof import('./providers/secureFile.ts')>(), windowsProtect: (value: string) => value }));
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});
async function boot(lan = false, realMedia = false) {
  const dataDir = await mkdtemp(join(tmpdir(), 'tvm-remote-routes-')); dirs.push(dataDir);
  const mock = mockAccountsApi();
  const accounts = createRemoteAccountsService({ dataDir, termsVersion: TERMS_VERSION, env: {}, fetch: mock.api });
  const media = { status: vi.fn(async () => ({ configured: accounts.cachedRdTokenFor('member-session') !== null,
    username: null, premium: false, error: null })), configured: () => false };
  const server = createCoreServer({ dataDir, env: { TVM_LAN_TOKEN: 'l'.repeat(32) }, accounts,
    ...(realMedia ? {} : { media: media as unknown as import('./providers/media.ts').MediaService }) });
  if (lan) server.prependListener('connection', socket => Object.defineProperty(socket, 'remoteAddress', { value: '192.168.1.50' }));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = async (path: string, options: { method?: string; body?: unknown; token?: string } = {}) => {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: { ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(lan ? { authorization: `Bearer ${'l'.repeat(32)}` } : {}),
        ...(options.token ? { 'x-tvm-account': options.token } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as Record<string, any> };
  };
  const install = () => call('/api/admin/key', { token: 'admin-session', body: { key: 'fixture-admin-key' } });
  return { ...mock, accounts, media, dataDir, call, install };
}
describe('remote account HTTP compatibility', () => {
  it('selects the remote provider by default and honors the service-origin override', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tvm-default-remote-')); dirs.push(dataDir);
    const mock = mockAccountsApi();
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).startsWith('https://accounts-test.example/')) return mock.api(input, init);
      return realFetch(input, init);
    }));
    const server = createCoreServer({ dataDir, env: { TVM_ACCOUNTS_URL: 'https://accounts-test.example' } });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/account/signin`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: mock.member.email, password: 'test-password' }),
    });
    expect(await response.json()).toMatchObject({ token: 'member-session', account: { id: mock.member.id } });
    expect(mock.api.mock.calls[0]?.[0]).toBe('https://accounts-test.example/v1/signin');
    expect(await readdir(join(dataDir, 'secrets'))).not.toContain('accounts.enc');
  });
  it('registers, signs in, accepts terms and signs out using the existing shapes', async () => {
    const f = await boot();
    expect((await f.call('/api/account')).body).toMatchObject({ signedIn: false, canSendEmail: false });
    expect((await f.call('/api/account/register', { body: { email: f.member.email, password: 'test-password' } })).body)
      .toMatchObject({ id: f.member.id, activated: false, tier: null, role: 'member', emailCodeSent: false });
    const signed = await f.call('/api/account/signin', { body: { email: f.member.email, password: 'test-password' } });
    expect(signed.body).toMatchObject({ token: 'member-session', usable: { reason: 'awaiting_activation' } });
    expect((await f.call('/api/account', { token: 'member-session' })).body)
      .toMatchObject({ signedIn: true, account: { rdKey: false }, usable: { reason: 'awaiting_activation' } });
    f.member.status = 'active';
    expect((await f.call('/api/account/terms', { token: 'member-session', body: {} })).body.termsVersion).toBe(TERMS_VERSION);
    expect((await f.call('/api/account', { token: 'member-session' })).body.usable).toEqual({ ok: true, reason: null });
    expect((await f.call('/api/account/signout', { token: 'member-session', body: {} })).body).toEqual({ ok: true });
    expect((await f.call('/api/account', { token: 'member-session' })).body.signedIn).toBe(false);
    const saved = readSealed<{ tokens: string[] }>(f.dataDir, join(f.dataDir, 'secrets', 'account-sessions.enc'));
    expect(saved?.tokens).toEqual([]);
  });
  it('requires both admin role and a sealed local admin key for every accounts action', async () => {
    const f = await boot();
    const routes = ['/api/admin/accounts', ...['activate', 'suspend', 'note', 'erase', 'live-tv', 'rd', 'verify'].map(x => `/api/admin/accounts/${x}`)];
    for (const token of [undefined, 'member-session', 'admin-session']) {
      for (const path of routes) expect((await f.call(path, { token, ...(path.endsWith('accounts') ? {} : { body: { id: f.member.id } }) })).status).toBe(403);
    }
    expect(f.api.mock.calls.some(([url]) => String(url).includes('/v1/admin/'))).toBe(false);
    expect((await f.call('/api/admin/key', { token: 'member-session', body: { key: 'fixture-admin-key' } })).status).toBe(403);
    expect((await f.install()).body).toEqual({ installed: true });
    expect((await f.call('/api/admin/accounts', { token: 'member-session' })).status).toBe(403);
    const listed = await f.call('/api/admin/accounts?state=waiting&search=Ada', { token: 'admin-session' });
    expect(listed.body).toMatchObject({ accounts: expect.arrayContaining([expect.objectContaining({ id: f.member.id })]), summary: { total: 2 }, tiers: expect.any(Array) });
    const file = await readFile(join(f.dataDir, 'secrets', 'accounts-admin-key.enc'), 'utf8');
    expect(file).not.toContain('fixture-admin-key');
    expect((await f.call('/api/admin/key', { token: 'admin-session', body: { key: '' } })).body).toEqual({ installed: false });
    expect((await f.call('/api/admin/accounts', { token: 'admin-session' })).status).toBe(403);
  });
  it('translates all admin mutations without returning secrets', async () => {
    const f = await boot(); await f.install();
    const post = (action: string, body: unknown) => f.call(`/api/admin/accounts/${action}`, { token: 'admin-session', body: { id: f.member.id, ...body as object } });
    expect((await post('activate', { tier: 'stream' })).body.activated).toBe(true);
    expect((await post('live-tv', { enabled: true })).body.tier).toBe('stream-live');
    expect((await post('note', { note: 'private note' })).body.note).toBe('private note');
    expect((await post('verify', { verified: true })).body.emailVerified).toBe(true);
    const rd = await post('rd', { token: 'fixture-rd-secret' });
    expect(rd.body).toMatchObject({ rdKey: true, rdKeyHint: '\u2022'.repeat(4) });
    expect(JSON.stringify(rd.body)).not.toContain('fixture-rd-secret');
    expect((await post('suspend', { suspended: true })).body.suspended).toBe(true);
    expect((await f.call(`/api/admin/accounts/${f.member.id}/clear-sync`, { token: 'admin-session', body: {} })).status).toBe(200);
    expect((await post('erase', {})).body).toMatchObject({ ok: true, summary: expect.any(Object) });
    const calls = f.api.mock.calls.filter(([url]) => String(url).includes('/v1/admin/'));
    for (const [, init] of calls) expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-admin-key');
  });
  it('maps admin role to dev for existing screens without granting other sessions privileges', async () => {
    const f = await boot();
    expect((await f.call('/api/account', { token: 'admin-session' })).body.account.role).toBe('dev');
    expect((await f.call('/api/dev/status', { token: 'admin-session' })).body).toEqual({ unlocked: true });
    expect((await f.call('/api/plan', { token: 'admin-session' })).body.developer).toBe(true);
    expect((await f.call('/api/dev/status', { token: 'member-session' })).body).toEqual({ unlocked: false });
    expect((await f.call('/api/plan', { token: 'member-session' })).body.developer).toBe(false);
  });
  it('returns moved for code unlocks regardless of repeated attempts', async () => {
    const f = await boot();
    for (let i = 0; i < 7; i++) for (const path of ['/api/account/dev', '/api/dev/unlock']) {
      expect(await f.call(path, { body: { code: 'obsolete' } })).toMatchObject({ status: 410, body: { error: 'moved' } });
    }
    expect(f.api).not.toHaveBeenCalled();
  });
  it('never installs or clears an admin key over the LAN', async () => {
    const f = await boot(true);
    expect((await f.install()).status).toBe(403);
    expect(f.accounts.hasAdminKey()).toBe(false);
  });
  it('saves every signed-in user RD key on the service and never creates a device token file', async () => {
    const f = await boot(); f.member.status = 'active';
    expect((await f.call('/api/rd/token', { method: 'PUT', token: 'member-session', body: { token: 'fixture-rd-secret' } })).body.source).toBe('account');
    expect(f.rd.get(f.member.id)).toBe('fixture-rd-secret');
    expect((await f.call('/api/rd/token', { method: 'PUT', token: 'admin-session', body: { token: 'owner-rd-secret' } })).status).toBe(200);
    expect(f.rd.get(f.owner.id)).toBe('owner-rd-secret');
    expect((await f.call('/api/rd/token', { method: 'PUT', body: { token: 'anonymous-key' } })).status).toBe(401);
    expect((await f.call('/api/rd/token', { method: 'PUT', token: 'member-session', body: { token: '' } })).body.source).toBeNull();
    expect(await readdir(join(f.dataDir, 'secrets')).catch(() => [])).not.toContain('rd-token');
  });
  it('preserves service rate limits and hides upstream response text', async () => {
    const f = await boot();
    f.api.mockResolvedValueOnce(new Response('{"error":"secret diagnostic"}', { status: 429, headers: { 'retry-after': '900' } }));
    const result = await f.call('/api/account/signin', { body: { email: f.member.email, password: 'wrong' } });
    expect(result.status).toBe(429); expect(result.headers.get('retry-after')).toBe('900');
    expect(result.body).toEqual({ error: 'rate_limited' });
  });
  it('uses the remote cached token in the real RD provider, including after rotation and clear', async () => {
    const realFetch = globalThis.fetch;
    const rdTokens: Array<string | null> = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).startsWith('https://api.real-debrid.com/')) {
        rdTokens.push(new Headers(init?.headers).get('authorization'));
        return Response.json({ username: 'Ada', premium: 1 });
      }
      return realFetch(input, init);
    }));
    const f = await boot(false, true); f.member.status = 'active'; f.member.hasRdToken = true;
    f.rd.set(f.member.id, 'remote-rd-first');
    expect((await f.call('/api/rd/status', { token: 'member-session' })).body)
      .toMatchObject({ configured: true, username: 'Ada', source: 'account' });
    expect((await f.call('/api/rd/configured', { token: 'member-session' })).body).toEqual({ configured: true });
    await f.call('/api/rd/token', { method: 'PUT', token: 'member-session', body: { token: 'remote-rd-next' } });
    expect(rdTokens).toEqual(['Bearer remote-rd-first', 'Bearer remote-rd-next']);
    expect((await f.call('/api/rd/token', { method: 'PUT', token: 'member-session', body: { token: '' } })).body)
      .toMatchObject({ configured: false, source: null });
    expect((await f.call('/api/rd/status')).body).toMatchObject({ configured: false, source: null });
  });
  it('uses remote sessions for Hub identity and refuses to mint a local delegated session', async () => {
    const f = await boot();
    expect((await f.call('/api/hub/v1/overview', { token: 'member-session' })).body)
      .toMatchObject({ account: { id: f.member.id, role: 'member' } });
    const paired = await f.call('/api/hub/v1/pair/start', { body: {
      clientId: 'test-remote-client', platform: 'roku', name: 'Living room', appVersion: '1.0', capabilities: [],
    } });
    expect(paired.status).toBe(200);
    const approved = await f.call('/api/hub/v1/pair/approve', { token: 'admin-session', body: { userCode: paired.body.userCode } });
    expect(approved).toMatchObject({ status: 503, body: { error: 'remote_pairing_unavailable' } });
  });
  it('forwards optional inviteCode on registration and surfaces invalid_invite cleanly', async () => {
    const f = await boot();
    const bad = await f.call('/api/account/register', { body: { email: 'x@example.com', password: 'test-password', inviteCode: 'BAD-CODE' } });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'invalid_invite' });
    const ok = await f.call('/api/account/register', { body: { email: 'x@example.com', password: 'test-password', inviteCode: ' GOOD-CODE ' } });
    expect(ok.status).toBe(200);
    const registerCalls = f.api.mock.calls.filter(([url]) => String(url).endsWith('/v1/register'));
    expect(JSON.parse(String(registerCalls.at(-1)?.[1]?.body))).toMatchObject({ inviteCode: 'GOOD-CODE' });
  });
  it('returns moved for local email codes and lets remote admin verification drive account state', async () => {
    const f = await boot();
    for (const path of ['/api/account/email/send', '/api/account/email/verify']) {
      expect(await f.call(path, { token: 'member-session', body: {} })).toMatchObject({ status: 410, body: { error: 'moved' } });
    }
    expect((await f.call('/api/account', { token: 'member-session' })).body).toMatchObject({ canSendEmail: false, account: { emailVerified: false, emailCodeSent: false } });
  });
});
