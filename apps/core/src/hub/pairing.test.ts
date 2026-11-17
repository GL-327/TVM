import { describe, expect, it, vi } from 'vitest';
import { createPairLimiter, normalizeUserCode } from './pairing.ts';
import { revoke } from './devices.ts';
import { bucket } from './store.ts';
import { fixture, registrationInput } from './testSupport.ts';

vi.mock('../providers/secureFile.ts', async original => ({ ...await original<typeof import('../providers/secureFile.ts')>(), windowsProtect: (value: string) => value }));

function pairingFixture() {
  const f = fixture(); const signed = f.accounts.signInDev();
  const viewer = { accountId: signed.account.id, name: signed.account.displayName, role: signed.account.role };
  const start = () => f.pairing.start(registrationInput(), 'http://localhost:7345');
  const lookup = (code: string, session = signed.token, ip = 'ip-a') => f.pairing.lookup(code, viewer, session, ip);
  const approve = (code: string) => f.pairing.decide(code, true, viewer, signed.token, 'ip-a');
  return { ...f, signed, viewer, start, lookup, approve };
}
describe('Hub device pairing', () => {
  it('uses the specified alphabet/format and stores only salted user hashes and hashed device codes', () => {
    const f = pairingFixture(); const p = f.start();
    expect(p.userCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    expect(p.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p).toMatchObject({ expiresIn: 600, interval: 5 });
    expect(p.verificationUriComplete).toContain(p.userCode);
    expect(f.lookup(p.userCode.toLowerCase()).request.name).toBe('Living room');
    expect(f.lookup(p.userCode.replace('-', '')).request.platform).toBe('roku');
    const stored = JSON.stringify(f.store.read());
    expect(stored).not.toContain(p.userCode); expect(stored).not.toContain(normalizeUserCode(p.userCode));
    expect(stored).not.toContain(p.deviceCode); expect(stored).not.toContain('client-a');
  });
  it('returns pending and persists increasing slow_down intervals', () => {
    const f = pairingFixture(); const p = f.start();
    expect(() => f.pairing.token(p.deviceCode)).toThrow(expect.objectContaining({ code: 'authorization_pending' }));
    f.advance(1000); expect(() => f.pairing.token(p.deviceCode)).toThrow(expect.objectContaining({ code: 'slow_down' }));
    expect(Object.values(f.store.read().unassignedPairs)[0]!.interval).toBe(10);
    f.advance(5000); expect(() => f.pairing.token(p.deviceCode)).toThrow(expect.objectContaining({ code: 'slow_down' }));
    expect(Object.values(f.store.read().unassignedPairs)[0]!.interval).toBe(15);
    f.advance(15_000); expect(() => f.pairing.token(p.deviceCode)).toThrow(expect.objectContaining({ code: 'authorization_pending' }));
  });
  it('approves once, creates an ordinary session, and atomically redeems a device secret once', async () => {
    const f = pairingFixture(); const p = f.start(); expect(f.approve(p.userCode)).toEqual({ ok: true });
    const doc = f.store.read(); expect(Object.keys(doc.unassignedPairs)).toHaveLength(0);
    const pair = Object.values(doc.accounts[f.viewer.accountId]!.pairs)[0]!;
    expect(pair.status).toBe('approved'); expect(pair.installationId).toMatch(/^inst_/);
    expect(f.accounts.resolve(pair.accountToken!)).toMatchObject({ id: f.viewer.accountId });
    // Credential generation is delayed until delivery: no raw device secret is ever persisted.
    expect(doc.accounts[f.viewer.accountId]!.sessions[pair.installationId!]).toBeUndefined();
    const outcomes = await Promise.allSettled([0, 1].map(() => Promise.resolve().then(() => f.pairing.token(p.deviceCode))));
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    const fulfilled = outcomes.find(o => o.status === 'fulfilled')!;
    if (fulfilled.status !== 'fulfilled') throw new Error('Expected token');
    expect(f.resolve(`${fulfilled.value.installation.id}.${fulfilled.value.deviceSecret}`).accountId).toBe(f.viewer.accountId);
    expect(f.accounts.resolve(fulfilled.value.accountToken)?.id).toBe(f.viewer.accountId);
    expect(JSON.stringify(f.store.read())).not.toContain(fulfilled.value.deviceSecret);
    expect(Object.values(f.store.read().accounts[f.viewer.accountId]!.pairs)[0]!.accountToken).toBeNull();
    expect(() => f.pairing.token(p.deviceCode)).toThrow(expect.objectContaining({ code: 'expired_token' }));
    expect(() => f.approve(p.userCode)).toThrow(expect.objectContaining({ code: 'not_found' }));
  });
  it('denies a request without minting an installation', () => {
    const f = pairingFixture(); const p = f.start();
    f.pairing.decide(p.userCode, false, f.viewer, f.signed.token, 'ip-a');
    expect(() => f.pairing.token(p.deviceCode)).toThrow(expect.objectContaining({ code: 'access_denied' }));
    expect(Object.keys(f.store.read().accounts[f.viewer.accountId]!.installations)).toHaveLength(0);
  });
  it.each([false, true])('expires after 600 seconds (approved=%s)', approved => {
    const f = pairingFixture(); const p = f.start(); if (approved) f.approve(p.userCode);
    f.advance(600_000);
    expect(() => f.pairing.token(p.deviceCode)).toThrow(expect.objectContaining({ code: 'expired_token' }));
    expect(() => f.lookup(p.userCode)).toThrow(expect.objectContaining({ code: 'not_found' }));
  });
  it('keeps approval isolated from another account and refuses a second decision', () => {
    const f = pairingFixture(); const p = f.start(); f.approve(p.userCode);
    expect(() => f.pairing.lookup(p.userCode, f.other, 'session-other', 'ip-b')).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => f.pairing.decide(p.userCode, false, f.viewer, f.signed.token, 'ip-a')).toThrow(expect.objectContaining({ status: 404 }));
  });
  it('refuses delivery if its installation or delegated account session is revoked', () => {
    const f = pairingFixture(); const p = f.start(); f.approve(p.userCode);
    const pair = Object.values(f.store.read().accounts[f.viewer.accountId]!.pairs)[0]!;
    f.store.transact(d => revoke(bucket(d, f.viewer.accountId), pair.installationId!, f.viewer, f.now()));
    expect(() => f.pairing.token(p.deviceCode)).toThrow(expect.objectContaining({ code: 'access_denied' }));
    expect(f.accounts.resolve(pair.accountToken!)).toBeNull();
    const second = f.start(); f.approve(second.userCode);
    const secondPair = Object.values(f.store.read().accounts[f.viewer.accountId]!.pairs).find(p => p.status === 'approved')!;
    f.accounts.signOut(secondPair.accountToken!);
    expect(() => f.pairing.token(second.deviceCode)).toThrow(expect.objectContaining({ code: 'access_denied' }));
  });
  it('limits wrong codes per session while other sessions can continue', () => {
    const f = pairingFixture(); const p = f.start();
    for (let i = 0; i < 5; i++) expect(() => f.lookup('AAAAAAAA')).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => f.lookup(p.userCode)).toThrow(expect.objectContaining({ code: 'rate_limited' }));
    expect(f.lookup(p.userCode, 'another-session', 'ip-b').request.name).toBe('Living room');
    f.advance(900_000); expect(() => f.lookup('AAAAAAAA')).toThrow(expect.objectContaining({ status: 404 }));
  });
  it('limits an IP to ten wrong attempts across sessions without blocking another IP', () => {
    let at = 0; const limiter = createPairLimiter(() => at);
    for (let i = 0; i < 10; i++) { limiter.check(`session-${i}`, 'ip-a'); limiter.wrong(`session-${i}`, 'ip-a'); }
    expect(() => limiter.check('fresh', 'ip-a')).toThrow(expect.objectContaining({ status: 429 }));
    expect(() => limiter.check('fresh', 'ip-b')).not.toThrow();
    at = 900_000; expect(() => limiter.check('fresh', 'ip-a')).not.toThrow();
  });
  it('does not mint delegated sessions from an invalid approver token', () => {
    const f = pairingFixture(); expect(() => f.accounts.openPairedSession('invalid-token')).toThrow();
  });
});
