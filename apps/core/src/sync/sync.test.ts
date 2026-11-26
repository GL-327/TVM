import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writePrefs, readPrefs, readSyncPrefs } from '../prefs.ts';
import { runForSession, setSyncDirectory } from '../requestContext.ts';
import { AccountsError, createRemoteAccountsService } from '../providers/remoteAccounts.ts';
import { TERMS_VERSION } from '../providers/terms.ts';
import { createProfileService, loadProfiles, makePin } from '../providers/profiles.ts';
import { readProgress, removeContinueWatching, setWatched, writeProgress } from '../providers/progress.ts';
import { addWatchlist, readWatchlist, removeWatchlist } from '../providers/watchlist.ts';
import { createCoreServer } from '../server.ts';
import { prefsPath, profileDir } from '../update/paths.ts';
import { createSyncEngine, SYNC_DISABLED, type SyncTransport } from './engine.ts';
import { mergeRemote, observeLocal, type SyncLedger } from './merge.ts';
import type { SyncItem } from './schema.ts';
import { initializeStores, itemId, valueHash, type SnapshotItem } from './stores.ts';
import { createAccountSync } from './accounts.ts';
import type { PublicAccount } from '../providers/accounts.ts';

vi.mock('../providers/secureFile.ts', async original => ({
  ...await original<typeof import('../providers/secureFile.ts')>(), windowsProtect: (value: string) => value,
}));

function pref(key: string, value: unknown, updatedAt: number, deleted = false): SyncItem {
  return { kind: 'preference', key, value, updatedAt, deleted };
}
function projected(...items: SyncItem[]): Map<string, SnapshotItem> {
  return new Map(items.map(item => [itemId(item), { item, hash: valueHash(item.value), changedAt: item.updatedAt }]));
}

describe('item merge', () => {
  it('merges disjoint local/remote items and uses the newest stamp per item', () => {
    const ledger: SyncLedger = { versions: {}, pending: {} };
    const local = pref('extras.ratings', false, 20);
    const alsoLocal = pref('extras.trailers', false, 30);
    const remote = pref('extras.collections', false, 10);
    observeLocal(ledger, projected(local, alsoLocal), 30);
    expect(mergeRemote(ledger, [remote, pref(local.key, true, 19), pref(alsoLocal.key, true, 31)])).toEqual([
      remote, pref(alsoLocal.key, true, 31),
    ]);
    expect(Object.values(ledger.pending)).toEqual([local]);
    expect(ledger.versions[itemId(alsoLocal)]?.updatedAt).toBe(31);
  });

  it('uses the server winner on ties and never acknowledges a newer local edit with an older remote item', () => {
    const ledger: SyncLedger = { versions: {}, pending: {} };
    const local = pref('autoplayNext', true, 20);
    observeLocal(ledger, projected(local), 20);
    expect(mergeRemote(ledger, [pref(local.key, false, 20)])).toEqual([pref(local.key, false, 20)]);
    expect(Object.values(ledger.pending)).toEqual([]);
    observeLocal(ledger, projected(local), 20);
    expect(Object.values(ledger.pending)).toEqual([pref(local.key, true, 21)]);
    expect(mergeRemote(ledger, [pref(local.key, false, 20)])).toEqual([]);
  });

  it('retains item tombstones and only recreates an item on a newer write', () => {
    const ledger: SyncLedger = { versions: {}, pending: {} };
    const item = pref('extras.announcements', false, 10);
    const deleted = pref(item.key, null, 11, true);
    observeLocal(ledger, projected(item), 10);
    observeLocal(ledger, projected(), 11);
    expect(Object.values(ledger.pending)).toEqual([deleted]);
    expect(mergeRemote(ledger, [item])).toEqual([]);
    expect(mergeRemote(ledger, [deleted])).toEqual([]);
    expect(Object.values(ledger.pending)).toEqual([]);
    expect(mergeRemote(ledger, [{ ...item, updatedAt: 12 }])).toEqual([{ ...item, updatedAt: 12 }]);
  });
});

