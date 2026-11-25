import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNTS_URL, resolveAccountsUrl } from '../config.ts';
import { runForSession } from '../requestContext.ts';
import { createRemoteAccountsService } from './remoteAccounts.ts';
import { mockAccountsApi } from './remoteAccountsTestSupport.ts';
import { TERMS_VERSION } from './terms.ts';
import { readSealed } from './vault.ts';
import { createRealDebrid } from './realdebrid.ts';
import { writeSecret } from './secrets.ts';
import { rdTokenPath } from '../update/paths.ts';

vi.mock('./secureFile.ts', async original => ({ ...await original<typeof import('./secureFile.ts')>(), windowsProtect: (value: string) => value }));
const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })); });
function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'tvm-remote-')); dirs.push(dataDir);
  const mock = mockAccountsApi();
  let time = 0;
  const options = { dataDir, termsVersion: TERMS_VERSION, env: {}, fetch: mock.api, now: () => time };
  const accounts = createRemoteAccountsService(options);
  return { ...mock, accounts, dataDir, options, advance: (ms: number) => { time += ms; } };
}
describe('private accounts provider', () => {
  it('defaults to the deployed HTTPS origin and permits only safe overrides', () => {
    expect(resolveAccountsUrl({})).toBe(ACCOUNTS_URL);
    expect(resolveAccountsUrl({ TVM_ACCOUNTS_URL: 'http://127.0.0.1:8787' })).toBe('http://127.0.0.1:8787');
    for (const url of ['http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com?key=x', 'file:///tmp']) {
      expect(() => resolveAccountsUrl({ TVM_ACCOUNTS_URL: url })).toThrow();
    }
  });
  it('seals sessions per device without persisting accounts, passwords or RD credentials', async () => {
    const f = fixture();
    await f.accounts.signIn({ email: f.member.email, password: 'private-password' });
    expect(readSealed(f.dataDir, join(f.dataDir, 'secrets', 'account-sessions.enc')))
      .toEqual({ origin: ACCOUNTS_URL, tokens: ['member-session'] });
    const raw = readdirSync(join(f.dataDir, 'secrets')).map(name => readFileSync(join(f.dataDir, 'secrets', name), 'utf8')).join('');
    expect(raw).not.toMatch(/member-session|private-password|ada@example/);
    expect(readdirSync(join(f.dataDir, 'secrets'))).not.toContain('accounts.enc');
    expect(await createRemoteAccountsService(f.options).resolve('member-session')).toMatchObject({ id: f.member.id });
    await f.accounts.signOut('member-session');
    expect(await f.accounts.resolve('member-session')).toBeNull();
  });
  it('keeps per-session RD tokens in memory for at most ten minutes, with no stale fallback', async () => {
    const f = fixture(); f.member.status = 'active'; f.member.hasRdToken = true;
    f.rd.set(f.member.id, 'first-rd'); f.rd.set(f.owner.id, 'owner-rd');
    expect(await f.accounts.rdTokenFor('member-session')).toBe('first-rd');
    expect(await f.accounts.rdTokenFor('admin-session')).toBe('owner-rd');
    f.rd.set(f.member.id, 'rotated-rd'); f.advance(599_999);
    expect(await f.accounts.rdTokenFor('member-session')).toBe('first-rd');
    expect(f.api.mock.calls.filter(([url]) => String(url).endsWith('/rd-token'))).toHaveLength(2);
    f.advance(1);
    expect(f.accounts.cachedRdTokenFor('member-session')).toBeNull();
    expect(await f.accounts.rdTokenFor('member-session')).toBe('rotated-rd');
    expect(createRemoteAccountsService(f.options).cachedRdTokenFor('member-session')).toBeNull();
    f.advance(600_000); f.api.mockRejectedValueOnce(new Error('secret upstream URL'));
    await expect(f.accounts.rdTokenFor('member-session')).rejects.toMatchObject({ status: 503, message: 'accounts_unavailable' });
    expect(f.accounts.cachedRdTokenFor('member-session')).toBeNull();
  });
  it('invalidates cached tokens after own changes, admin changes, revocation and signout', async () => {
    const f = fixture(); f.member.status = 'active'; f.member.hasRdToken = true; f.rd.set(f.member.id, 'first');
    await f.accounts.rdTokenFor('member-session');
    await runForSession('member-session', () => f.accounts.setOwnRdToken('second'));
    expect(f.accounts.cachedRdTokenFor('member-session')).toBeNull();
    expect(await f.accounts.rdTokenFor('member-session')).toBe('second');
    f.accounts.installAdminKey('fixture-admin-key');
    await runForSession('admin-session', () => f.accounts.setRdToken(f.member.id, 'third'));
    expect(f.accounts.cachedRdTokenFor('member-session')).toBeNull();
    await f.accounts.rdTokenFor('member-session'); f.sessions.delete('member-session');
    expect(await f.accounts.resolve('member-session')).toBeNull();
    expect(f.accounts.cachedRdTokenFor('member-session')).toBeNull();
    await f.accounts.rdTokenFor('admin-session'); await f.accounts.signOut('admin-session');
    expect(f.accounts.cachedRdTokenFor('admin-session')).toBeNull();
  });
  it('requires both credentials even when the provider is used directly, and binds stored keys to the service', async () => {
    const f = fixture();
    await expect(runForSession('admin-session', () => f.accounts.list())).rejects.toMatchObject({ status: 403 });
    f.accounts.installAdminKey('fixture-admin-key');
    await expect(runForSession('member-session', () => f.accounts.summary())).rejects.toMatchObject({ status: 403 });
    expect(createRemoteAccountsService(f.options).hasAdminKey()).toBe(true);
    const other = createRemoteAccountsService({ ...f.options, env: { TVM_ACCOUNTS_URL: 'https://other.example' } });
    expect(other.hasAdminKey()).toBe(false);
    expect(await runForSession('admin-session', () => f.accounts.summary())).toMatchObject({ total: 2 });
    f.accounts.installAdminKey(''); expect(f.accounts.hasAdminKey()).toBe(false);
  });
  it('follows admin pagination and projects only the established safe fields', async () => {
    const f = fixture(); f.accounts.installAdminKey('fixture-admin-key');
    const original = f.api.getMockImplementation()!;
    f.api.mockImplementation(async (url, init) => {
      if (String(url).includes('/v1/admin/accounts?')) {
        const offset = new URL(String(url)).searchParams.get('offset');
        return Response.json({ accounts: [{ ...(offset === '0' ? f.member : f.owner), passwordHash: 'never expose', token: 'never expose' }], nextOffset: offset === '0' ? 200 : null });
      }
      return original(url, init);
    });
    const list = await runForSession('admin-session', () => f.accounts.list({ state: 'waiting', search: 'Ada & Grace' }));
    expect(list).toHaveLength(2);
    expect(list[1]?.role).toBe('dev'); expect(JSON.stringify(list)).not.toContain('never expose');
    const urls = f.api.mock.calls.map(([url]) => new URL(String(url))).filter(url => url.pathname === '/v1/admin/accounts');
    expect(urls.map(url => url.searchParams.get('offset'))).toEqual(['0', '200']);
    expect(urls[0]?.searchParams.get('search')).toBe('Ada & Grace');
  });
  it('never redirects bearer credentials and sanitizes service failures', async () => {
    const f = fixture(); f.api.mockRejectedValueOnce(new Error('private diagnostic'));
    await expect(f.accounts.resolve('member-session')).rejects.toMatchObject({ status: 503, message: 'accounts_unavailable' });
    expect(f.api.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  });
  it('does not use old device or environment RD secrets with an account provider', async () => {
    const f = fixture(); writeSecret(rdTokenPath(f.dataDir), 'old-device-key');
    const rd = createRealDebrid({ dataDir: f.dataDir, env: { TVM_RD_TOKEN: 'old-env-key' }, accountToken: () => null });
    expect(rd.configured()).toBe(false); expect(rd.tokenValue()).toBeNull();
    expect(await rd.status()).toMatchObject({ configured: false });
  });
});
