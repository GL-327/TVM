import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CORE_HOST } from './config.ts';
import { createAccountsService } from './providers/accounts.ts';
import type { DevUnlockService } from './providers/devUnlock.ts';
import { createMailService, type MailMessage } from './providers/mail.ts';
import { TERMS_VERSION } from './providers/terms.ts';
import { liveRelayRefused, startCoreServer, type RunningCore } from './server.ts';

/** The real developer code is not in the repository, so tests use a stand-in. */
function fakeDeveloper(): DevUnlockService & { on: () => boolean } {
  let on = false;
  return {
    on: () => on,
    unlocked: () => on,
    unlock: (code: string) => {
      if (code !== 'test-dev-code') return false;
      on = true;
      return true;
    },
    grant: () => { on = true; },
    lock: () => { on = false; },
  };
}

const running: RunningCore[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((core) => core.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function boot(options: { mail?: boolean } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'tvm-account-routes-'));
  dirs.push(dataDir);
  const developer = fakeDeveloper();
  const outbox: MailMessage[] = [];
  const mail = createMailService({ dataDir, send: async (_settings, message) => { outbox.push(message); } });
  if (options.mail === true) {
    mail.save({ host: 'smtp.example.com', port: 587, security: 'starttls', username: 'tvm@example.com', password: 'secret-pass', from: 'tvm@example.com' });
  }
  const accounts = createAccountsService({ dataDir, termsVersion: TERMS_VERSION, emailRequired: () => mail.configured() });
  const core = await startCoreServer(0, { dataDir, env: {}, developer, mail, accounts });
  running.push(core);
  const base = `http://${CORE_HOST}:${core.port}`;

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.token !== undefined) headers['authorization'] = `Bearer ${init.token}`;
    const response = await fetch(`${base}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };

  const member = async (email = 'ada@example.com') => {
    await call('/api/account/register', { body: { email, password: 'correct horse battery' } });
    const signed = await call('/api/account/signin', { body: { email, password: 'correct horse battery' } });
    return signed.body['token'] as string;
  };

  return { call, member, developer, outbox, accounts };
}

describe('the dev account over HTTP', () => {
  it('refuses a wrong code', async () => {
    const { call, developer } = await boot();
    const refused = await call('/api/account/dev', { body: { code: 'nope' } });
    expect(refused.status).toBe(403);
    expect(refused.body['error']).toBe('That code is not valid.');
    expect(developer.on()).toBe(false);
  });

  it('signs in with the code, turns dev mode on, and turns it off again on sign-out', async () => {
    const { call, developer } = await boot();
    const signed = await call('/api/account/dev', { body: { code: 'test-dev-code' } });
    expect(signed.status).toBe(200);
    expect(signed.body['account']).toMatchObject({ role: 'dev', displayName: 'Dev' });
    expect(developer.on()).toBe(true);

    const token = signed.body['token'] as string;
    const me = await call('/api/account', { token });
    expect(me.body).toMatchObject({ signedIn: true, usable: { ok: true, reason: null }, account: { role: 'dev', tier: 'stream-live' } });
    expect(me.body['account']).not.toHaveProperty('passwordHash');

    // Something switched dev mode off; the dev account turns it back on.
    developer.lock();
    await call('/api/account', { token });
    expect(developer.on()).toBe(true);

    await call('/api/account/signout', { method: 'POST', token });
    expect(developer.on()).toBe(false);
    expect((await call('/api/account', { token })).body['signedIn']).toBe(false);
  });

  it('keeps dev mode on while another dev session is still open', async () => {
    const { call, developer } = await boot();
    const first = (await call('/api/account/dev', { body: { code: 'test-dev-code' } })).body['token'] as string;
    await call('/api/account/dev', { body: { code: 'test-dev-code' } });
    await call('/api/account/signout', { method: 'POST', token: first });
    expect(developer.on()).toBe(true);
  });
});

describe('dev mode belongs to the dev account, not the machine', () => {
  it('refuses the Accounts screen to everyone else while the dev is signed in', async () => {
    const { call, member, developer } = await boot();
    const token = await member();
    const dev = (await call('/api/account/dev', { body: { code: 'test-dev-code' } })).body['token'] as string;
    expect(developer.on()).toBe(true);

    const listed = await call('/api/admin/accounts', { token: dev });
    expect(listed.status).toBe(200);
    const id = (listed.body['accounts'] as Array<{ id: string }>)[0]!.id;

    expect((await call('/api/admin/accounts', { token })).status).toBe(403);
    expect((await call('/api/admin/accounts')).status).toBe(403);
    expect((await call('/api/admin/accounts/activate', { token, body: { id, tier: 'stream-live' } })).status).toBe(403);
    expect((await call('/api/admin/accounts/rd', { token, body: { id, token: 'RDKEY' } })).status).toBe(403);
    expect((await call('/api/plan', { method: 'PUT', token, body: { id: 'max' } })).status).toBe(403);

    // Nobody else is told dev mode is on, so nobody else is shown the screen.
    expect((await call('/api/plan', { token })).body['developer']).toBe(false);
    expect((await call('/api/plan', { token: dev })).body['developer']).toBe(true);
    expect((await call('/api/dev/status', { token })).body['unlocked']).toBe(false);
    expect((await call('/api/dev/status', { token: dev })).body['unlocked']).toBe(true);
  });

  it('turns dev mode back on for the dev account if something switched it off', async () => {
    const { call, developer } = await boot();
    const dev = (await call('/api/account/dev', { body: { code: 'test-dev-code' } })).body['token'] as string;
    developer.lock();
    expect((await call('/api/admin/accounts', { token: dev })).status).toBe(200);
    expect(developer.on()).toBe(true);
  });
});

describe('email codes over HTTP', () => {
  it('sends a code on sign-up and holds the account until it is typed in', async () => {
    const { call, member, outbox } = await boot({ mail: true });
    const token = await member();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe('ada@example.com');
    const code = /(\d{6})/.exec(outbox[0]!.subject)![1]!;

    const before = await call('/api/account', { token });
    expect(before.body).toMatchObject({ canSendEmail: true, usable: { reason: 'email_unverified' }, account: { emailCodeSent: true, emailVerified: false } });

    const wrong = await call('/api/account/email/verify', { token, body: { code: code === '000000' ? '111111' : '000000' } });
    expect(wrong.status).toBe(400);

    const right = await call('/api/account/email/verify', { token, body: { code } });
    expect(right.status).toBe(200);
    expect(right.body['emailVerified']).toBe(true);
    expect((await call('/api/account', { token })).body['usable']).toEqual({ ok: false, reason: 'awaiting_activation' });
  });

  it('makes you wait before sending another', async () => {
    const { call, member } = await boot({ mail: true });
    const token = await member();
    const again = await call('/api/account/email/send', { method: 'POST', token });
    expect(again.status).toBe(429);
    expect(again.body['error']).toMatch(/Wait \d+ seconds/);
  });

  it('does not ask for a code when this machine cannot send one', async () => {
    const { call, member, outbox } = await boot();
    const token = await member();
    expect(outbox).toHaveLength(0);
    const me = await call('/api/account', { token });
    expect(me.body).toMatchObject({ canSendEmail: false, usable: { reason: 'awaiting_activation' } });
    expect((await call('/api/account/email/send', { method: 'POST', token })).status).toBe(503);
  });
});

describe('what the dev sets per account', () => {
  it('needs dev mode', async () => {
    const { call, member } = await boot();
    await member();
    for (const path of ['/api/admin/accounts/live-tv', '/api/admin/accounts/rd', '/api/admin/accounts/verify', '/api/admin/mail/test']) {
      expect((await call(path, { body: { id: 'x' } })).status).toBe(403);
    }
    expect((await call('/api/admin/mail')).status).toBe(403);
  });

  it('switches Live TV, saves a Real-Debrid key and marks an address verified', async () => {
    const { call, member } = await boot({ mail: true });
    const token = await member();
    const dev = (await call('/api/account/dev', { body: { code: 'test-dev-code' } })).body['token'] as string;
    const listed = await call('/api/admin/accounts', { token: dev });
    const id = (listed.body['accounts'] as Array<{ id: string }>)[0]!.id;
    expect(listed.body['accounts']).toHaveLength(1);

    await call('/api/admin/accounts/activate', { token: dev, body: { id, tier: 'stream' } });
    const live = await call('/api/admin/accounts/live-tv', { token: dev, body: { id, enabled: true } });
    expect(live.body['tier']).toBe('stream-live');

    const key = await call('/api/admin/accounts/rd', { token: dev, body: { id, token: 'RDKEY0000000000000000000000WXYZ' } });
    expect(key.body).toMatchObject({ rdKey: true, rdKeyHint: '••••WXYZ' });
    expect(JSON.stringify(key.body)).not.toContain('RDKEY0000');

    const verified = await call('/api/admin/accounts/verify', { token: dev, body: { id, verified: true } });
    expect(verified.body['emailVerified']).toBe(true);

    const me = await call('/api/account', { token });
    expect(me.body['account']).toMatchObject({ tier: 'stream-live', rdKey: true, emailVerified: true });
    expect(me.body['usable']).toEqual({ ok: false, reason: 'terms_required' });
  });

  it('saves a member key to their own account from the Real-Debrid screen', async () => {
    const { call, member, accounts } = await boot();
    const token = await member();
    const saved = await call('/api/rd/token', { method: 'PUT', token, body: { token: '' } });
    expect(saved.status).toBe(200);
    expect(saved.body['source']).toBeNull();
    const id = accounts.list()[0]!.id;
    accounts.setRdToken(id, 'RDKEYFORADA');
    expect(accounts.rdTokenFor(token)).toBe('RDKEYFORADA');
    const cleared = await call('/api/rd/token', { method: 'PUT', token, body: { token: '' } });
    expect(cleared.body['source']).toBeNull();
    expect(accounts.rdTokenFor(token)).toBeNull();
  });

  it('keeps mail settings to itself', async () => {
    const { call } = await boot({ mail: true });
    const dev = (await call('/api/account/dev', { body: { code: 'test-dev-code' } })).body['token'] as string;
    const status = await call('/api/admin/mail', { token: dev });
    expect(status.body).toMatchObject({ configured: true, host: 'smtp.example.com', supported: true });
    expect(JSON.stringify(status.body)).not.toContain('secret-pass');
    const test = await call('/api/admin/mail/test', { token: dev, body: { to: 'me@example.com' } });
    expect(test.status).toBe(200);
  });
});

describe('who may relay live TV', () => {
  it('serves other devices only while the dev account is signed in', () => {
    const lan = '192.168.1.40';
    expect(liveRelayRefused('/api/live/proxy/0123456789abcdef0123456789abcdef', lan, () => false)).toBe(true);
    expect(liveRelayRefused('/api/live/stream/live%3A1', lan, () => false)).toBe(true);
    expect(liveRelayRefused('/api/live/hop/abc', lan, () => false)).toBe(true);
    expect(liveRelayRefused('/api/live/sources', lan, () => false)).toBe(true);
    expect(liveRelayRefused('/api/live/proxy/0123456789abcdef0123456789abcdef', lan, () => true)).toBe(false);
  });

  it('never refuses this machine, or routes that do not relay', () => {
    expect(liveRelayRefused('/api/live/proxy/0123456789abcdef0123456789abcdef', '127.0.0.1', () => false)).toBe(false);
    expect(liveRelayRefused('/api/live/proxy/0123456789abcdef0123456789abcdef', '::ffff:127.0.0.1', () => false)).toBe(false);
    expect(liveRelayRefused('/api/live/catalog', '192.168.1.40', () => false)).toBe(false);
    expect(liveRelayRefused('/api/home', '192.168.1.40', () => false)).toBe(false);
  });
});
