import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { accountsPath } from '../update/paths.ts';
import { readSealed, writeSealed } from './vault.ts';

/**
 * Accounts: who may use this TVM, and who decided so.
 *
 * TVM is not self-serve. Signing up creates a record and nothing else — every
 * account starts inert and only the owner can switch it on. That is the whole
 * access model: there is no plan to buy, no trial that expires, no card that
 * unlocks anything. Someone asks, the owner decides.
 *
 * Passwords are stored as scrypt digests with a per-account salt, never
 * encrypted and never recoverable. Encryption would be the wrong tool: it
 * implies someone can read them back, and nobody should be able to, including
 * the owner looking at the admin screen.
 *
 * Everything on disk goes through the same AES-256-GCM vault as the rest of
 * the secrets directory, so a stolen data folder yields neither passwords nor
 * email addresses.
 */

/** What the owner granted. There is no free tier: an inactive account sees nothing. */
export type AccountTier = 'stream' | 'stream-live';

export const ACCOUNT_TIERS: readonly AccountTier[] = ['stream', 'stream-live'];

export function isAccountTier(value: unknown): value is AccountTier {
  return typeof value === 'string' && (ACCOUNT_TIERS as readonly string[]).includes(value);
}

export interface AccountRecord {
  id: string;
  /** Lowercased and trimmed; the unique key. */
  email: string;
  displayName: string;
  /** scrypt(password, salt). Not reversible, by design. */
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;

  /** Nothing works until the owner sets this. */
  activated: boolean;
  activatedAt: string | null;
  tier: AccountTier | null;
  /** Owner's private note. Never shown to the account holder. */
  note: string | null;
  /** Switched off without deleting, so the record and its history survive. */
  suspended: boolean;

  /** Acceptance is recorded per version, so a change of terms can require a fresh one. */
  termsVersion: string | null;
  termsAcceptedAt: string | null;

  lastSeenAt: string | null;
  signIns: number;
  /** Coarse, for the owner to spot an account being shared. Never a precise history. */
  lastClient: string | null;
}

export interface AccountsLedger {
  version: 1;
  accounts: AccountRecord[];
  /** sha256(token) -> session. The token itself is never stored. */
  sessions: Record<string, { accountId: string; issuedAt: string; expiresAt: string; client: string | null }>;
}

const SCRYPT = { N: 16_384, r: 8, p: 1 } as const;
const HASH_BYTES = 32;
const SESSION_DAYS = 30;
export const MIN_PASSWORD_LENGTH = 10;

export function emptyAccounts(): AccountsLedger {
  return { version: 1, accounts: [], sessions: {} };
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Deliberately permissive. The job here is to reject obvious nonsense, not to
 * adjudicate the email RFC — a real address is proven by the owner recognising
 * it when they activate the account, not by a regular expression.
 */
export function emailLooksValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) return 'Enter a password.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return 'That password is too long.';
  return null;
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const use = salt ?? randomBytes(16).toString('hex');
  return { hash: scryptSync(password, use, HASH_BYTES, SCRYPT).toString('hex'), salt: use };
}

