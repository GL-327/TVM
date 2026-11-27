import { join } from 'node:path';
import { resolveAccountsUrl } from '../config.ts';
import { currentSessionToken } from '../requestContext.ts';
import { accountUsable, publicAccount, type AccountRecord, type AccountTier, type AdminAccount, type AccountsService } from './accounts.ts';
import { deleteSecret } from './secrets.ts';
import type { SyncItem } from '../sync/schema.ts';
import { readSealed, writeSealed } from './vault.ts';

interface ServiceAccount {
  id: string; email: string; displayName: string; role: 'member' | 'admin';
  status: 'waiting' | 'active' | 'suspended'; tier: AccountTier; liveTv: boolean;
  emailVerified: boolean; termsVersion: string | null; hasRdToken: boolean; createdAt: string;
  rdUsername?: string | null; rdPremiumUntil?: string | null; rdCheckedAt?: string | null;
  note?: string | null; activatedAt?: string | null; lastSeenAt?: string | null; sessionCount?: number;
}

export interface AccountsConfig {
  announcement: { id: string; text: string; level: 'info' | 'warning' | 'critical'; link?: string } | null;
  minVersion: string | null;
  flags: Record<string, boolean>;
  openSignups: boolean;
  mail: boolean;
  maintenance: { on: boolean; message: string };
}

export const DEFAULT_ACCOUNTS_CONFIG: AccountsConfig = {
  announcement: null, minVersion: null, flags: {}, openSignups: false, mail: false,
  maintenance: { on: false, message: '' },
};

function publicConfig(input: Partial<AccountsConfig>): AccountsConfig {
  const a = input.announcement;
  let link: string | undefined;
  if (typeof a?.link === 'string') {
    try {
      const url = new URL(a.link);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) link = url.href;
    } catch { /* Ignore invalid links. */ }
  }
  const m = input.maintenance;
  const maintenance = {
    on: m?.on === true,
    message: typeof m?.message === 'string' ? m.message.trim() : '',
  };
  return {
    announcement: a && typeof a.id === 'string' && typeof a.text === 'string' &&
      ['info', 'warning', 'critical'].includes(a.level)
      ? { id: a.id, text: a.text, level: a.level, ...(link ? { link } : {}) } : null,
    minVersion: typeof input.minVersion === 'string' ? input.minVersion : null,
    flags: Object.fromEntries(Object.entries(input.flags ?? {}).filter(([, value]) => typeof value === 'boolean')),
    openSignups: input.openSignups === true,
    mail: input.mail === true,
    maintenance,
  };
}

