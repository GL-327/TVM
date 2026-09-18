import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { accountsPath } from '../update/paths.ts';
import { readSealed, writeSealed } from './vault.ts';

/**
 * Accounts: who may use this TVM.
 *
 * Nobody gets in by signing up. A new account can sign in and see that it is
 * waiting; the dev switches it on from the Accounts screen.
 *
 * Passwords are salted scrypt digests and cannot be read back by anyone. The
 * ledger is sealed with the same AES-256-GCM vault as the other secrets.
 *
 * The dev account is built in. It has no password: you get into it with the
 * developer code, it is always switched on, and it cannot be suspended or
 * erased.
 */

export type AccountTier = 'stream' | 'stream-live';

export const ACCOUNT_TIERS: readonly AccountTier[] = ['stream', 'stream-live'];

export function isAccountTier(value: unknown): value is AccountTier {
  return typeof value === 'string' && (ACCOUNT_TIERS as readonly string[]).includes(value);
}

export type AccountRole = 'member' | 'dev';

export const DEV_ACCOUNT_ID = 'acc_dev';
/** Not an address, so nobody can register it or sign in to it with a password. */
const DEV_EMAIL = 'dev';

/** A code waiting to be typed in. Only a salted digest of it is kept. */
export interface EmailCode {
  digest: string;
  salt: string;
  sentAt: string;
  expiresAt: string;
  attempts: number;
}

export interface AccountRecord {
  id: string;
  /** Lowercased and trimmed; the unique key. */
  email: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  role: AccountRole;

  activated: boolean;
  activatedAt: string | null;
  tier: AccountTier | null;
  /** The dev's private note. Never shown to the account holder. */
  note: string | null;
  suspended: boolean;

  termsVersion: string | null;
  termsAcceptedAt: string | null;

  emailVerifiedAt: string | null;
  emailCode: EmailCode | null;
  /** Real-Debrid key for this account. Overrides the one saved on the machine. */
  rdToken: string | null;

