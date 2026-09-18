import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { accountsPath } from '../update/paths.ts';
import {
  accountUsable,
  accountSessionToken,
  createAccountsService,
  DEV_ACCOUNT_ID,
  emailLooksValid,
  hashPassword,
  hydrateAccounts,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  passwordMatches,
  passwordProblem,
  type AccountRecord,
} from './accounts.ts';

const TERMS = '2026-09-15';
const dirs: string[] = [];

async function service() {
  const dir = await mkdtemp(join(tmpdir(), 'tvm-accounts-'));
  dirs.push(dir);
  return { dir, accounts: createAccountsService({ dataDir: dir, termsVersion: TERMS }) };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('passwords', () => {
  it('is never stored in a form anyone can read back', async () => {
    const { dir, accounts } = await service();
    accounts.register({ email: 'Ada@Example.com', password: 'correct horse battery', displayName: 'Ada' });

    // Not on disk in any form: the file is sealed, and what is sealed is a
    // one-way digest rather than the password itself.
    const blob = readFileSync(accountsPath(dir), 'utf8');
    expect(blob).not.toContain('correct horse battery');
    expect(blob).not.toContain('ada@example.com');

    // Not in the owner's view either. There is deliberately no screen that
    // could show a password, because nothing stored could produce one.
    const listed = accounts.list()[0]!;
    expect(JSON.stringify(listed)).not.toContain('correct horse battery');
    expect(Object.keys(listed)).not.toContain('passwordHash');
    expect(Object.keys(listed)).not.toContain('passwordSalt');
  });

  it('salts each account separately, so two identical passwords do not match', () => {
    const first = hashPassword('the same password');
    const second = hashPassword('the same password');
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    expect(passwordMatches('the same password', { passwordHash: first.hash, passwordSalt: first.salt })).toBe(true);
    expect(passwordMatches('the same password', { passwordHash: second.hash, passwordSalt: second.salt })).toBe(true);
  });

  it('rejects the wrong password and anything malformed', () => {
    const { hash, salt } = hashPassword('a real password');
    expect(passwordMatches('a real password', { passwordHash: hash, passwordSalt: salt })).toBe(true);
    expect(passwordMatches('a real passwore', { passwordHash: hash, passwordSalt: salt })).toBe(false);
    expect(passwordMatches('', { passwordHash: hash, passwordSalt: salt })).toBe(false);
    expect(passwordMatches('x', { passwordHash: 'not-hex', passwordSalt: salt })).toBe(false);
  });

  it('asks for a length worth asking for', () => {
    expect(passwordProblem('short')).toMatch(new RegExp(String(MIN_PASSWORD_LENGTH)));
    expect(passwordProblem('')).toBe('Enter a password.');
    expect(passwordProblem(undefined)).toBe('Enter a password.');
    expect(passwordProblem('x'.repeat(201))).toMatch(/too long/);
    expect(passwordProblem('x'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });
});

describe('addresses', () => {
  it('treats an address as one address however it was typed', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
    expect(normalizeEmail(42)).toBe('');
  });

  it('rejects obvious nonsense without pretending to validate the RFC', () => {
    expect(emailLooksValid('ada@example.com')).toBe(true);
    expect(emailLooksValid('ada@example')).toBe(false);
    expect(emailLooksValid('ada example.com')).toBe(false);
    expect(emailLooksValid('@example.com')).toBe(false);
    expect(emailLooksValid(`${'x'.repeat(250)}@example.com`)).toBe(false);
  });
});

describe('signing up', () => {
  it('creates an account that can do nothing at all', async () => {
    const { accounts } = await service();
    const created = accounts.register({ email: 'ada@example.com', password: 'correct horse battery' });
    // The whole access model: signing up is a request, not an entitlement.
    expect(created.activated).toBe(false);
    expect(created.tier).toBeNull();
    expect(accounts.usable(accounts.list()[0] as unknown as AccountRecord).ok).toBe(false);
  });

  it('does not reveal whether an address already has an account', async () => {
    const { accounts } = await service();
    accounts.register({ email: 'ada@example.com', password: 'correct horse battery' });
    // Saying "already registered" would turn signup into a way of testing
    // which addresses exist.
    expect(() => accounts.register({ email: 'ada@example.com', password: 'another good password' }))
      .toThrow(/could not be created/i);
  });

  it('refuses a bad address or a weak password', async () => {
    const { accounts } = await service();
    expect(() => accounts.register({ email: 'nope', password: 'correct horse battery' })).toThrow(/valid email/i);
    expect(() => accounts.register({ email: 'ada@example.com', password: 'short' })).toThrow(/at least/i);
  });
});

describe('signing in', () => {
  it('issues a session and counts the sign-in', async () => {
    const { accounts } = await service();
    accounts.register({ email: 'ada@example.com', password: 'correct horse battery' });
    const result = accounts.signIn({ email: 'ada@example.com', password: 'correct horse battery', client: 'TVM-iOS' });
    expect(result.token).toHaveLength(64);
    expect(accounts.resolve(result.token)?.email).toBe('ada@example.com');
    expect(accounts.list()[0]!.signIns).toBe(1);
    expect(accounts.list()[0]!.lastClient).toBe('TVM-iOS');
  });

  it('gives the same answer for a wrong password and an account that does not exist', async () => {
    const { accounts } = await service();
    accounts.register({ email: 'ada@example.com', password: 'correct horse battery' });
    const wrong = (): unknown => accounts.signIn({ email: 'ada@example.com', password: 'nope nope nope' });
    const missing = (): unknown => accounts.signIn({ email: 'nobody@example.com', password: 'nope nope nope' });
    expect(wrong).toThrow('That email address and password do not match.');
    expect(missing).toThrow('That email address and password do not match.');
  });

  it('lets an unactivated holder sign in, and still refuses them TVM', async () => {
    // They need to see that they are waiting, rather than being told their
    // password is wrong.
    const { accounts } = await service();
    accounts.register({ email: 'ada@example.com', password: 'correct horse battery' });
    const result = accounts.signIn({ email: 'ada@example.com', password: 'correct horse battery' });
    expect(result.account.activated).toBe(false);
    expect(result.usable).toEqual({ ok: false, reason: 'awaiting_activation' });
  });

  it('forgets a token on sign out', async () => {
    const { accounts } = await service();
    accounts.register({ email: 'ada@example.com', password: 'correct horse battery' });
    const { token } = accounts.signIn({ email: 'ada@example.com', password: 'correct horse battery' });
    accounts.signOut(token);
    expect(accounts.resolve(token)).toBeNull();
  });

  it('stores only a digest of the session token', async () => {
    const { dir, accounts } = await service();
    accounts.register({ email: 'ada@example.com', password: 'correct horse battery' });
    const { token } = accounts.signIn({ email: 'ada@example.com', password: 'correct horse battery' });
    // A stolen data folder must not yield usable sessions.
    expect(readFileSync(accountsPath(dir), 'utf8')).not.toContain(token);
  });

  it('rejects an unknown or empty token', async () => {
    const { accounts } = await service();
    expect(accounts.resolve('')).toBeNull();
    expect(accounts.resolve(undefined)).toBeNull();
    expect(accounts.resolve('f'.repeat(64))).toBeNull();
  });
});

describe('who may actually use TVM', () => {
  const base: AccountRecord = {
    id: 'a', email: 'a@b.c', displayName: 'A', passwordHash: '', passwordSalt: '',
    createdAt: '', role: 'member', activated: true, activatedAt: '', tier: 'stream', note: null, suspended: false,
    termsVersion: TERMS, termsAcceptedAt: '2026-09-15T00:00:00.000Z',
    emailVerifiedAt: null, emailCode: null, rdToken: null,
    lastSeenAt: null, signIns: 0, lastClient: null,
  };

  it('needs activation, a tier, current terms and no suspension', () => {
    expect(accountUsable(base, TERMS)).toEqual({ ok: true, reason: null });
    expect(accountUsable(null, TERMS).reason).toBe('no_account');
    expect(accountUsable({ ...base, suspended: true }, TERMS).reason).toBe('suspended');
    expect(accountUsable({ ...base, activated: false }, TERMS).reason).toBe('awaiting_activation');
    // Activated but no tier is not a usable state either.
    expect(accountUsable({ ...base, tier: null }, TERMS).reason).toBe('awaiting_activation');
    expect(accountUsable({ ...base, termsAcceptedAt: null }, TERMS).reason).toBe('terms_required');
  });

  it('requires acceptance again when the terms change', () => {
    expect(accountUsable({ ...base, termsVersion: '2020-01-01' }, TERMS).reason).toBe('terms_required');
  });

  it('asks for a verified email only when this machine can send the code', () => {
    expect(accountUsable(base, TERMS, false).ok).toBe(true);
    expect(accountUsable(base, TERMS, true).reason).toBe('email_unverified');
    expect(accountUsable({ ...base, emailVerifiedAt: '2026-09-18T00:00:00.000Z' }, TERMS, true).ok).toBe(true);
    // Suspension still wins, so a switched-off account is not asked for a code.
    expect(accountUsable({ ...base, suspended: true }, TERMS, true).reason).toBe('suspended');
  });

  it('lets the dev account straight in', () => {
    const dev: AccountRecord = { ...base, role: 'dev', termsAcceptedAt: null, termsVersion: null };
    expect(accountUsable(dev, TERMS, true)).toEqual({ ok: true, reason: null });
  });
});

describe('the dev account', () => {
  it('is created on first sign-in, switched on, and not a member', async () => {
    const { accounts } = await service();
    const first = accounts.signInDev({ client: 'TVM-desktop' });
    expect(first.account.role).toBe('dev');
    expect(first.account.id).toBe(DEV_ACCOUNT_ID);
    expect(first.usable).toEqual({ ok: true, reason: null });
    expect(accounts.resolve(first.token)?.role).toBe('dev');

    // Signing in again reuses the same account rather than making another.
    const second = accounts.signInDev();
    expect(second.account.id).toBe(DEV_ACCOUNT_ID);
    expect(accounts.list()).toHaveLength(0);
    expect(accounts.summary().total).toBe(0);
  });

  it('cannot be reached with a password', async () => {
    const { accounts } = await service();
    accounts.signInDev();
    expect(() => accounts.signIn({ email: 'dev', password: '' })).toThrow(/do not match/);
    expect(() => accounts.signIn({ email: 'dev', password: 'anything at all' })).toThrow(/do not match/);
  });

  it('cannot be suspended, erased or edited from the Accounts screen', async () => {
    const { accounts } = await service();
    const { token } = accounts.signInDev();
    expect(() => accounts.setSuspended(DEV_ACCOUNT_ID, true)).toThrow(/dev account/);
    expect(() => accounts.erase(DEV_ACCOUNT_ID)).toThrow(/dev account/);
    expect(() => accounts.activate({ id: DEV_ACCOUNT_ID, tier: 'stream' })).toThrow(/dev account/);
    expect(() => accounts.setRdToken(DEV_ACCOUNT_ID, 'abc')).toThrow(/dev account/);
    expect(accounts.resolve(token)?.role).toBe('dev');
  });

  it('counts as signed in until its last session ends', async () => {
    const { accounts } = await service();
    expect(accounts.devSignedIn()).toBe(false);
    const desktop = accounts.signInDev();
    const phone = accounts.signInDev();
    expect(accounts.devSignedIn()).toBe(true);
    accounts.signOut(desktop.token);
    expect(accounts.devSignedIn()).toBe(true);
    accounts.signOut(phone.token);
    expect(accounts.devSignedIn()).toBe(false);
  });

  it('does not count a member session', async () => {
    const { accounts } = await service();
    accounts.register({ email: 'ada@example.com', password: 'correct horse battery' });
    accounts.signIn({ email: 'ada@example.com', password: 'correct horse battery' });
    expect(accounts.devSignedIn()).toBe(false);
  });
});

describe('email codes', () => {
  async function waiting(options: { at?: () => Date } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-accounts-'));
    dirs.push(dir);
    const accounts = createAccountsService({ dataDir: dir, termsVersion: TERMS, emailRequired: () => true, now: options.at });
    const created = accounts.register({ email: 'ada@example.com', password: 'correct horse battery' });
    return { dir, accounts, id: created.id };
  }

  it('issues a six-digit code and stores only a digest of it', async () => {
    const { dir, accounts, id } = await waiting();
    const issued = accounts.issueEmailCode(id);
    expect(issued.code).toMatch(/^\d{6}$/);
    expect(issued.email).toBe('ada@example.com');
    expect(accounts.list()[0]!.emailCodeSent).toBe(true);
    const raw = JSON.stringify(accounts.list());
    expect(raw).not.toContain(issued.code);
    expect(readFileSync(accountsPath(dir), 'utf8')).not.toContain(issued.code);
  });

  it('verifies the right code once, and the account moves on to waiting for the dev', async () => {
    const { accounts, id } = await waiting();
    const { code } = accounts.issueEmailCode(id);
    const { token } = accounts.signIn({ email: 'ada@example.com', password: 'correct horse battery' });
    expect(accounts.usable(accounts.resolve(token)).reason).toBe('email_unverified');

    const verified = accounts.verifyEmailCode(id, ` ${code.slice(0, 3)} ${code.slice(3)} `);
    expect(verified.emailVerified).toBe(true);
    expect(verified.emailCodeSent).toBe(false);
    expect(accounts.usable(accounts.resolve(token)).reason).toBe('awaiting_activation');
    expect(() => accounts.issueEmailCode(id)).toThrow(/already verified/);
  });

  it('refuses a wrong code and gives up after five tries', async () => {
    const { accounts, id } = await waiting();
    const { code } = accounts.issueEmailCode(id);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect(() => accounts.verifyEmailCode(id, wrong)).toThrow(/not right/);
    }
    expect(() => accounts.verifyEmailCode(id, wrong)).toThrow(/Too many/);
    // The right code no longer works either; a new one has to be sent.
    expect(() => accounts.verifyEmailCode(id, code)).toThrow(/expired/);
    expect(() => accounts.verifyEmailCode(id, 'abcdef')).toThrow();
  });

  it('expires a code after fifteen minutes and makes you wait a minute between codes', async () => {
    let clock = new Date('2026-09-18T10:00:00.000Z');
    const { accounts, id } = await waiting({ at: () => clock });
    const { code } = accounts.issueEmailCode(id);
    expect(() => accounts.issueEmailCode(id)).toThrow(/Wait 60 seconds/);
    clock = new Date('2026-09-18T10:00:45.000Z');
    expect(() => accounts.issueEmailCode(id)).toThrow(/Wait 15 seconds/);
    clock = new Date('2026-09-18T10:16:00.000Z');
    expect(() => accounts.verifyEmailCode(id, code)).toThrow(/expired/);
    expect(accounts.issueEmailCode(id).code).toMatch(/^\d{6}$/);
  });

  it('forgets a code that could not be sent', async () => {
    const { accounts, id } = await waiting();
    accounts.issueEmailCode(id);
    accounts.cancelEmailCode(id);
    expect(accounts.list()[0]!.emailCodeSent).toBe(false);
    expect(accounts.issueEmailCode(id).code).toMatch(/^\d{6}$/);
  });

  it('can be marked verified by the dev instead', async () => {
    const { accounts, id } = await waiting();
    expect(accounts.setEmailVerified(id, true).emailVerified).toBe(true);
    expect(accounts.setEmailVerified(id, false).emailVerified).toBe(false);
  });
});

describe('what the dev sets per account', () => {
  it('keeps a Real-Debrid key for the account and only ever shows its end', async () => {
    const { accounts } = await service();
    const created = accounts.register({ email: 'ada@example.com', password: 'correct horse battery' });
    const { token } = accounts.signIn({ email: 'ada@example.com', password: 'correct horse battery' });
    expect(accounts.rdTokenFor(token)).toBeNull();

    const saved = accounts.setRdToken(created.id, '  ABCDEFGHIJKLMNOPQRSTUVWXYZ1234  ');
    expect(saved.rdKey).toBe(true);
    expect(saved.rdKeyHint).toBe('••••1234');
    expect(JSON.stringify(saved)).not.toContain('ABCDEFGHIJ');
    expect(accounts.rdTokenFor(token)).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ1234');
    expect(accounts.rdTokenFor(undefined)).toBeNull();

    expect(accounts.setRdToken(created.id, '').rdKey).toBe(false);
    expect(accounts.rdTokenFor(token)).toBeNull();
    expect(() => accounts.setRdToken(created.id, 'has a space')).toThrow(/Real-Debrid key/);
  });

  it('turns Live TV on and off for an account that is switched on', async () => {
    const { accounts } = await service();
    const created = accounts.register({ email: 'ada@example.com', password: 'correct horse battery' });
    expect(() => accounts.setLiveTv(created.id, true)).toThrow(/Switch the account on/);
    accounts.activate({ id: created.id, tier: 'stream' });
    expect(accounts.setLiveTv(created.id, true).tier).toBe('stream-live');
    expect(accounts.setLiveTv(created.id, false).tier).toBe('stream');
  });

  it('reads a ledger written before these fields existed', async () => {
    const { accounts } = await service();
    const created = accounts.register({ email: 'ada@example.com', password: 'correct horse battery' });
    const old = hydrateAccounts({
      version: 1,
      accounts: [{ ...accounts.list()[0]!, passwordHash: 'aa', passwordSalt: 'bb', role: undefined, emailVerifiedAt: undefined, emailCode: undefined, rdToken: undefined }],
      sessions: {},
    });
    expect(old.accounts[0]).toMatchObject({ id: created.id, role: 'member', emailVerifiedAt: null, emailCode: null, rdToken: null });
  });
});

describe('how the session arrives', () => {
  const lan = 'a'.repeat(32);
  const session = 'b'.repeat(64);

  it('reads the dedicated Roku header first, so Authorization can stay the LAN token', () => {
    expect(accountSessionToken(`Bearer ${lan}`, session, lan)).toBe(session);
  });

  it('does not treat the LAN device token as an account session', () => {
    expect(accountSessionToken(`Bearer ${lan}`, undefined, lan)).toBeUndefined();
  });

  it('still accepts Authorization from the phones and the desktop', () => {
    expect(accountSessionToken(`Bearer ${session}`, undefined, lan)).toBe(session);
    expect(accountSessionToken(undefined, undefined, lan)).toBeUndefined();
  });
});

describe('the owner view', () => {
  async function populated() {
    const { accounts } = await service();
    accounts.register({ email: 'ada@example.com', password: 'correct horse battery', displayName: 'Ada Lovelace' });
    accounts.register({ email: 'grace@example.com', password: 'another fine password', displayName: 'Grace Hopper' });
    accounts.register({ email: 'alan@example.net', password: 'yet another password', displayName: 'Alan Turing' });
    return accounts;
  }

  it('lists everyone, newest first', async () => {
    const accounts = await populated();
    expect(accounts.list()).toHaveLength(3);
    expect(accounts.list()[0]!.email).toBe('alan@example.net');
  });

  it('searches address and name', async () => {
    const accounts = await populated();
    expect(accounts.list({ search: 'example.net' })).toHaveLength(1);
    expect(accounts.list({ search: 'grace' })).toHaveLength(1);
    expect(accounts.list({ search: 'hopper' })).toHaveLength(1);
    expect(accounts.list({ search: 'nobody' })).toHaveLength(0);
  });

  it('filters by what the owner needs to act on', async () => {
    const accounts = await populated();
    const ada = accounts.list({ search: 'ada@' })[0]!;
    accounts.activate({ id: ada.id, tier: 'stream-live' });
    expect(accounts.list({ state: 'waiting' })).toHaveLength(2);
    expect(accounts.list({ state: 'active' })).toHaveLength(1);
    expect(accounts.summary()).toMatchObject({ total: 3, waiting: 2, active: 1, suspended: 0 });
  });

  it('activation is what makes an account work', async () => {
    const accounts = await populated();
    const ada = accounts.list({ search: 'ada@' })[0]!;
    const activated = accounts.activate({ id: ada.id, tier: 'stream-live', note: 'paid by bank transfer' });
    expect(activated.activated).toBe(true);
    expect(activated.tier).toBe('stream-live');
    expect(activated.note).toBe('paid by bank transfer');
  });

  it('suspending cuts existing sessions immediately', async () => {
    const accounts = await populated();
    const ada = accounts.list({ search: 'ada@' })[0]!;
    accounts.activate({ id: ada.id, tier: 'stream' });
    const { token } = accounts.signIn({ email: 'ada@example.com', password: 'correct horse battery' });
    expect(accounts.resolve(token)).not.toBeNull();

    accounts.setSuspended(ada.id, true);
    // Revoking access must not wait 30 days for a token to lapse.
    expect(accounts.resolve(token)).toBeNull();
    expect(accounts.list({ state: 'suspended' })).toHaveLength(1);
  });

  it('erases an account and its sessions, for a GDPR request', async () => {
    const accounts = await populated();
    const ada = accounts.list({ search: 'ada@' })[0]!;
    accounts.activate({ id: ada.id, tier: 'stream' });
    const { token } = accounts.signIn({ email: 'ada@example.com', password: 'correct horse battery' });

    accounts.erase(ada.id);
    expect(accounts.list({ search: 'ada@' })).toHaveLength(0);
    expect(accounts.resolve(token)).toBeNull();
  });

  it('refuses an invalid tier', async () => {
    const accounts = await populated();
    const ada = accounts.list({ search: 'ada@' })[0]!;
    expect(() => accounts.activate({ id: ada.id, tier: 'free' as never })).toThrow(/valid tier/i);
  });
});

describe('terms', () => {
  it('records acceptance against the version that was shown', async () => {
    const { accounts } = await service();
    const created = accounts.register({ email: 'ada@example.com', password: 'correct horse battery' });
    expect(created.termsAcceptedAt).toBeNull();
    const accepted = accounts.acceptTerms(created.id);
    expect(accepted.termsVersion).toBe(TERMS);
    expect(accepted.termsAcceptedAt).not.toBeNull();
  });
});
