import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoreServer } from './server.ts';
import { createAccountsService } from './providers/accounts.ts';
import { createPlanService } from './providers/plans.ts';
import { createFeatureFlags } from './providers/featureFlags.ts';
import { createQuoteService, type Quote } from './providers/quotes.ts';
import { createPaymentService } from './providers/payments.ts';
import type { LiveService } from './providers/live.ts';
import { resetServerSideLive } from './Server Side Live/routes.ts';
import { entitlementPath } from './update/paths.ts';
import { writeSealed } from './providers/vault.ts';
import { TERMS_VERSION } from './providers/terms.ts';
import { PRICE_BOOKS } from './providers/priceBook.ts';

vi.mock('./providers/secureFile.ts', async original => ({ ...await original<typeof import('./providers/secureFile.ts')>(), windowsProtect: (value: string) => value }));
const dirs: string[] = []; const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  resetServerSideLive();
  dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
});
async function boot(lan = false) {
  const dataDir = mkdtempSync(join(tmpdir(), 'tvm-pricing-http-')); dirs.push(dataDir);
  const env = { TVM_LAN_TOKEN: 't'.repeat(32), TVM_LIVE_TV_ONLINE: '1', TVM_PRICE_TEST_BASE_MONTH: 'price_private' };
  const accounts = createAccountsService({ dataDir, termsVersion: TERMS_VERSION });
  const member = accounts.register({ email: 'viewer@example.com', password: 'correct horse battery' });
  const signed = accounts.signIn({ email: member.email, password: 'correct horse battery' });
  const dev = accounts.signInDev();
  const plans = createPlanService({ dataDir, env });
  const flags = createFeatureFlags({ dataDir, env });
  const payments = createPaymentService({ dataDir, env, plans: { quote: plans.quote, grant: vi.fn(), revoke: vi.fn() } });
  const charge = vi.spyOn(payments, 'begin');
  const live = {
    catalog: vi.fn(async () => ({ items: [], total: 0 })),
    play: vi.fn(async () => ({ kind: 'stream', url: '/api/live/stream/channel' })),
    proxyChannel: vi.fn(async () => ({ kind: 'playlist', body: '#EXTM3U\n' })),
    proxyHop: vi.fn(async () => ({ kind: 'playlist', body: '#EXTM3U\n' })),
    setPlaylist: vi.fn(async () => ({ configured: true })),
    setXtream: vi.fn(async () => ({ configured: true })),
    clearXtream: vi.fn(async () => ({ configured: false })),
    checkChannels: vi.fn(async () => ({ checked: 0 })),
  };
  const server = createCoreServer({ dataDir, env, accounts, plans, payments, live: live as unknown as LiveService });
  if (lan) server.prependListener('connection', socket => Object.defineProperty(socket, 'remoteAddress', { value: '192.168.1.50' }));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, options: { token?: string; body?: unknown; method?: string } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: { ...(lan ? { authorization: `Bearer ${env.TVM_LAN_TOKEN}` } : {}),
        ...(options.token ? { 'x-tvm-account': options.token } : {}),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: (text.startsWith('{') ? JSON.parse(text) : { text }) as Record<string, any> };
  };
  return { dataDir, env, accounts, member, signed, dev, plans, flags, charge, live, call };
}

