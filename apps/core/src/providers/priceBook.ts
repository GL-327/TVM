export type Cadence = 'month' | 'year';
export type OfferId = `tvm.${'base' | 'liveTv'}.${Cadence}`;
export interface Offer {
  id: OfferId;
  cadence: Cadence;
  capability: 'tvm' | 'liveTv';
  unitPence: number;
}
export interface PriceBook {
  readonly version: number;
  readonly effectiveFrom: string;
  readonly currency: 'GBP';
  readonly offers: readonly Offer[];
}

/** Append versions with explicit effective dates; never edit an issued version. */
export const PRICE_BOOKS: readonly PriceBook[] = [{
  version: 1, effectiveFrom: '2026-11-17T00:00:00.000Z', currency: 'GBP',
  offers: [
    { id: 'tvm.base.month', cadence: 'month', capability: 'tvm', unitPence: 1000 },
    { id: 'tvm.base.year', cadence: 'year', capability: 'tvm', unitPence: 9000 },
    { id: 'tvm.liveTv.month', cadence: 'month', capability: 'liveTv', unitPence: 700 },
    { id: 'tvm.liveTv.year', cadence: 'year', capability: 'liveTv', unitPence: 6000 },
  ],
}];

export function priceBookAt(at = new Date(), books: readonly PriceBook[] = PRICE_BOOKS): PriceBook {
  const book = [...books].filter(b => Date.parse(b.effectiveFrom) <= at.getTime())
    .sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom) || b.version - a.version)[0];
  if (!book) throw new Error('price_book_not_effective');
  return book;
}

export function orderOffers(book: PriceBook, cadence: Cadence, liveTv: boolean): Offer[] {
  if (cadence !== 'month' && cadence !== 'year') throw new Error('invalid_cadence');
  const ids: OfferId[] = [`tvm.base.${cadence}`, ...(liveTv ? [`tvm.liveTv.${cadence}` as OfferId] : [])];
  return ids.map(id => {
    const offer = book.offers.find(o => o.id === id && o.cadence === cadence);
    if (!offer || !Number.isSafeInteger(offer.unitPence) || offer.unitPence < 0) throw new Error('invalid_offer');
    return { ...offer };
  });
}

/** Calendar periods in UTC, clamped at month end (Jan 31 -> Feb 28). */
export function periodEnd(start: Date, cadence: Cadence): Date {
  const end = new Date(start);
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + (cadence === 'year' ? 12 : 1));
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return end;
}
