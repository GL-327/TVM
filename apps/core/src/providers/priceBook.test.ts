import { describe, expect, it } from 'vitest';
import { orderOffers, periodEnd, priceBookAt, PRICE_BOOKS, type PriceBook } from './priceBook.ts';

describe('launch price book', () => {
  it.each([
    ['month', false, [1000], 1000], ['month', true, [1000, 700], 1700],
    ['year', false, [9000], 9000], ['year', true, [9000, 6000], 15000],
  ] as const)('prices %s with add-on=%s', (cadence, liveTv, amounts, total) => {
    const book = priceBookAt(new Date('2026-11-17'));
    const lines = orderOffers(book, cadence, liveTv);
    expect(lines.map(line => line.unitPence)).toEqual(amounts);
    expect(lines.every(line => line.cadence === cadence)).toBe(true);
    expect(lines.reduce((sum, line) => sum + line.unitPence, 0)).toBe(total);
    expect(book.offers).toHaveLength(4);
    expect(book.currency).toBe('GBP');
  });
  it('switches versions exactly at effectiveFrom, independent of array order', () => {
    const v1 = PRICE_BOOKS[0]!;
    const v2: PriceBook = { ...v1, version: 2, effectiveFrom: '2026-12-01T00:00:00Z', offers: v1.offers.map(o => ({ ...o, unitPence: o.unitPence + 100 })) };
    expect(priceBookAt(new Date('2026-11-30T23:59:59.999Z'), [v2, v1])).toEqual(v1);
    expect(priceBookAt(new Date(v2.effectiveFrom), [v1, v2])).toEqual(v2);
    expect(() => priceBookAt(new Date('2026-01-01'))).toThrow('price_book_not_effective');
    expect(orderOffers(priceBookAt(new Date(v2.effectiveFrom), [v2, v1]), 'month', true).reduce((s, o) => s + o.unitPence, 0)).toBe(1900);
  });
  it('clamps calendar periods in UTC, including leap years', () => {
    expect(periodEnd(new Date('2027-01-31T12:34:56Z'), 'month').toISOString()).toBe('2027-02-28T12:34:56.000Z');
    expect(periodEnd(new Date('2028-02-29T12:34:56Z'), 'year').toISOString()).toBe('2029-02-28T12:34:56.000Z');
  });
});