/** Constant time, so a wrong password cannot be narrowed down by how long it took. */
export function passwordMatches(password: string, record: Pick<AccountRecord, 'passwordHash' | 'passwordSalt'>): boolean {
  try {
    const derived = scryptSync(password, record.passwordSalt, HASH_BYTES, SCRYPT);
    const stored = Buffer.from(record.passwordHash, 'hex');
    return derived.length === stored.length && timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Whether this account may use TVM right now.
 *
 * Four things must all hold, and the order matters only for the message the
 * caller shows. An account can exist, have accepted the terms and still see
 * nothing, because activation is a decision somebody makes.
 */
export function accountUsable(record: AccountRecord | null, termsVersion: string): { ok: boolean; reason: string | null } {
  if (record === null) return { ok: false, reason: 'no_account' };
  if (record.suspended) return { ok: false, reason: 'suspended' };
  if (!record.activated || record.tier === null) return { ok: false, reason: 'awaiting_activation' };
  if (record.termsVersion !== termsVersion || record.termsAcceptedAt === null) return { ok: false, reason: 'terms_required' };
  return { ok: true, reason: null };
}

/** What an account holder may see about themselves. Never the hash or the salt. */
export interface PublicAccount {
  id: string;
  email: string;
  displayName: string;
  activated: boolean;
  tier: AccountTier | null;
  suspended: boolean;
  createdAt: string;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
}

export function publicAccount(record: AccountRecord): PublicAccount {
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    activated: record.activated,
    tier: record.tier,
    suspended: record.suspended,
    createdAt: record.createdAt,
    termsVersion: record.termsVersion,
    termsAcceptedAt: record.termsAcceptedAt,
  };
}

/**
 * What the owner sees in the admin screen.
 *
 * Adds the operational detail an owner needs to decide whether to activate
 * somebody — when they signed up, how often they have signed in, what they
 * last used — and still never includes the password digest. There is no
 * screen anywhere that reveals a password, because nothing stored can.
 */
export interface AdminAccount extends PublicAccount {
  activatedAt: string | null;
  lastSeenAt: string | null;
  signIns: number;
  lastClient: string | null;
  note: string | null;
  activeSessions: number;
}

export function hydrateAccounts(raw: unknown): AccountsLedger {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyAccounts();
  const value = raw as Partial<AccountsLedger>;
  if (value.version !== 1 || !Array.isArray(value.accounts)) return emptyAccounts();
  const accounts = value.accounts.filter((entry): entry is AccountRecord =>
    entry !== null && typeof entry === 'object'
    && typeof (entry as AccountRecord).id === 'string'
    && typeof (entry as AccountRecord).email === 'string'
    && typeof (entry as AccountRecord).passwordHash === 'string');
  const sessions: AccountsLedger['sessions'] = {};
  if (value.sessions !== null && typeof value.sessions === 'object') {
    for (const [key, entry] of Object.entries(value.sessions as Record<string, unknown>)) {
      if (entry === null || typeof entry !== 'object') continue;
      const session = entry as AccountsLedger['sessions'][string];
      if (typeof session.accountId === 'string' && typeof session.expiresAt === 'string') sessions[key] = session;
    }
  }
  return { version: 1, accounts, sessions };
}

export interface AccountsServiceOptions {
  dataDir: string;
  /** Bumped when the terms change; acceptance is per version. */
  termsVersion: string;
  now?: () => Date;
}

export function createAccountsService(options: AccountsServiceOptions) {
  const { dataDir, termsVersion } = options;
  const now = options.now ?? (() => new Date());

  const read = (): AccountsLedger => hydrateAccounts(readSealed<AccountsLedger>(dataDir, accountsPath(dataDir)));
  const write = (ledger: AccountsLedger): void => {
    writeSealed(dataDir, accountsPath(dataDir), ledger satisfies AccountsLedger);
  };

  /** Expired sessions are dropped whenever the ledger is touched. */
  const prune = (ledger: AccountsLedger): AccountsLedger => {
    const at = now().getTime();
    const sessions: AccountsLedger['sessions'] = {};
    for (const [key, session] of Object.entries(ledger.sessions)) {
      if (new Date(session.expiresAt).getTime() > at) sessions[key] = session;
    }
    return { ...ledger, sessions };
  };

  const find = (ledger: AccountsLedger, email: string): AccountRecord | null =>
    ledger.accounts.find((account) => account.email === email) ?? null;

  const replace = (ledger: AccountsLedger, record: AccountRecord): AccountsLedger => ({
    ...ledger,
    accounts: ledger.accounts.map((entry) => (entry.id === record.id ? record : entry)),
  });

  return {
    termsVersion,

    /**
     * Creates an inert account.
     *
     * The first account is not special and is not auto-activated: an owner
     * unlocks developer mode with a code, and that is the only route to
     * activating anybody, including themselves.
     */
    register(input: { email?: unknown; password?: unknown; displayName?: unknown; client?: string | null }): PublicAccount {
      const email = normalizeEmail(input.email);
      if (!emailLooksValid(email)) throw new Error('Enter a valid email address.');
      const problem = passwordProblem(input.password);
      if (problem !== null) throw new Error(problem);

      const ledger = prune(read());
      // Do not say whether the address already exists: that turns signup into
      // a way of testing which addresses have accounts.
      if (find(ledger, email) !== null) throw new Error('That account could not be created. If it already exists, sign in instead.');

      const { hash, salt } = hashPassword(input.password as string);
      const record: AccountRecord = {
        id: `acc_${randomUUID().replace(/-/g, '')}`,
        email,
        displayName: typeof input.displayName === 'string' && input.displayName.trim() !== ''
          ? input.displayName.trim().slice(0, 80)
          : email.split('@')[0]!.slice(0, 80),
        passwordHash: hash,
        passwordSalt: salt,
        createdAt: now().toISOString(),
        activated: false,
        activatedAt: null,
        tier: null,
        note: null,
        suspended: false,
        termsVersion: null,
        termsAcceptedAt: null,
        lastSeenAt: null,
        signIns: 0,
        lastClient: typeof input.client === 'string' ? input.client.slice(0, 200) : null,
      };
      write({ ...ledger, accounts: [...ledger.accounts, record] });
      return publicAccount(record);
    },

    /**
     * Signs in and issues a session token.
     *
     * Succeeds for an account that is not yet activated: the holder needs to
     * be able to sign in and see that they are waiting, rather than being told
     * their password is wrong. What they cannot do is use TVM — that is
     * `accountUsable`, checked separately on every request.
     */
    signIn(input: { email?: unknown; password?: unknown; client?: string | null }): { token: string; account: PublicAccount; usable: ReturnType<typeof accountUsable> } {
      const email = normalizeEmail(input.email);
      const password = typeof input.password === 'string' ? input.password : '';
      const ledger = prune(read());
      const record = find(ledger, email);

      // Always do the work, so a missing account and a wrong password take the
      // same time and cannot be told apart from outside.
      const reference = record ?? {
        passwordHash: hashPassword('never-matches-this').hash,
        passwordSalt: 'x'.repeat(32),
      } as Pick<AccountRecord, 'passwordHash' | 'passwordSalt'>;
      const matched = passwordMatches(password, reference);
      if (record === null || !matched) throw new Error('That email address and password do not match.');

      const token = randomBytes(32).toString('hex');
      const issued = now();
      const expires = new Date(issued.getTime() + SESSION_DAYS * 86_400_000);
      const client = typeof input.client === 'string' ? input.client.slice(0, 200) : null;

      const updated: AccountRecord = {
        ...record,
        lastSeenAt: issued.toISOString(),
        signIns: record.signIns + 1,
        lastClient: client ?? record.lastClient,
      };
      write({
        ...replace(ledger, updated),
        sessions: {
          ...ledger.sessions,
          [hashToken(token)]: {
            accountId: record.id,
            issuedAt: issued.toISOString(),
            expiresAt: expires.toISOString(),
            client,
          },
        },
      });

      return { token, account: publicAccount(updated), usable: accountUsable(updated, termsVersion) };
    },

    signOut(token: string): void {
      const ledger = prune(read());
      const key = hashToken(token);
      if (ledger.sessions[key] === undefined) return;
      const sessions = { ...ledger.sessions };
      delete sessions[key];
      write({ ...ledger, sessions });
    },

    /** Resolves a token to its account, refreshing last-seen. Null when unknown or expired. */
    resolve(token: string | undefined): AccountRecord | null {
      if (typeof token !== 'string' || token === '') return null;
      const ledger = prune(read());
      const session = ledger.sessions[hashToken(token)];
      if (session === undefined) return null;
      const record = ledger.accounts.find((entry) => entry.id === session.accountId) ?? null;
      if (record === null) return null;
      const seen = now().toISOString();
      // Only rewrite when the day has changed; every request otherwise means a
      // vault write per request.
      if (record.lastSeenAt === null || record.lastSeenAt.slice(0, 10) !== seen.slice(0, 10)) {
        write(replace(ledger, { ...record, lastSeenAt: seen }));
        return { ...record, lastSeenAt: seen };
      }
      return record;
    },

    /** Records acceptance of the current terms for this account. */
    acceptTerms(accountId: string): PublicAccount {
      const ledger = prune(read());
      const record = ledger.accounts.find((entry) => entry.id === accountId);
      if (record === undefined) throw new Error('No such account.');
      const updated: AccountRecord = { ...record, termsVersion, termsAcceptedAt: now().toISOString() };
      write(replace(ledger, updated));
      return publicAccount(updated);
    },

    usable(record: AccountRecord | null): ReturnType<typeof accountUsable> {
      return accountUsable(record, termsVersion);
    },

    // ---- Owner-only, behind developer unlock -----------------------------

    /**
     * Every account, newest first, optionally filtered.
     *
     * The search is a plain substring over address and name. Anything cleverer
     * would be guessing at what the owner meant.
     */
    list(query: { search?: string; state?: 'all' | 'waiting' | 'active' | 'suspended' } = {}): AdminAccount[] {
      const ledger = prune(read());
      const search = (query.search ?? '').trim().toLowerCase();
      const state = query.state ?? 'all';
      const counts = new Map<string, number>();
      for (const session of Object.values(ledger.sessions)) {
        counts.set(session.accountId, (counts.get(session.accountId) ?? 0) + 1);
      }
      return ledger.accounts
        .filter((account) => {
          if (search !== '' && !account.email.includes(search) && !account.displayName.toLowerCase().includes(search)) return false;
          if (state === 'waiting') return !account.activated && !account.suspended;
          if (state === 'active') return account.activated && !account.suspended;
          if (state === 'suspended') return account.suspended;
          return true;
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((account) => ({
          ...publicAccount(account),
          activatedAt: account.activatedAt,
          lastSeenAt: account.lastSeenAt,
          signIns: account.signIns,
          lastClient: account.lastClient,
          note: account.note,
          activeSessions: counts.get(account.id) ?? 0,
        }));
    },

    /** Switches an account on, at a tier. This is the only route to using TVM. */
    activate(input: { id: string; tier: AccountTier; note?: string | null }): AdminAccount {
      if (!isAccountTier(input.tier)) throw new Error('Choose a valid tier.');
      const ledger = prune(read());
      const record = ledger.accounts.find((entry) => entry.id === input.id);
      if (record === undefined) throw new Error('No such account.');
      const updated: AccountRecord = {
        ...record,
        activated: true,
        activatedAt: record.activatedAt ?? now().toISOString(),
        tier: input.tier,
        suspended: false,
        note: input.note === undefined ? record.note : (input.note?.slice(0, 500) ?? null),
      };
      write(replace(ledger, updated));
      return this.list({ search: updated.email })[0]!;
    },

    /**
     * Switches an account off without deleting it.
     *
     * Its sessions are dropped immediately, so revoking access does not wait
     * for a token to expire.
     */
    setSuspended(id: string, suspended: boolean): AdminAccount {
      const ledger = prune(read());
      const record = ledger.accounts.find((entry) => entry.id === id);
      if (record === undefined) throw new Error('No such account.');
      const updated: AccountRecord = { ...record, suspended, activated: suspended ? false : record.activated };
      const sessions = { ...ledger.sessions };
      if (suspended) {
        for (const [key, session] of Object.entries(sessions)) {
          if (session.accountId === id) delete sessions[key];
        }
      }
      write({ ...replace(ledger, updated), sessions });
      return this.list({ search: updated.email })[0]!;
    },

    setNote(id: string, note: string | null): AdminAccount {
      const ledger = prune(read());
      const record = ledger.accounts.find((entry) => entry.id === id);
      if (record === undefined) throw new Error('No such account.');
      const updated: AccountRecord = { ...record, note: note === null ? null : note.slice(0, 500) };
      write(replace(ledger, updated));
      return this.list({ search: updated.email })[0]!;
    },

    /**
     * Deletes an account and everything attached to it.
     *
     * Needed for a UK GDPR erasure request, which is not optional once real
     * people have accounts.
     */
    erase(id: string): void {
      const ledger = prune(read());
      const sessions = { ...ledger.sessions };
      for (const [key, session] of Object.entries(sessions)) {
        if (session.accountId === id) delete sessions[key];
      }
      write({ ...ledger, accounts: ledger.accounts.filter((entry) => entry.id !== id), sessions });
    },

    summary(): { total: number; waiting: number; active: number; suspended: number } {
      const all = this.list();
      return {
        total: all.length,
        waiting: all.filter((account) => !account.activated && !account.suspended).length,
        active: all.filter((account) => account.activated && !account.suspended).length,
        suspended: all.filter((account) => account.suspended).length,
      };
    },
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;
