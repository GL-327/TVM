import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQuoteService, canonicalJson } from './quotes.ts';
import { resolveFlags } from './featureFlags.ts';
import { PRICE_BOOKS } from './priceBook.ts';

vi.mock('./secureFile.ts', async original => ({ ...await original<typeof import('./secureFile.ts')>(), windowsProtect: (value: string) => value }));
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'tvm-quotes-')); dirs.push(dataDir);
  let time = Date.parse('2026-11-30T23:55:00Z');
  let orderable = true;
  const v1 = PRICE_BOOKS[0]!;
  const books = [v1, { ...v1, version: 2, effectiveFrom: '2026-12-01T00:00:00Z' }];
  const options = { dataDir, books, now: () => new Date(time), flags: () => resolveFlags({}, { 'liveTv.orderable': orderable }) };
  return { dataDir, service: createQuoteService(options), restart: () => createQuoteService(options),
    advance: (ms: number) => { time += ms; }, orderable: (value: boolean) => { orderable = value; } };
}
describe('signed quotes', () => {
  it.each([['month', false, 1000], ['month', true, 1700], ['year', false, 9000], ['year', true, 15000]] as const)
    ('quotes %s add-on=%s with coherent periods and totals', (cadence, liveTv, totalPence) => {
      const f = fixture(); const quote = f.service.quote({ cadence, liveTv }, 'acc_a');
      expect(quote).toMatchObject({ priceBookVersion: 1, totalPence, cadence });
      expect(quote.lines).toHaveLength(liveTv ? 2 : 1);
      expect(quote.lines.every(line => line.periodStart === quote.createdAt && line.periodEnd === quote.nextBillingDate && line.qty === 1 && line.offerId.endsWith(cadence))).toBe(true);
      expect(Date.parse(quote.expiresAt) - Date.parse(quote.createdAt)).toBe(900_000);
      expect(f.restart().verifyQuote(quote, 'acc_a')).toEqual(quote);
    });
  it('canonicalizes object keys recursively while preserving array order', () => {
    expect(canonicalJson({ z: [2, { b: 1, a: 2 }], a: 1 })).toBe(canonicalJson({ a: 1, z: [2, { a: 2, b: 1 }] }));
    const f = fixture(); const quote = f.service.quote({ cadence: 'year', liveTv: true }, 'acc_a');
    const reversed = Object.fromEntries(Object.entries(quote).reverse());
    expect(f.service.verifyQuote(reversed, 'acc_a')).toEqual(quote);
  });
  it('rejects tampering, malformed quotes and use by another account with a fresh quote', () => {
    const f = fixture(); const quote = f.service.quote({ cadence: 'month', liveTv: true }, 'acc_a');
    for (const tampered of [null, {}, { ...quote, signature: 'x' }, { ...quote, totalPence: 1 }, { ...quote, lines: [{ offerId: 42 }] },
      { ...quote, lines: quote.lines.map(line => ({ ...line, unitPence: 1 })) }, { ...quote, expiresAt: '2099-01-01' }]) {
      expect(() => f.service.verifyQuote(tampered, 'acc_a')).toThrow(expect.objectContaining({ status: 409, code: 'quote_invalid', quote: expect.objectContaining({ totalPence: expect.any(Number) }) }));
    }
    expect(() => f.service.verifyQuote(quote, 'acc_b')).toThrow(expect.objectContaining({ status: 409, code: 'quote_invalid' }));
  });
  it('expires at the exact boundary and detects a newly effective book before expiry', () => {
    const f = fixture(); const quote = f.service.quote({ cadence: 'month', liveTv: false }, 'a');
    f.advance(300_000);
    expect(() => f.service.verifyQuote(quote, 'a')).toThrow(expect.objectContaining({ status: 409, code: 'price_changed', quote: expect.objectContaining({ priceBookVersion: 2 }) }));
    const current = f.service.quote({ cadence: 'month', liveTv: false }, 'a');
    f.advance(900_000);
    expect(() => f.service.verifyQuote(current, 'a')).toThrow(expect.objectContaining({ status: 409, code: 'quote_expired', quote: expect.any(Object) }));
  });
  it('enforces orderability on issue and acceptance, independent of health and visibility', () => {
    const f = fixture(); const quote = f.service.quote({ cadence: 'year', liveTv: true }, 'a');
    f.orderable(false);
    expect(() => f.service.quote({ cadence: 'year', liveTv: true }, 'a')).toThrow(expect.objectContaining({ status: 409, code: 'live_tv_not_orderable' }));
    expect(() => f.service.accept(quote, 'a')).toThrow(expect.objectContaining({ status: 409, code: 'live_tv_not_orderable' }));
    expect(f.service.quote({ cadence: 'year', liveTv: false }, 'a').totalPence).toBe(9000);
    expect(f.service.accepted()).toEqual([]);
  });
  it('appends immutable sealed acceptance snapshots, deduplicates retries and refuses a damaged ledger', () => {
    const f = fixture(); const quote = f.service.quote({ cadence: 'year', liveTv: true }, 'a');
    const row = f.service.accept(quote, 'a');
    const path = join(f.dataDir, 'secrets', 'quotes.enc');
    const first = readFileSync(path, 'utf8');
    expect(first).not.toContain(quote.id);
    expect(f.service.accept(quote, 'a')).toEqual(row);
    expect(readFileSync(path, 'utf8')).toBe(first);
    const second = f.service.quote({ cadence: 'month', liveTv: false }, 'a');
    f.service.accept(second, 'a');
    expect(readFileSync(path, 'utf8').startsWith(first)).toBe(true);
    expect(f.restart().accepted().map(r => r.quote.totalPence)).toEqual([15000, 1000]);
    writeFileSync(path, 'corrupt\n');
    expect(() => f.service.accept(second, 'a')).toThrow('quote_ledger_unreadable');
    expect(readFileSync(path, 'utf8')).toBe('corrupt\n');
  });
});