export class AccountsError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;
  constructor(status: number, retryAfter: string | null = null, code?: string) {
    super(code ?? (status === 503 ? 'accounts_unavailable' : status === 429 ? 'rate_limited' : status === 403 ? 'forbidden' : 'invalid'));
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Convert only explicitly public fields. No passwords or RD tokens enter account records. */
function record(a: ServiceAccount): AccountRecord {
  return {
    id: a.id, email: a.email, displayName: a.displayName, role: a.role === 'admin' ? 'dev' : 'member',
    activated: a.status === 'active', suspended: a.status === 'suspended',
    tier: a.status === 'waiting' ? null : a.liveTv ? 'stream-live' : 'stream', createdAt: a.createdAt,
    activatedAt: a.activatedAt ?? null, lastSeenAt: a.lastSeenAt ?? null,
    termsVersion: a.termsVersion, termsAcceptedAt: a.termsVersion ? a.createdAt : null,
    emailVerifiedAt: a.emailVerified ? a.createdAt : null, emailCode: null,
    // Presence marker for the existing rdKey boolean; never an actual credential.
    rdToken: a.hasRdToken ? '[remote]' : null,
    passwordHash: '', passwordSalt: '', signIns: 0, lastClient: null, note: a.note ?? null,
  };
}
function adminAccount(a: ServiceAccount): AdminAccount {
  const r = record(a);
  return { ...publicAccount(r), activatedAt: r.activatedAt, lastSeenAt: r.lastSeenAt,
    signIns: 0, lastClient: null, note: r.note, activeSessions: a.sessionCount ?? 0,
    emailVerifiedAt: r.emailVerifiedAt, rdUsername: a.rdUsername ?? null,
    rdPremiumUntil: a.rdPremiumUntil ?? null, rdCheckedAt: a.rdCheckedAt ?? null, rdKeyHint: a.hasRdToken ? '••••' : null };
}

export function createRemoteAccountsService(options: {
  dataDir: string; termsVersion: string; env?: NodeJS.ProcessEnv; fetch?: typeof fetch; now?: () => number;
}) {
  const { dataDir, termsVersion } = options;
  const origin = resolveAccountsUrl(options.env);
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sessionPath = join(dataDir, 'secrets', 'account-sessions.enc');
  const keyPath = join(dataDir, 'secrets', 'accounts-admin-key.enc');
  const rdCache = new Map<string, { token: string | null; expires: number; timer: NodeJS.Timeout }>();
  const rdPending = new Map<string, Promise<string | null>>();
  const forgetRd = (session: string): void => {
    rdPending.delete(session);
    clearTimeout(rdCache.get(session)?.timer);
    rdCache.delete(session);
  };
  const clearRd = (): void => { for (const session of new Set([...rdCache.keys(), ...rdPending.keys()])) forgetRd(session); };
  const credentials = (path: string): { origin: string; tokens?: string[]; key?: string } | null => {
    const saved = readSealed<{ origin: string; tokens?: string[]; key?: string }>(dataDir, path);
    return saved?.origin === origin ? saved : null;
  };
  const remember = (token: string, keep: boolean): void => {
    const tokens = (credentials(sessionPath)?.tokens ?? []).filter(t => t !== token);
    if (keep) tokens.push(token);
    writeSealed(dataDir, sessionPath, { origin, tokens });
  };
  const exchange = async (path: string, method = 'GET', body?: unknown, bearer?: string, accept = 'application/json', ifMatch?: string): Promise<Response> => {
    let response: Response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { accept, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(ifMatch ? { 'if-match': ifMatch } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new AccountsError(503); }
    if (!response.ok) {
      let code: string | undefined;
      if (response.status === 400) {
        const errBody = await response.json().catch(() => null) as { error?: unknown } | null;
        if (errBody?.error === 'invalid_invite') code = 'invalid_invite';
      }
      throw new AccountsError(response.status, response.headers.get('retry-after'), code);
    }
    return response;
  };
  const request = async <T>(path: string, method = 'GET', body?: unknown, bearer?: string): Promise<T> => {
    const response = await exchange(path, method, body, bearer);
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; } catch { throw new AccountsError(503); }
  };
  const resolve = async (token: string | undefined): Promise<AccountRecord | null> => {
    if (!token) return null;
    try {
      const result = await request<{ account: ServiceAccount }>('/v1/me', 'GET', undefined, token);
      const a = record(result.account);
      if (a.suspended || !result.account.hasRdToken || !a.activated || rdCache.get(token)?.token === null) forgetRd(token);
      return a.suspended ? null : a;
    } catch (error) {
      forgetRd(token);
      if (error instanceof AccountsError && error.status === 401) { remember(token, false); return null; }
      throw error;
    }
  };
  const adminKey = async (): Promise<string> => {
    const key = credentials(keyPath)?.key;
    if (!key || (await resolve(currentSessionToken()))?.role !== 'dev') throw new AccountsError(403);
    return key;
  };
  const admin = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> =>
    request<T>(`/v1/admin/${path}`, method, body, await adminKey());
  let config = DEFAULT_ACCOUNTS_CONFIG;
  let configExpires = -Infinity;
  let configPending: Promise<AccountsConfig> | undefined;
  let configGeneration = 0;
  const listRemote = async (filter: { search?: string; state?: 'all' | 'waiting' | 'active' | 'suspended' } = {}): Promise<ServiceAccount[]> => {
    const query = new URLSearchParams({ state: filter.state ?? 'all', search: filter.search ?? '' });
    const all: ServiceAccount[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      query.set('offset', String(offset));
      const page: { accounts: ServiceAccount[]; nextOffset: number | null } = await admin(`accounts?${query}`);
      all.push(...page.accounts);
      if (page.nextOffset !== null && (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset)) throw new AccountsError(503);
      offset = page.nextOffset;
    }
    return all;
  };
  const change = async (id: string, action: string, body: unknown): Promise<AdminAccount> => {
    const result = await admin<{ account: ServiceAccount }>(`accounts/${encodeURIComponent(id)}/${action}`, 'POST', body);
    clearRd();
    // Mutation receipts contain public fields only. Reload the admin fields
    // (note, session count and timestamps) expected by the existing Accounts UI.
    const full = (await listRemote({ search: result.account.email })).find(a => a.id === id);
    return adminAccount(full ?? result.account);
  };
  const requiredSession = (): string => {
    const token = currentSessionToken();
    if (!token) throw new AccountsError(401);
    return token;
  };
  return {
    termsVersion,
    syncOrigin: origin,
    async getSyncPage(token: string, query: URLSearchParams, generation: string | null) {
      const response = await exchange(`/v1/me/data?${query}`, 'GET', undefined, token, 'application/json', generation ?? undefined);
      try { return { body: await response.json() as unknown, generation: response.headers.get('etag') }; }
      catch { throw new AccountsError(503); }
    },
    async putSyncItems(token: string, items: SyncItem[], generation: string): Promise<void> {
      await exchange('/v1/me/data', 'PUT', { items }, token, 'application/json', generation);
    },
    config(): Promise<AccountsConfig> {
      if (now() < configExpires) return Promise.resolve(config);
      if (configPending) return configPending;
      const generation = configGeneration;
      const task = request<Partial<AccountsConfig>>('/v1/config').then(publicConfig).then(value => {
        if (generation === configGeneration) {
          config = value;
          configExpires = now() + 60_000;
        }
        return value;
      }).catch(() => {
        if (generation === configGeneration) configExpires = now() + 15_000;
        return config;
      }).finally(() => { if (configPending === task) configPending = undefined; });
      configPending = task;
      return task;
    },
    async resendVerification(email?: unknown): Promise<void> {
      if (email === undefined) await exchange('/v1/me/verify/resend', 'POST', undefined, requiredSession());
      else await exchange('/v1/verify/resend', 'POST', { email });
    },
    async forgotPassword(email: unknown): Promise<void> {
      await exchange('/v1/password/forgot', 'POST', { email });
    },
    async mirrorAdmin(path: string, method: string, body?: unknown): Promise<Response> {
      const response = await exchange(`/v1/admin/${path}`, method, body, await adminKey(),
        path === 'accounts.csv' ? 'text/csv' : 'application/json');
      if (method !== 'GET') {
        clearRd();
        if (path === 'config') {
          configGeneration++;
          configExpires = -Infinity;
          configPending = undefined;
        }
      }
      return response;
    },
    hasAdminKey: (): boolean => !!credentials(keyPath)?.key,
    installAdminKey(key: string): void {
      if (key.length > 4096 || /[\r\n]/.test(key)) throw new AccountsError(400);
      if (!key.trim()) deleteSecret(keyPath);
      else writeSealed(dataDir, keyPath, { origin, key: key.trim() });
    },
    async register(input: { email?: unknown; password?: unknown; displayName?: unknown; client?: string | null; inviteCode?: unknown }) {
      const inviteCode = typeof input.inviteCode === 'string' ? input.inviteCode.trim() : '';
      const result = await request<{ account: ServiceAccount }>('/v1/register', 'POST', {
        email: input.email, password: input.password,
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        ...(input.client == null ? {} : { client: input.client }),
        ...(inviteCode ? { inviteCode } : {}),
      });
      return publicAccount(record(result.account));
    },
    async signIn(input: { email?: unknown; password?: unknown; client?: string | null }) {
      const result = await request<{ session: string; account: ServiceAccount }>('/v1/signin', 'POST', {
        email: input.email, password: input.password, ...(input.client == null ? {} : { client: input.client }),
      });
      remember(result.session, true);
      const a = record(result.account);
      return { token: result.session, account: publicAccount(a), usable: accountUsable(a, termsVersion) };
    },
    async signOut(token: string) {
      forgetRd(token);
      try { await request('/v1/signout', 'POST', undefined, token); }
      catch (error) { if (!(error instanceof AccountsError) || error.status !== 401) throw error; }
      finally { remember(token, false); }
    },
    resolve,
    usable: (a: AccountRecord | null) => accountUsable(a, termsVersion),
    async acceptTerms(_id: string) {
      const result = await request<{ account: ServiceAccount }>('/v1/me/terms', 'POST', { version: termsVersion }, requiredSession());
      return publicAccount(record(result.account));
    },
    cachedRdTokenFor(token: string | undefined): string | null {
      if (!token) return null;
      const cached = rdCache.get(token);
      if (!cached) return null;
      if (cached.expires <= now()) { forgetRd(token); return null; }
      return cached.token;
    },
    forgetRdToken(token: string | undefined, rejected?: string): void {
      if (token && (rejected === undefined || rdCache.get(token)?.token === rejected)) forgetRd(token);
    },
    async rdTokenFor(token: string | undefined, fresh = false): Promise<string | null> {
      if (!token) return null;
      if (fresh) forgetRd(token);
      const cached = rdCache.get(token);
      if (cached && cached.expires > now()) return cached.token;
      const pending = rdPending.get(token);
      if (pending) return pending;
      forgetRd(token);
      const task = request<{ token: string | null }>('/v1/me/rd-token', 'GET', undefined, token).then(result => {
        if (rdPending.get(token) !== task) return rdCache.get(token)?.token ?? null;
        const value = result.token?.trim() || null;
        // Keep a real key for 10 minutes, but recheck a missing one after 30 seconds.
        const ttl = value === null ? 30_000 : 10 * 60_000;
        const timer = setTimeout(() => {
          if (rdCache.get(token)?.timer === timer) forgetRd(token);
        }, ttl);
        timer.unref();
        rdCache.set(token, { token: value, expires: now() + ttl, timer });
        return value;
      }).catch((error: unknown) => {
        if (error instanceof AccountsError && [401, 403].includes(error.status)) return null;
        throw error;
      }).finally(() => {
        if (rdPending.get(token) === task) rdPending.delete(token);
      });
      rdPending.set(token, task);
      return task;
    },
    async setOwnRdToken(token: string) {
      const session = requiredSession();
      forgetRd(session);
      const result = await request<{ account: ServiceAccount }>('/v1/me/rd-token', 'PUT', { token: token.trim() }, session);
      forgetRd(session);
      return publicAccount(record(result.account));
    },
    async list(filter: { search?: string; state?: 'all' | 'waiting' | 'active' | 'suspended' } = {}) {
      return (await listRemote(filter)).map(adminAccount);
    },
    summary: () => admin<{ total: number; waiting: number; active: number; suspended: number }>('summary'),
    activate: (input: { id: string; tier: AccountTier; note?: string | null }) => change(input.id, 'activate', {
      tier: input.tier, ...(input.note == null ? {} : { note: input.note }),
    }),
    setSuspended: (id: string, suspended: boolean) => change(id, 'suspend', { suspended }),
    setNote: (id: string, note: string | null) => change(id, 'note', { note: note ?? '' }),
    setLiveTv: (id: string, enabled: boolean) => change(id, 'live-tv', { enabled }),
    setRdToken: (id: string, token: string | null) => change(id, 'rd-token', { token }),
    setEmailVerified: (id: string, verified: boolean) => change(id, 'email-verified', { verified }),
    async erase(id: string) { await admin(`accounts/${encodeURIComponent(id)}`, 'DELETE'); clearRd(); },
    // The private API has no session-delegation endpoint. Never mint a local substitute.
    openPairedSession(): never { throw new AccountsError(503); },
  };
}

export type RemoteAccountsService = ReturnType<typeof createRemoteAccountsService>;
/** The local implementation remains available to isolated legacy fixtures, never selected at runtime. */
export type CoreAccountsService = AccountsService | RemoteAccountsService;