function service() {
  let clock = 0;
  let generation = '"0"';
  const rows = new Map<string, { item: SyncItem; clock: number }>();
  function write(items: SyncItem[]) {
    clock = Math.max(clock + 1, Date.now());
    for (const item of items) {
      const key = itemId(item);
      const old = rows.get(key)?.item;
      if (!old || old.updatedAt < item.updatedAt) rows.set(key, { item, clock });
    }
  }
  const get = vi.fn<SyncTransport['getSyncPage']>(async (_token, query, match) => {
    if (match !== null && match !== generation) throw new AccountsError(412);
    const since = Number(query.get('since'));
    return { body: { items: [...rows.values()].filter(row => row.clock > since).map(row => structuredClone(row.item)), now: clock },
      generation };
  });
  const put = vi.fn<SyncTransport['putSyncItems']>(async (_token, items, match) => {
    if (match !== generation) throw new AccountsError(412);
    write(structuredClone(items));
  });
  return {
    get, put, write, rows, transport: { getSyncPage: get, putSyncItems: put },
    clear() { rows.clear(); clock++; generation = '"1"'; },
  };
}

const roots: string[] = [];
const cleanup: (() => void)[] = [];
function dir() {
  const result = mkdtempSync(join(tmpdir(), 'tvm-account-sync-'));
  roots.push(result);
  return result;
}
function engine(sync = service(), directory = dir(), legacy?: string) {
  initializeStores(directory, legacy);
  const sessionRejected = vi.fn();
  const value = createSyncEngine({ directory, transport: sync.transport, reloadProfiles: vi.fn(), sessionRejected,
    ...(legacy ? { legacy } : {}) });
  cleanup.push(() => value.close());
  return { sync, directory, value, sessionRejected, scope: profileDir(directory, 'profile-1') };
}
beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }));
afterEach(() => {
  cleanup.splice(0).forEach(close => close());
  vi.useRealTimers();
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('sync engine', () => {
  it('imports existing preferences, profiles, watched state and watchlist, and combines remote records', async () => {
    const legacy = dir();
    const registry = createProfileService(legacy);
    registry.update('profile-1', { name: 'Jamie', maxAge: 15, pin: '0426' });
    const original = profileDir(legacy, 'profile-1');
    writeProgress(original, 'tt12345', 45, 120);
    setWatched(original, 'tt45678', true);
    addWatchlist(original, { id: 'tt54321', title: 'Local title', poster: 'https://private.test/asset?token=fixture' });
    writePrefs(legacy, { audioLanguage: 'fra', quality: '720', extras: { ratings: false }, webhookUrl: 'https://private.test/secret' });
    const { sync, directory, scope, value } = engine(service(), dir(), legacy);
    const at = Date.now();
    sync.write([pref('extras.trailers', false, at), pref('extras.ratings', true, at + 1), {
      kind: 'progress', key: 'profile-1/tt67890', value: { position: 91, duration: 120, updated: new Date().toISOString() },
      updatedAt: at, deleted: false,
    }]);
    value.attach('session');
    expect((await value.syncNow()).pending).toBe(0);
    expect(readProgress(scope)).toMatchObject({ tt12345: { position: 45 }, tt45678: { position: 1 }, tt67890: { position: 91 } });
    expect(readWatchlist(scope).map(item => item.id)).toEqual(['tt54321']);
    expect(readSyncPrefs(directory)).toMatchObject({ audioLanguage: 'fra', 'extras.ratings': true, 'extras.trailers': false });
    const stored = [...sync.rows.values()].map(row => row.item);
    expect(stored.find(item => item.kind === 'profile')?.value).toMatchObject({ id: 'profile-1', name: 'Jamie', maxAge: 15,
      pin: registry.find('profile-1')?.pin });
    const payloads = JSON.stringify(sync.put.mock.calls);
    for (const forbidden of ['private.test', '"0426"', 'webhookUrl', '"quality"']) expect(payloads).not.toContain(forbidden);
  });

  it('pulls on sign-in, debounces from the last change by three seconds, and pulls every minute', async () => {
    const { sync, scope, value } = engine();
    value.attach('session');
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.get).toHaveBeenCalledTimes(1);
    writeProgress(scope, 'tt12345', 35, 120);
    await vi.advanceTimersByTimeAsync(2000);
    removeContinueWatching(scope, 'tt12345');
    await vi.advanceTimersByTimeAsync(2999);
    expect(sync.put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sync.put).toHaveBeenCalledTimes(1);
    expect(sync.rows.get('progress:profile-1/tt12345')?.item.value).toMatchObject({ hiddenFromContinueWatching: true });
    const gets = sync.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(59999);
    expect(sync.get).toHaveBeenCalledTimes(gets);
    await vi.advanceTimersByTimeAsync(1);
    expect(sync.get).toHaveBeenCalledTimes(gets + 1);
  });

  it('persists and replays offline removals after restart, with backoff and Retry-After', async () => {
    const { sync, directory, scope, value } = engine();
    addWatchlist(scope, { id: 'tt12345', title: 'Worth saving' });
    value.attach('session');
    await value.syncNow();
    sync.get.mockClear();
    sync.put.mockClear();
    sync.get.mockRejectedValueOnce(new AccountsError(503)).mockRejectedValueOnce(new AccountsError(429, '30'));
    removeWatchlist(scope, 'tt12345');
    await vi.advanceTimersByTimeAsync(3000);
    expect(value.status()).toMatchObject({ error: 'Account data could not sync.', pending: 1 });
    await vi.advanceTimersByTimeAsync(4999);
    expect(sync.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sync.get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29999);
    expect(sync.get).toHaveBeenCalledTimes(2);
    expect(sync.put).not.toHaveBeenCalled();
    value.close();
    const restarted = createSyncEngine({ directory, transport: sync.transport, reloadProfiles: vi.fn(), sessionRejected: vi.fn() });
    cleanup.push(() => restarted.close());
    restarted.attach('session');
    expect(restarted.status().pending).toBe(1);
    expect(await restarted.syncNow()).toMatchObject({ pending: 0, error: null });
    expect(sync.rows.get('watchlist:profile-1/tt12345')?.item).toMatchObject({ deleted: true, value: null });
    expect(readWatchlist(scope)).toEqual([]);
  });

  it('turns sync off silently after a 404 and stops making background requests', async () => {
    const { sync, scope, value } = engine();
    sync.get.mockRejectedValueOnce(new AccountsError(404));
    value.attach('session');
    expect(await value.syncNow()).toEqual(SYNC_DISABLED);
    writeProgress(scope, 'tt12345', 35, 120);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(value.status()).toEqual(SYNC_DISABLED);
    expect(sync.get).toHaveBeenCalledTimes(1);
    expect(sync.put).not.toHaveBeenCalled();
    expect(readProgress(scope)['tt12345']?.position).toBe(35);
  });

  it('drops an old generation queue after clear, keeps device copies, then syncs a new edit', async () => {
    const { sync, scope, value } = engine();
    value.attach('session');
    writeProgress(scope, 'tt12345', 40, 120);
    await value.syncNow();
    writeProgress(scope, 'tt12345', 50, 120);
    sync.clear();
    expect((await value.syncNow()).pending).toBe(0);
    expect(sync.rows.size).toBe(0);
    expect(readProgress(scope)['tt12345']?.position).toBe(50);
    writeProgress(scope, 'tt12345', 60, 120);
    await value.syncNow();
    expect(sync.rows.get('progress:profile-1/tt12345')?.item.value).toMatchObject({ position: 60 });
  });

  it('follows cursor pages without uploading unchanged incoming values or an empty placeholder', async () => {
    const { sync, directory, value } = engine();
    sync.get.mockImplementation(async (_token, query) => {
      const at = Date.now();
      if (query.get('cursor') === 'next') return { body: { items: [pref('audioLanguage', 'jpn', at)], now: at }, generation: '"0"' };
      return { body: { items: [{ kind: 'profile', key: 'profile-cloud', value: {
        id: 'profile-cloud', name: 'Family', hue: 200, kind: 'standard', maxAge: 18,
        created: new Date(at).toISOString(), avatar: null, pin: makePin('1470'),
      }, updatedAt: at, deleted: false }], now: at, nextCursor: 'next' }, generation: '"0"' };
    });
    value.attach('session');
    expect((await value.syncNow()).pending).toBe(0);
    expect(sync.get.mock.calls.map(([, query]) => query.toString())).toEqual(['since=0', 'since=0&cursor=next']);
    expect(loadProfiles(directory).profiles.map(profile => profile.id)).toEqual(['profile-cloud']);
    expect(readSyncPrefs(directory)).toEqual({ audioLanguage: 'jpn' });
    expect(sync.put).not.toHaveBeenCalled();
  });

  it('keeps account data and device settings separate across users and an offline restart', async () => {
    const dataDir = dir();
    const sync = service();
    const options = { dataDir, origin: 'https://example.test', transport: sync.transport, reloadProfiles: vi.fn() };
    const first = createAccountSync(options);
    cleanup.push(() => first.clear());
    const publicAccount: PublicAccount = {
      id: 'account-one', email: 'one@example.test', displayName: 'One', activated: true, role: 'member',
      tier: 'stream', suspended: false, createdAt: new Date().toISOString(), termsVersion: null, termsAcceptedAt: null,
      emailVerified: true, emailCodeSent: false, rdKey: false,
    };
    writePrefs(dataDir, { audioLanguage: 'fra' });
    const one = first.bind('one-session', publicAccount, 'signin');
    const two = first.bind('two-session', { ...publicAccount, id: 'account-two', email: 'two@example.test' }, 'signin');
    expect(one).not.toEqual(two);
    expect(readSyncPrefs(one)).toEqual({ audioLanguage: 'fra' });
    expect(readSyncPrefs(two)).toEqual({});
    runForSession('one-session', () => {
      setSyncDirectory(dataDir, one);
      writePrefs(dataDir, { audioLanguage: 'jpn', quality: 'saver' });
    });
    expect(readSyncPrefs(one)).toEqual({ audioLanguage: 'jpn' });
    expect(readSyncPrefs(two)).toEqual({});
    expect(prefsPath(dataDir)).not.toEqual(prefsPath(one));
    first.clear();
    const restarted = createAccountSync(options);
    cleanup.push(() => restarted.clear());
    expect(restarted.beginOffline('unknown-session')).toBeNull();
    expect(restarted.beginOffline('one-session')).toMatchObject({ id: publicAccount.id, rdToken: null });
    expect(restarted.bind('one-session', publicAccount, 'offline')).toBe(one);
    restarted.detach('one-session');
    expect(restarted.beginOffline('one-session')).toBeNull();
  });

  it('clears prior backoff on fresh sign-in and flushes edits made during an in-flight pull', async () => {
    const { sync, scope, value } = engine();
    sync.get.mockRejectedValueOnce(new AccountsError(503));
    value.attach('session-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(value.status().error).toBe('Account data could not sync.');

    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    sync.get.mockImplementationOnce(async () => {
      await gate;
      return { body: { items: [], now: 0 }, generation: '"0"' };
    });
    value.attach('session-2', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.get).toHaveBeenCalledTimes(2);
    writeProgress(scope, 'tt88888', 25, 100);
    const synced = value.syncNow();
    release();
    const status = await synced;
    expect(status).toMatchObject({ enabled: true, pending: 0, error: null });
    expect(sync.rows.get('progress:profile-1/tt88888')?.item.value).toMatchObject({ position: 25 });
  });
});

describe('sync HTTP endpoints', () => {
  const servers: Server[] = [];
  beforeEach(() => vi.useRealTimers());
  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('exposes status/now routes, merges first sign-in over HTTP, keeps device prefs local, and recovers after offline 503s', async () => {
    const dataDir = dir();
    const registry = createProfileService(dataDir);
    registry.update('profile-1', { name: 'Local Viewer' });
    writeProgress(profileDir(dataDir, 'profile-1'), 'tt00001', 30, 120);
    writePrefs(dataDir, { quality: '1080', language: 'fr', audioLanguage: 'spa', webhookUrl: 'https://private.test/hook' });

    let clock = 100;
    let meDown = false;
    const cloud = new Map<string, { item: SyncItem; clock: number }>([
      ['preference:extras.ratings', { item: pref('extras.ratings', false, 50), clock: 50 }],
      ['progress:profile-1/tt00002', { item: {
        kind: 'progress', key: 'profile-1/tt00002',
        value: { position: 60, duration: 120, updated: new Date(50).toISOString() },
        updatedAt: 50, deleted: false,
      }, clock: 50 }],
    ]);
    const account = {
      id: 'acc_sync_http', email: 'sync@example.com', displayName: 'Sync User', role: 'member',
      status: 'active', tier: 'stream', liveTv: false, emailVerified: true,
      termsVersion: TERMS_VERSION, hasRdToken: false, createdAt: '2026-11-01T00:00:00Z',
    };
    const sentPayloads: string[] = [];
    const sessions = new Set<string>();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      const token = (headers.get('authorization') ?? '').replace(/^Bearer /, '');
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (url.pathname === '/v1/signin') {
        sessions.add('sync-session');
        return Response.json({ session: 'sync-session', account });
      }
      if (!sessions.has(token)) return Response.json({ error: 'invalid' }, { status: 401 });
      if (url.pathname === '/v1/signout' && method === 'POST') {
        sessions.delete(token);
        return new Response(null, { status: 204 });
      }
      if (url.pathname === '/v1/me') {
        if (meDown) return Response.json({ error: 'unavailable' }, { status: 503 });
        return Response.json({ account });
      }
      if (url.pathname === '/v1/me/data' && method === 'GET') {
        const since = Number(url.searchParams.get('since') ?? '0');
        const items = [...cloud.values()].filter(row => row.clock > since).map(row => row.item);
        return Response.json({ items, now: clock }, { headers: { etag: '"0"' } });
      }
      if (url.pathname === '/v1/me/data' && method === 'PUT') {
        sentPayloads.push(String(init?.body ?? ''));
        clock += 1;
        for (const item of (body.items as SyncItem[])) {
          const id = itemId(item);
          const prev = cloud.get(id)?.item;
          if (!prev || prev.updatedAt < item.updatedAt) cloud.set(id, { item, clock });
        }
        return new Response(null, { status: 204 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    });

    const accounts = createRemoteAccountsService({ dataDir, termsVersion: TERMS_VERSION, env: {}, fetch: fetchMock });
    const server = createCoreServer({ dataDir, env: {}, accounts });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (path: string, method = 'GET', body?: unknown, token?: string) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as Record<string, any> };
    };

    expect((await call('/api/sync/status')).body).toEqual(SYNC_DISABLED);
    expect((await call('/api/sync/now', 'POST', {})).body).toEqual(SYNC_DISABLED);

    const signed = await call('/api/account/signin', 'POST', { email: account.email, password: 'test-password-123' });
    expect(signed.status).toBe(200);
    const session = signed.body.token as string;

    const first = await call('/api/sync/now', 'POST', {}, session);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ enabled: true, pending: 0, error: null });
    expect(typeof first.body.lastSyncAt).toBe('number');
    expect((await call('/api/prefs', 'GET', undefined, session)).body).toMatchObject({
      quality: '1080', language: 'fr', audioLanguage: 'spa', extras: { ratings: false },
    });
    expect(cloud.has('progress:profile-1/tt00001')).toBe(true);
    expect(cloud.has('preference:audioLanguage')).toBe(true);

    await call('/api/prefs', 'PUT', { audioLanguage: 'jpn', quality: '720' }, session);
    await call('/api/watchlist', 'PUT', { item: { id: 'tt55555', title: 'Watchlisted' } }, session);
    await call('/api/progress/watched', 'POST', { id: 'tt00001', watched: true }, session);
    await call('/api/progress/remove', 'POST', { id: 'tt00002' }, session);
    expect((await call('/api/sync/status', 'GET', undefined, session)).body).toMatchObject({ enabled: true });

    meDown = true;
    expect((await call('/api/progress', 'POST', { id: 'tt99999', position: 15, duration: 90 }, session)).status).toBe(200);
    expect((await call('/api/watchlist/remove', 'POST', { id: 'tt55555' }, session)).status).toBe(200);
    expect((await call('/api/prefs', 'GET', undefined, session)).body).toMatchObject({ audioLanguage: 'jpn', quality: '720' });

    meDown = false;
    const synced = await call('/api/sync/now', 'POST', {}, session);
    expect(synced.body).toMatchObject({ enabled: true, pending: 0, error: null });
    expect(cloud.get('preference:audioLanguage')?.item.value).toBe('jpn');
    expect(cloud.get('watchlist:profile-1/tt55555')?.item).toMatchObject({ deleted: true, value: null });
    expect(cloud.get('progress:profile-1/tt00002')?.item.value).toMatchObject({ hiddenFromContinueWatching: true });
    expect(cloud.get('progress:profile-1/tt99999')?.item.value).toMatchObject({ position: 15 });
    for (const payload of sentPayloads) {
      expect(payload).not.toContain('"quality"');
      expect(payload).not.toContain('private.test');
    }

    await call('/api/account/signout', 'POST', {}, session);
    expect(readPrefs(dataDir)).toMatchObject({ quality: '720', language: 'fr', audioLanguage: 'spa' });
    expect((await call('/api/sync/status', 'GET', undefined, session)).body).toEqual(SYNC_DISABLED);
  });
});