describe('pricing and flags HTTP contract', () => {
  it('exposes the public book on the LAN with safe defaults and no provider IDs', async () => {
    const f = await boot(true);
    const result = await f.call('/api/pricing/book');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ book: { version: 1, currency: 'GBP' }, flags: { liveTvVisible: true, liveTvOrderable: false, selfServeBilling: false } });
    expect(JSON.stringify(result.body)).not.toMatch(/price_private|providerPrice/);
    const tiers = await f.call('/api/tiers');
    expect(tiers.body.tiers[1]).toMatchObject({ liveTvMonthlyPence: 700, liveTvYearlyPence: 6000, availability: 'Coming soon', liveTvTerms: [] });
    expect(JSON.stringify(tiers.body)).not.toMatch(/quarter|lifetime|9\.99/);
    const billing = await f.call('/api/billing');
    expect(billing.status).toBe(403);
    expect(billing.body.error).toBe('local_access_required');
  });
  it('requires accounts for quote and acceptance and enforces Live TV orderability', async () => {
    const f = await boot();
    for (const path of ['/api/pricing/quote', '/api/pricing/accept']) {
      expect((await f.call(path, { body: {} })).status).toBe(401);
    }
    const result = await f.call('/api/pricing/quote', { token: f.signed.token, body: { cadence: 'month', liveTv: true } });
    expect(result).toMatchObject({ status: 409, body: { error: 'live_tv_not_orderable' } });
    expect((await f.call('/api/pricing/quote', { token: f.signed.token, body: { cadence: 'quarter', liveTv: false } })).status).toBe(400);
  });
  it('allows only a signed-in dev to read or update flags, including on the LAN', async () => {
    const f = await boot(true);
    for (const token of [undefined, f.signed.token]) {
      expect((await f.call('/api/admin/flags', { token })).status).toBe(403);
      expect((await f.call('/api/admin/flags', { token, method: 'PUT', body: { 'liveTv.orderable': true } })).status).toBe(403);
    }
    expect((await f.call('/api/admin/flags', { token: f.dev.token })).status).toBe(200);
    expect((await f.call('/api/admin/flags', { token: f.dev.token, method: 'PUT', body: { 'liveTv.orderable': true } })).status).toBe(200);
    expect((await f.call('/api/pricing/quote', { token: f.signed.token, body: { cadence: 'year', liveTv: true } })).body.totalPence).toBe(15000);
    expect((await f.call('/api/admin/flags', { token: f.dev.token, method: 'PUT', body: { selfServeBilling: 'yes' } })).status).toBe(400);
    await f.call('/api/admin/flags', { token: f.dev.token, method: 'PUT', body: { 'liveTv.visible': false, 'liveTv.healthy': false } });
    expect((await f.call('/api/tiers')).body.tiers.map((tier: { id: string }) => tier.id)).toEqual(['stream']);
    expect((await f.call('/api/pricing/quote', { token: f.signed.token, body: { cadence: 'year', liveTv: true } })).body.totalPence).toBe(15000);
  });
  it('records manual acceptance without charging or activating, and returns fresh quotes on tamper', async () => {
    const f = await boot();
    const issued = await f.call('/api/pricing/quote', { token: f.signed.token, body: { cadence: 'year', liveTv: false } });
    expect(issued.status).toBe(200);
    const quote = issued.body as Quote;
    const before = f.plans.status();
    const entitlementBefore = existsSync(entitlementPath(f.dataDir)) ? readFileSync(entitlementPath(f.dataDir), 'utf8') : null;
    const accepted = await f.call('/api/pricing/accept', { token: f.signed.token, body: { quote } });
    expect(accepted).toMatchObject({ status: 200, body: { status: 'manual_activation', message: expect.stringMatching(/owner/) } });
    expect((await f.call('/api/pricing/accept', { token: f.signed.token, body: { quote } })).status).toBe(200);
    expect(f.charge).not.toHaveBeenCalled();
    expect(f.accounts.resolve(f.signed.token)?.activated).toBe(false);
    expect(f.plans.status()).toEqual(before);
    if (entitlementBefore !== null) expect(readFileSync(entitlementPath(f.dataDir), 'utf8')).toBe(entitlementBefore);
    const ledger = createQuoteService({ dataDir: f.dataDir, flags: f.flags.get }).accepted();
    expect(ledger).toHaveLength(1); expect(ledger[0]?.quote).toEqual(quote);
    for (const name of ['billing', 'payments', 'subscriptions']) expect(existsSync(join(f.dataDir, 'secrets', `${name}.enc`))).toBe(false);
    const tampered = await f.call('/api/pricing/accept', { token: f.signed.token, body: { quote: { ...quote, totalPence: 1 } } });
    expect(tampered).toMatchObject({ status: 409, body: { error: 'quote_invalid', quote: { totalPence: 9000 } } });
    expect((await f.call('/api/pricing/accept', { token: f.dev.token, body: { quote } })).body.error).toBe('quote_invalid');
  });
  it('returns 409 and a current quote for expired and stale signed quotes', async () => {
    const f = await boot();
    const expired = createQuoteService({ dataDir: f.dataDir, flags: f.flags.get, now: () => new Date(Date.now() - 16 * 60_000) })
      .quote({ cadence: 'month', liveTv: false }, f.member.id);
    expect(await f.call('/api/pricing/accept', { token: f.signed.token, body: { quote: expired } }))
      .toMatchObject({ status: 409, body: { error: 'quote_expired', quote: { totalPence: 1000 } } });
    const stale = createQuoteService({ dataDir: f.dataDir, flags: f.flags.get, books: [{ ...PRICE_BOOKS[0]!, version: 0 }] })
      .quote({ cadence: 'year', liveTv: false }, f.member.id);
    expect(await f.call('/api/pricing/accept', { token: f.signed.token, body: { quote: stale } }))
      .toMatchObject({ status: 409, body: { error: 'price_changed', quote: { priceBookVersion: 1, totalPence: 9000 } } });
  });
});

