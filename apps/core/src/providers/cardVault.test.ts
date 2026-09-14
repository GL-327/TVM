import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cvcOk, expiryOk, lastFour, luhnOk } from './card.ts';
import {
  cardBrand,
  cardFieldsPresent,
  emptyCardVault,
  parseCardIntake,
  publicPaymentMethod,
  readSealedPan,
  rememberToken,
  tokenizeCard,
} from './cardVault.ts';
import { openJson } from './vault.ts';

describe('card format', () => {
  it('accepts a Luhn-valid PAN and rejects junk', () => {
    expect(luhnOk('4242424242424242')).toBe(true);
    expect(luhnOk('4242 4242 4242 4242')).toBe(true);
    expect(luhnOk('378282246310005')).toBe(true);
    expect(luhnOk('1234567890123456')).toBe(false);
    expect(luhnOk('abc')).toBe(false);
    expect(lastFour('4242 4242 4242 4242')).toBe('4242');
    expect(cardBrand('4242424242424242')).toBe('visa');
    expect(cardBrand('378282246310005')).toBe('amex');
    expect(cardBrand('5555555555554444')).toBe('mastercard');
  });

  it('checks expiry, CVC and optional ZIP', () => {
    expect(expiryOk('12/99', new Date('2026-08-17'))).toBe(true);
    expect(expiryOk('01/20', new Date('2026-08-17'))).toBe(false);
    expect(cvcOk('123')).toBe(true);
    expect(cvcOk('12')).toBe(false);
    expect(parseCardIntake({
      name: 'Ada Lovelace',
      number: '4242 4242 4242 4242',
      expiry: '12/99',
      cvc: '123',
      zip: 'SW1A 1AA',
    }).ok).toBe(true);
    expect(parseCardIntake({ name: 'A', number: '1111', expiry: '12/99', cvc: '123' }).ok).toBe(false);
    expect(cardFieldsPresent({})).toBe(false);
  });
});

describe('card vault', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('tokenizes a PAN, encrypts it at rest, and only exposes last4/brand/expiry/token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-card-vault-'));
    dirs.push(dir);
    const pan = '4242424242424242';
    const minted = tokenizeCard(dir, {
      name: 'Ada Lovelace',
      number: pan,
      expiry: '12/99',
      cvc: '123',
      zip: 'E1 6AN',
    });
    expect(minted.token.last4).toBe('4242');
    expect(minted.token.brand).toBe('visa');
    expect(minted.token.expiry).toBe('12/99');
    expect(minted.token.tokenId.startsWith('tok_')).toBe(true);
    expect(JSON.stringify(minted.token)).not.toContain(pan);
    expect(minted.sealedPan).not.toContain(pan);

    const opened = openJson<{ pan: string }>(dir, minted.sealedPan);
    expect(opened).toEqual({ pan });
    expect(readSealedPan(dir, minted.sealedPan)).toBe(pan);

    const state = rememberToken(emptyCardVault(), minted.token, minted.sealedPan);
    const published = publicPaymentMethod(state);
    expect(published).toMatchObject({ last4: '4242', brand: 'visa', expiry: '12/99', tokenId: minted.token.tokenId });
    expect(JSON.stringify(published)).not.toContain(pan);
    expect(JSON.stringify(published)).not.toContain('123');
  });

  it('writes no plaintext PAN into a sealed vault file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-card-disk-'));
    dirs.push(dir);
    const { writeSealed } = await import('./vault.ts');
    const path = join(dir, 'secrets', 'cards.enc');
    const pan = '4242424242424242';
    const minted = tokenizeCard(dir, { name: 'Ada Lovelace', number: pan, expiry: '12/99', cvc: '123' });
    writeSealed(dir, path, rememberToken(emptyCardVault(), minted.token, minted.sealedPan));
    const blob = readFileSync(path, 'utf8');
    expect(blob).not.toContain(pan);
    expect(blob).not.toContain('Ada Lovelace');
  });
});
