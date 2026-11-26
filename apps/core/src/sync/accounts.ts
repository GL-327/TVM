import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { AccountRecord, PublicAccount } from '../providers/accounts.ts';
import { readSealed, writeSealed } from '../providers/vault.ts';
import { createSyncEngine, SYNC_DISABLED, type SyncTransport } from './engine.ts';
import { initializeStores } from './stores.ts';

interface KnownSession { account: PublicAccount; expiresAt: number }
const OFFLINE_SESSION_MS = 60 * 86400_000;
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

export function createAccountSync(options: {
  dataDir: string;
  origin: string;
  transport: SyncTransport;
  reloadProfiles: (directory: string) => void;
}) {
  const { dataDir, origin } = options;
  const root = join(dataDir, 'sync');
  const identityPath = join(root, hash(origin) + '-sessions.enc');
  const claimedPath = join(root, 'legacy-owner.enc');
  const sessions = new Map<string, string>();
  const accounts = new Map<string, { directory: string; engine: ReturnType<typeof createSyncEngine> }>();
  const offlineUntil = new Map<string, number>();
  let identities: Record<string, KnownSession> | undefined;
  const known = () => identities ??= readSealed<Record<string, KnownSession>>(dataDir, identityPath) ?? {};

  function removeIdentity(token: string): void {
    const key = hash(token);
    if (!known()[key]) return;
    delete known()[key];
    writeSealed(dataDir, identityPath, known());
  }

  function detach(token: string): void {
    const account = sessions.get(token);
    const current = account ? accounts.get(account) : undefined;
    current?.engine.detach(token);
    sessions.delete(token);
    offlineUntil.delete(token);
    if (current) {
      const fallback = [...sessions.entries()].find(([, id]) => id === account);
      if (fallback) current.engine.attach(fallback[0]);
    }
    removeIdentity(token);
  }

  return {
    bind(token: string, account: PublicAccount, reason: 'signin' | 'verified' | 'offline'): string {
      let current = accounts.get(account.id);
      if (!current) {
        const key = hash(origin + '\0' + account.id);
        const directory = join(root, 'accounts', key);
        const markerPath = join(directory, 'initialized.enc');
        const marker = readSealed<{ legacy: boolean }>(directory, markerPath);
        let legacy = marker?.legacy ?? false;
        if (!marker) {
          const owner = readSealed<string>(dataDir, claimedPath);
          legacy = owner === null || owner === key;
          if (owner === null) writeSealed(dataDir, claimedPath, key);
          initializeStores(directory, legacy ? dataDir : undefined);
          writeSealed(directory, markerPath, { legacy });
        }
        const engine = createSyncEngine({
          directory, ...(legacy ? { legacy: dataDir } : {}), transport: options.transport,
          reloadProfiles: () => options.reloadProfiles(directory), sessionRejected: detach,
        });
        current = { directory, engine };
        accounts.set(account.id, current);
      }
      if (reason !== 'offline') {
        offlineUntil.delete(token);
        const key = hash(token);
        const saved = known()[key];
        const at = Date.now();
        if (!saved || JSON.stringify(saved.account) !== JSON.stringify(account)
          || saved.expiresAt - at < OFFLINE_SESSION_MS - 3600_000) {
          known()[key] = { account, expiresAt: at + OFFLINE_SESSION_MS };
          for (const [id, value] of Object.entries(known())) if (value.expiresAt <= at) delete known()[id];
          writeSealed(dataDir, identityPath, known());
        }
      }
      const alreadyBound = sessions.has(token);
      sessions.set(token, account.id);
      if (!alreadyBound || reason === 'signin') current.engine.attach(token, reason === 'signin');
      return current.directory;
    },
    offlineAccount(token: string): AccountRecord | null {
      const saved = known()[hash(token)];
      if (!saved || saved.expiresAt <= Date.now()) return null;
      const { account } = saved;
      return { ...account, activatedAt: null, emailVerifiedAt: account.emailVerified ? account.createdAt : null,
        passwordHash: '', passwordSalt: '', emailCode: null, rdToken: account.rdKey ? '[remote]' : null,
        note: null, lastSeenAt: null, lastClient: null, signIns: 0 };
    },
    beginOffline(token: string): AccountRecord | null {
      const account = this.offlineAccount(token);
      if (account) offlineUntil.set(token, Date.now() + 15_000);
      return account;
    },
    deferredAccount(token: string): AccountRecord | null {
      return (offlineUntil.get(token) ?? 0) > Date.now() ? this.offlineAccount(token) : null;
    },
    detach,
    status(token: string | undefined) {
      const account = token ? sessions.get(token) : undefined;
      return (account ? accounts.get(account)?.engine.status() : undefined) ?? SYNC_DISABLED;
    },
    async syncNow(token: string | undefined) {
      const account = token ? sessions.get(token) : undefined;
      return (account ? await accounts.get(account)?.engine.syncNow() : undefined) ?? SYNC_DISABLED;
    },
    clear(): void {
      for (const entry of accounts.values()) entry.engine.close();
      sessions.clear();
      offlineUntil.clear();
      accounts.clear();
      identities = undefined;
    },
  };
}

export type AccountSync = ReturnType<typeof createAccountSync>;