  lastSeenAt: string | null;
  signIns: number;
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
export const EMAIL_CODE_MINUTES = 15;
export const EMAIL_CODE_RESEND_SECONDS = 60;
const EMAIL_CODE_ATTEMPTS = 5;

export function emptyAccounts(): AccountsLedger {
  return { version: 1, accounts: [], sessions: {} };
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Rejects obvious nonsense. Whether the address is real is what the email code is for. */
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

function codeDigest(code: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

/**
 * The session token, as sent by the interface or by Roku.
 *
 * Phones and the desktop send it as Authorization. Roku already uses that
 * header for the LAN token, so it sends the account as X-TVM-Account. The LAN
 * token is never treated as a session.
 */
export function accountSessionToken(
  authorization: string | undefined,
  accountHeader: string | undefined,
  lanToken?: string,
): string | undefined {
  const dedicated = typeof accountHeader === 'string' ? accountHeader.trim() : '';
  if (dedicated !== '') return dedicated;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return undefined;
  const token = authorization.slice(7).trim();
  if (token === '') return undefined;
  if (typeof lanToken === 'string' && lanToken.length >= 32 && token === lanToken) return undefined;
  return token;
}

export type AccountBlock = 'no_account' | 'suspended' | 'email_unverified' | 'awaiting_activation' | 'terms_required';

/**
 * Whether this account may use TVM right now, and if not, why.
 *
 * The email check only applies when this machine can send the code. Without
 * mail settings nobody could pass it.
 */
export function accountUsable(
  record: AccountRecord | null,
  termsVersion: string,
  emailRequired = false,
): { ok: boolean; reason: AccountBlock | null } {
  if (record === null) return { ok: false, reason: 'no_account' };
  if (record.role === 'dev') return { ok: true, reason: null };
  if (record.suspended) return { ok: false, reason: 'suspended' };
  if (emailRequired && record.emailVerifiedAt === null) return { ok: false, reason: 'email_unverified' };
  if (!record.activated || record.tier === null) return { ok: false, reason: 'awaiting_activation' };
  if (record.termsVersion !== termsVersion || record.termsAcceptedAt === null) return { ok: false, reason: 'terms_required' };
  return { ok: true, reason: null };
}

/** What an account holder may see about themselves. Never the hash, the salt or a key. */
export interface PublicAccount {
  id: string;
  email: string;
  displayName: string;
  role: AccountRole;
  activated: boolean;
  tier: AccountTier | null;
  suspended: boolean;
  createdAt: string;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  emailVerified: boolean;
  /** A code has been sent and has not expired. */
  emailCodeSent: boolean;
  /** Whether this account has its own Real-Debrid key. */
  rdKey: boolean;
}

function codeLive(code: EmailCode | null, at: Date): boolean {
  return code !== null && new Date(code.expiresAt).getTime() > at.getTime();
}

export function publicAccount(record: AccountRecord, at: Date = new Date()): PublicAccount {
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    role: record.role,
    activated: record.activated,
    tier: record.tier,
    suspended: record.suspended,
    createdAt: record.createdAt,
    termsVersion: record.termsVersion,
    termsAcceptedAt: record.termsAcceptedAt,
    emailVerified: record.emailVerifiedAt !== null,
    emailCodeSent: codeLive(record.emailCode, at),
    rdKey: record.rdToken !== null,
  };
}

/** The dev's view of an account. Still no password, and the Real-Debrid key only as its last four characters. */
export interface AdminAccount extends PublicAccount {
  activatedAt: string | null;
  lastSeenAt: string | null;
  signIns: number;
  lastClient: string | null;
  note: string | null;
  activeSessions: number;
  emailVerifiedAt: string | null;
  rdKeyHint: string | null;
}

function keyHint(token: string | null): string | null {
  if (token === null) return null;
  return token.length <= 4 ? '••••' : `••••${token.slice(-4)}`;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function readEmailCode(value: unknown): EmailCode | null {
  if (value === null || typeof value !== 'object') return null;
  const code = value as Partial<EmailCode>;
  if (typeof code.digest !== 'string' || typeof code.salt !== 'string'
    || typeof code.sentAt !== 'string' || typeof code.expiresAt !== 'string') return null;
  return {
    digest: code.digest,
    salt: code.salt,
    sentAt: code.sentAt,
    expiresAt: code.expiresAt,
    attempts: typeof code.attempts === 'number' ? code.attempts : 0,
  };
}

/** Fills in fields that older ledgers were written without. */
function readRecord(entry: AccountRecord): AccountRecord {
  const raw = entry as Partial<AccountRecord> & AccountRecord;
  return {
    ...raw,
    role: raw.role === 'dev' ? 'dev' : 'member',
    emailVerifiedAt: textOrNull(raw.emailVerifiedAt),
    emailCode: readEmailCode(raw.emailCode),
    rdToken: textOrNull(raw.rdToken),
  };
}

export function hydrateAccounts(raw: unknown): AccountsLedger {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyAccounts();
  const value = raw as Partial<AccountsLedger>;
  if (value.version !== 1 || !Array.isArray(value.accounts)) return emptyAccounts();
  const accounts = value.accounts
    .filter((entry): entry is AccountRecord =>
      entry !== null && typeof entry === 'object'
      && typeof (entry as AccountRecord).id === 'string'
      && typeof (entry as AccountRecord).email === 'string'
      && typeof (entry as AccountRecord).passwordHash === 'string')
    .map(readRecord);
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
  /** True when this machine can email a code, which makes verifying one compulsory. */
  emailRequired?: () => boolean;
  now?: () => Date;
}

export function createAccountsService(options: AccountsServiceOptions) {
  const { dataDir, termsVersion } = options;
  const now = options.now ?? (() => new Date());
  const emailRequired = (): boolean => options.emailRequired?.() === true;

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

  const findMember = (ledger: AccountsLedger, email: string): AccountRecord | null =>
    ledger.accounts.find((account) => account.email === email && account.role !== 'dev') ?? null;

  const replace = (ledger: AccountsLedger, record: AccountRecord): AccountsLedger => ({
    ...ledger,
    accounts: ledger.accounts.map((entry) => (entry.id === record.id ? record : entry)),
  });

  /** Members only. The dev account is not managed from the Accounts screen. */
  const member = (ledger: AccountsLedger, id: string): AccountRecord => {
    const record = ledger.accounts.find((entry) => entry.id === id);
    if (record === undefined) throw new Error('No such account.');
    if (record.role === 'dev') throw new Error('The dev account cannot be changed here.');
    return record;
  };

  const openSession = (
    ledger: AccountsLedger,
    record: AccountRecord,
    client: string | null,
  ): { token: string; ledger: AccountsLedger; record: AccountRecord } => {
    const token = randomBytes(32).toString('hex');
    const issued = now();
    const updated: AccountRecord = {
      ...record,
      lastSeenAt: issued.toISOString(),
      signIns: record.signIns + 1,
      lastClient: client ?? record.lastClient,
    };
    return {
      token,
      record: updated,
      ledger: {
        ...replace(ledger, updated),
        sessions: {
          ...ledger.sessions,
          [hashToken(token)]: {
            accountId: record.id,
            issuedAt: issued.toISOString(),
            expiresAt: new Date(issued.getTime() + SESSION_DAYS * 86_400_000).toISOString(),
            client,
          },
        },
      },
    };
  };

  const clientText = (value: unknown): string | null => (typeof value === 'string' ? value.slice(0, 200) : null);

  const lookup = (token: string | undefined): { ledger: AccountsLedger; record: AccountRecord } | null => {
    if (typeof token !== 'string' || token === '') return null;
    const ledger = prune(read());
    const session = ledger.sessions[hashToken(token)];
    if (session === undefined) return null;
    const record = ledger.accounts.find((entry) => entry.id === session.accountId);
    return record === undefined ? null : { ledger, record };
  };

  const toAdmin = (account: AccountRecord, sessions: number): AdminAccount => ({
    ...publicAccount(account, now()),
    activatedAt: account.activatedAt,
    lastSeenAt: account.lastSeenAt,
    signIns: account.signIns,
    lastClient: account.lastClient,
    note: account.note,
    activeSessions: sessions,
    emailVerifiedAt: account.emailVerifiedAt,
    rdKeyHint: keyHint(account.rdToken),
  });

  const adminView = (ledger: AccountsLedger, record: AccountRecord): AdminAccount =>
    toAdmin(record, Object.values(ledger.sessions).filter((session) => session.accountId === record.id).length);

  return {
    termsVersion,

    /** Creates an account that can sign in but cannot watch anything yet. */
    register(input: { email?: unknown; password?: unknown; displayName?: unknown; client?: string | null }): PublicAccount {
      const email = normalizeEmail(input.email);
      if (!emailLooksValid(email)) throw new Error('Enter a valid email address.');
      const problem = passwordProblem(input.password);
      if (problem !== null) throw new Error(problem);

      const ledger = prune(read());
      // Same answer whether or not the address exists, so signup cannot be
      // used to find out who has an account.
      if (findMember(ledger, email) !== null) throw new Error('That account could not be created. If it already exists, sign in instead.');

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
        role: 'member',
        activated: false,
        activatedAt: null,
        tier: null,
        note: null,
        suspended: false,
        termsVersion: null,
        termsAcceptedAt: null,
        emailVerifiedAt: null,
        emailCode: null,
        rdToken: null,
        lastSeenAt: null,
        signIns: 0,
        lastClient: clientText(input.client),
      };
      write({ ...ledger, accounts: [...ledger.accounts, record] });
      return publicAccount(record, now());
    },

    /**
     * Signs in with email and password. Works for an account that is not
     * switched on yet, so its holder can see they are waiting rather than
     * being told the password is wrong.
     */
    signIn(input: { email?: unknown; password?: unknown; client?: string | null }): { token: string; account: PublicAccount; usable: ReturnType<typeof accountUsable> } {
      const email = normalizeEmail(input.email);
      const password = typeof input.password === 'string' ? input.password : '';
      const ledger = prune(read());
      const record = findMember(ledger, email);

      // Hash either way, so a missing account and a wrong password take the
      // same time.
      const reference = record ?? {
        passwordHash: hashPassword('never-matches-this').hash,
        passwordSalt: 'x'.repeat(32),
      } as Pick<AccountRecord, 'passwordHash' | 'passwordSalt'>;
      const matched = passwordMatches(password, reference);
      if (record === null || !matched) throw new Error('That email address and password do not match.');

      const opened = openSession(ledger, record, clientText(input.client));
      write(opened.ledger);
      return {
        token: opened.token,
        account: publicAccount(opened.record, now()),
        usable: accountUsable(opened.record, termsVersion, emailRequired()),
      };
    },

    /**
     * Signs in to the dev account, creating it the first time. The caller
     * checks the developer code before calling this.
     */
    signInDev(input: { client?: string | null } = {}): { token: string; account: PublicAccount; usable: ReturnType<typeof accountUsable> } {
      const ledger = prune(read());
      const existing = ledger.accounts.find((entry) => entry.id === DEV_ACCOUNT_ID);
      const at = now().toISOString();
      const record: AccountRecord = existing !== undefined
        ? { ...existing, role: 'dev', activated: true, tier: 'stream-live', suspended: false }
        : {
        id: DEV_ACCOUNT_ID,
        email: DEV_EMAIL,
        displayName: 'Dev',
        passwordHash: '',
        passwordSalt: '',
        createdAt: at,
        role: 'dev',
        activated: true,
        activatedAt: at,
        tier: 'stream-live',
        note: null,
        suspended: false,
        termsVersion: null,
        termsAcceptedAt: null,
        emailVerifiedAt: null,
        emailCode: null,
        rdToken: null,
        lastSeenAt: null,
        signIns: 0,
        lastClient: null,
      };
      const base = existing === undefined ? { ...ledger, accounts: [...ledger.accounts, record] } : ledger;
      const opened = openSession(base, record, clientText(input.client));
      write(opened.ledger);
      return { token: opened.token, account: publicAccount(opened.record, now()), usable: accountUsable(opened.record, termsVersion) };
    },

    signOut(token: string): void {
      const ledger = prune(read());
      const key = hashToken(token);
      if (ledger.sessions[key] === undefined) return;
      const sessions = { ...ledger.sessions };
      delete sessions[key];
      write({ ...ledger, sessions });
    },

    /** The account behind a token, or null when unknown or expired. Refreshes last-seen once a day. */
    resolve(token: string | undefined): AccountRecord | null {
      const found = lookup(token);
      if (found === null) return null;
      const { ledger, record } = found;
      const seen = now().toISOString();
      if (record.lastSeenAt === null || record.lastSeenAt.slice(0, 10) !== seen.slice(0, 10)) {
        write(replace(ledger, { ...record, lastSeenAt: seen }));
        return { ...record, lastSeenAt: seen };
      }
      return record;
    },

    /** The Real-Debrid key to use for this session, if the account has its own. No side effects. */
    rdTokenFor(token: string | undefined): string | null {
      return lookup(token)?.record.rdToken ?? null;
    },

    /** Whether the dev account is signed in anywhere on this machine. */
    devSignedIn(): boolean {
      const ledger = prune(read());
      return Object.values(ledger.sessions).some((session) => session.accountId === DEV_ACCOUNT_ID);
    },

    acceptTerms(accountId: string): PublicAccount {
      const ledger = prune(read());
      const record = ledger.accounts.find((entry) => entry.id === accountId);
      if (record === undefined) throw new Error('No such account.');
      const updated: AccountRecord = { ...record, termsVersion, termsAcceptedAt: now().toISOString() };
      write(replace(ledger, updated));
      return publicAccount(updated, now());
    },

    usable(record: AccountRecord | null): ReturnType<typeof accountUsable> {
      return accountUsable(record, termsVersion, emailRequired());
    },

    // ---- Email codes ------------------------------------------------------

    /**
     * Makes a new six-digit code and returns it for the caller to email.
     * Only a salted digest is stored. One code a minute at most.
     */
    issueEmailCode(accountId: string): { code: string; email: string; expiresAt: string } {
      const ledger = prune(read());
      const record = member(ledger, accountId);
      if (record.emailVerifiedAt !== null) throw new Error('This email address is already verified.');
      const at = now();
      if (record.emailCode !== null) {
        const wait = EMAIL_CODE_RESEND_SECONDS - Math.floor((at.getTime() - new Date(record.emailCode.sentAt).getTime()) / 1000);
        if (wait > 0) throw new Error(`Wait ${wait} seconds before asking for another code.`);
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const salt = randomBytes(16).toString('hex');
      const expiresAt = new Date(at.getTime() + EMAIL_CODE_MINUTES * 60_000).toISOString();
      const emailCode: EmailCode = { digest: codeDigest(code, salt), salt, sentAt: at.toISOString(), expiresAt, attempts: 0 };
      write(replace(ledger, { ...record, emailCode }));
      return { code, email: record.email, expiresAt };
    },

    /** Forgets a code that could not be sent, so the next request is not made to wait. */
    cancelEmailCode(accountId: string): void {
      const ledger = prune(read());
      const record = ledger.accounts.find((entry) => entry.id === accountId);
      if (record === undefined || record.emailCode === null) return;
      write(replace(ledger, { ...record, emailCode: null }));
    },

    verifyEmailCode(accountId: string, input: unknown): PublicAccount {
      const ledger = prune(read());
      const record = member(ledger, accountId);
      if (record.emailVerifiedAt !== null) return publicAccount(record, now());
      const code = typeof input === 'string' ? input.replace(/\s+/g, '') : '';
      const pending = record.emailCode;
      if (pending === null || !codeLive(pending, now())) {
        if (pending !== null) write(replace(ledger, { ...record, emailCode: null }));
        throw new Error('That code has expired. Send a new one.');
      }
      const expected = Buffer.from(pending.digest, 'hex');
      const given = Buffer.from(codeDigest(code, pending.salt), 'hex');
      if (!/^\d{6}$/.test(code) || !timingSafeEqual(expected, given)) {
        const attempts = pending.attempts + 1;
        if (attempts >= EMAIL_CODE_ATTEMPTS) {
          write(replace(ledger, { ...record, emailCode: null }));
          throw new Error('Too many wrong codes. Send a new one.');
        }
        write(replace(ledger, { ...record, emailCode: { ...pending, attempts } }));
        throw new Error('That code is not right. Check the email and try again.');
      }
      const updated: AccountRecord = { ...record, emailVerifiedAt: now().toISOString(), emailCode: null };
      write(replace(ledger, updated));
      return publicAccount(updated, now());
    },

    // ---- Dev only ---------------------------------------------------------

    /** Every member account, newest first. Search is a plain substring over address and name. */
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
          if (account.role === 'dev') return false;
          if (search !== '' && !account.email.includes(search) && !account.displayName.toLowerCase().includes(search)) return false;
          if (state === 'waiting') return !account.activated && !account.suspended;
          if (state === 'active') return account.activated && !account.suspended;
          if (state === 'suspended') return account.suspended;
          return true;
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((account) => toAdmin(account, counts.get(account.id) ?? 0));
    },

    /** Switches an account on at a tier. This is the only route to using TVM. */
    activate(input: { id: string; tier: AccountTier; note?: string | null }): AdminAccount {
      if (!isAccountTier(input.tier)) throw new Error('Choose a valid tier.');
      const ledger = prune(read());
      const record = member(ledger, input.id);
      const updated: AccountRecord = {
        ...record,
        activated: true,
        activatedAt: record.activatedAt ?? now().toISOString(),
        tier: input.tier,
        suspended: false,
        note: input.note === undefined ? record.note : (input.note?.slice(0, 500) ?? null),
      };
      write(replace(ledger, updated));
      return adminView(ledger, updated);
    },

    /** Turns Live TV on or off for an account that is already switched on. */
    setLiveTv(id: string, enabled: boolean): AdminAccount {
      const ledger = prune(read());
      const record = member(ledger, id);
      if (!record.activated || record.tier === null) throw new Error('Switch the account on first.');
      const updated: AccountRecord = { ...record, tier: enabled ? 'stream-live' : 'stream' };
      write(replace(ledger, updated));
      return adminView(ledger, updated);
    },

    /** Saves or clears this account's own Real-Debrid key. */
    setRdToken(id: string, token: string | null): AdminAccount {
      const ledger = prune(read());
      const record = member(ledger, id);
      const trimmed = typeof token === 'string' ? token.trim() : '';
      if (trimmed.length > 200 || /\s/.test(trimmed)) throw new Error('That does not look like a Real-Debrid key.');
      const updated: AccountRecord = { ...record, rdToken: trimmed === '' ? null : trimmed };
      write(replace(ledger, updated));
      return adminView(ledger, updated);
    },

    /** For an address the dev knows is right, or on a machine that cannot send codes. */
    setEmailVerified(id: string, verified: boolean): AdminAccount {
      const ledger = prune(read());
      const record = member(ledger, id);
      const updated: AccountRecord = {
        ...record,
        emailVerifiedAt: verified ? (record.emailVerifiedAt ?? now().toISOString()) : null,
        emailCode: null,
      };
      write(replace(ledger, updated));
      return adminView(ledger, updated);
    },

    /** Switches an account off without deleting it. Its sessions end straight away. */
    setSuspended(id: string, suspended: boolean): AdminAccount {
      const ledger = prune(read());
      const record = member(ledger, id);
      const updated: AccountRecord = { ...record, suspended, activated: suspended ? false : record.activated };
      const sessions = { ...ledger.sessions };
      if (suspended) {
        for (const [key, session] of Object.entries(sessions)) {
          if (session.accountId === id) delete sessions[key];
        }
      }
      const next = { ...replace(ledger, updated), sessions };
      write(next);
      return adminView(next, updated);
    },

    setNote(id: string, note: string | null): AdminAccount {
      const ledger = prune(read());
      const record = member(ledger, id);
      const updated: AccountRecord = { ...record, note: note === null ? null : note.slice(0, 500) };
      write(replace(ledger, updated));
      return adminView(ledger, updated);
    },

    /** Deletes an account and its sessions, for a UK GDPR erasure request. */
    erase(id: string): void {
      const ledger = prune(read());
      if (id === DEV_ACCOUNT_ID) throw new Error('The dev account cannot be erased.');
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
