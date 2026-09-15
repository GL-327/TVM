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
  rememberToken,
  tokenizeCard,
} from './cardVault.ts';

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

  it('keeps only last4, brand and expiry, and retains the number nowhere', async () => {
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

    // The number and the CVC must not survive tokenisation in any form. An
    // earlier build sealed the PAN for "a future processor"; holding one at all
    // is what PCI DSS forbids, so there is no longer anywhere for it to go.
    expect(JSON.stringify(minted)).not.toContain(pan);
    expect(JSON.stringify(minted)).not.toContain('123');
    expect(Object.keys(minted)).toEqual(['token']);

    const state = rememberToken(emptyCardVault(), minted.token);
    expect(Object.keys(state)).toEqual(['version', 'tokens']);
    const published = publicPaymentMethod(state);
    expect(published).toMatchObject({ last4: '4242', brand: 'visa', expiry: '12/99', tokenId: minted.token.tokenId });
    expect(JSON.stringify(published)).not.toContain(pan);
    expect(JSON.stringify(published)).not.toContain('123');
  });

  it('drops a sealed PAN map left behind by an older build', async () => {
    const { hydrateCardVault } = await import('./cardVault.ts');
    const legacy = {
      version: 1,
      tokens: [{ tokenId: 'tok_x', last4: '4242', brand: 'visa', expiry: '12/99', name: 'Ada', zip: null, createdAt: '' }],
      instruments: { tok_x: 'sealed-blob-from-an-older-build' },
    };
    const hydrated = hydrateCardVault(legacy) as unknown as Record<string, unknown>;
    expect(hydrated['instruments']).toBeUndefined();
    expect(JSON.stringify(hydrated)).not.toContain('sealed-blob-from-an-older-build');
  });

  it('writes no plaintext PAN into a sealed vault file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-card-disk-'));
    dirs.push(dir);
    const { writeSealed } = await import('./vault.ts');
    const path = join(dir, 'secrets', 'cards.enc');
    const pan = '4242424242424242';
    const minted = tokenizeCard(dir, { name: 'Ada Lovelace', number: pan, expiry: '12/99', cvc: '123' });
    writeSealed(dir, path, rememberToken(emptyCardVault(), minted.token));
    const blob = readFileSync(path, 'utf8');
    expect(blob).not.toContain(pan);
    expect(blob).not.toContain('Ada Lovelace');
  });
});