const contentPaths = ['/api/live/catalog', '/api/live/stream/channel', '/api/live/hop/token', '/api/live/sources', `/api/live/proxy/${'a'.repeat(32)}`];
describe('Live TV server enforcement', () => {
  it('refuses all live playback and proxy boundaries without a grant, even if a dev is signed in elsewhere', async () => {
    const f = await boot();
    for (const path of contentPaths) expect(await f.call(path)).toMatchObject({ status: 403, body: { error: 'live_tv_not_entitled' } });
    expect(await f.call('/api/playback', { body: { id: 'live:channel' } })).toMatchObject({ status: 403, body: { error: 'live_tv_not_entitled' } });
    expect((await f.call('/api/live/stream/channel', { method: 'HEAD' })).status).toBe(403);
    expect((await f.call('/api/live/hop/token', { method: 'OPTIONS' })).status).toBe(403);
    expect(f.live.play).not.toHaveBeenCalled(); expect(f.live.proxyChannel).not.toHaveBeenCalled();
  });
  it('honors grants on LAN while hidden and unorderable, and rechecks segment access after outage or removal', async () => {
    const f = await boot(true);
    f.plans.grantLiveTv(true); f.flags.set({ 'liveTv.visible': false });
    for (const path of contentPaths.slice(0, 4)) expect((await f.call(path)).status).toBe(200);
    expect((await f.call(contentPaths[4]!)).status).toBe(404); // gate passed, unknown reflector token
    expect((await f.call('/api/playback', { body: { id: 'live:channel' } })).status).toBe(200);
    const before = readFileSync(entitlementPath(f.dataDir), 'utf8');
    f.flags.set({ 'liveTv.healthy': false });
    for (const path of contentPaths) expect(await f.call(path)).toMatchObject({ status: 503, body: { error: 'live_tv_unavailable', message: expect.any(String) } });
    expect(await f.call('/api/playback', { body: { id: 'live:channel' } })).toMatchObject({ status: 503, body: { error: 'live_tv_unavailable' } });
    expect(f.plans.status()).toMatchObject({ liveTv: true, liveTvHealthy: false });
    expect(readFileSync(entitlementPath(f.dataDir), 'utf8')).toBe(before);
    f.flags.set({ 'liveTv.healthy': true }); f.plans.grantLiveTv(false);
    expect((await f.call('/api/live/hop/token')).status).toBe(403);
  });
  it('honors dev callers but still reports provider outages to them', async () => {
    const f = await boot();
    expect((await f.call('/api/live/catalog', { token: f.dev.token })).status).toBe(200);
    f.flags.set({ 'liveTv.healthy': false });
    expect((await f.call('/api/live/catalog', { token: f.dev.token })).status).toBe(503);
    expect((await f.call('/api/live/catalog', { token: f.signed.token })).status).toBe(403);
  });
  it('does not reactivate expired legacy grants when the owning account refreshes', async () => {
    const f = await boot();
    f.accounts.activate({ id: f.member.id, tier: 'stream-live' }); f.accounts.acceptTerms(f.member.id);
    writeSealed(f.dataDir, entitlementPath(f.dataDir), { id: 'premium', styleId: 'classic', source: 'checkout', overrides: {}, liveTvAddon: true, liveTvTerm: 'quarter', liveTvExpiresAt: '2020-01-01' });
    expect((await f.call('/api/account', { token: f.signed.token })).status).toBe(200);
    expect((await f.call('/api/live/catalog', { token: f.signed.token })).status).toBe(403);
    expect(f.plans.status()).toMatchObject({ id: 'max', liveTv: false });
  });
  it('account refresh during an outage leaves the manual grant and base plan unchanged', async () => {
    const f = await boot();
    f.accounts.activate({ id: f.member.id, tier: 'stream-live' }); f.accounts.acceptTerms(f.member.id);
    await f.call('/api/account', { token: f.signed.token });
    const before = readFileSync(entitlementPath(f.dataDir), 'utf8');
    f.flags.set({ 'liveTv.healthy': false });
    await f.call('/api/account', { token: f.signed.token });
    expect(f.plans.status()).toMatchObject({ id: 'max', liveTv: true, liveTvHealthy: false });
    expect(readFileSync(entitlementPath(f.dataDir), 'utf8')).toBe(before);
  });
  it('restricts machine-wide configuration writes to loopback or the requesting dev', async () => {
    const writes = [
      { path: '/api/live', method: 'PUT', body: { text: '#EXTM3U\n' } },
      { path: '/api/live/xtream', method: 'PUT', body: { host: 'https://example.com', username: 'a', password: 'b' } },
      { path: '/api/live/xtream', method: 'DELETE', body: {} }, { path: '/api/live/check', method: 'POST', body: {} },
    ];
    const f = await boot(true);
    for (const write of writes) {
      for (const token of [undefined, f.signed.token]) expect((await f.call(write.path, { ...write, token })).status).toBe(403);
      expect((await f.call(write.path, { ...write, token: f.dev.token })).status).toBe(200);
    }
    expect(f.live.setPlaylist).toHaveBeenCalledTimes(1);
    const local = await boot();
    for (const write of writes) expect((await local.call(write.path, write)).status).toBe(200);
  });
});

describe('sign-in HTTP throttle', () => {
  it('returns 429 rate_limited before another password hash for normalized email and IP windows', async () => {
    const f = await boot();
    const signIn = vi.spyOn(f.accounts, 'signIn').mockImplementation(() => { throw new Error('bad credentials'); });
    for (let i = 0; i < 5; i++) expect((await f.call('/api/account/signin', { body: { email: i % 2 ? ' RATE@example.com ' : 'rate@example.com', password: 'bad' } })).status).toBe(401);
    const limited = await f.call('/api/account/signin', { body: { email: 'rate@example.com', password: 'bad' } });
    expect(limited).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    expect(limited.headers.get('retry-after')).toBe('900'); expect(signIn).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 25; i++) expect((await f.call('/api/account/signin', { body: { email: `other${i}@example.com`, password: 'bad' } })).status).toBe(401);
    expect((await f.call('/api/account/signin', { body: { email: 'different@example.com', password: 'bad' } })).status).toBe(429);
    expect(signIn).toHaveBeenCalledTimes(30);
  });
});
