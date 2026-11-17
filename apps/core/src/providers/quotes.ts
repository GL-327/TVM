import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { openJson, readSealed, sealJson, writeSealed } from './vault.ts';
import { orderOffers, periodEnd, priceBookAt, type Cadence, type PriceBook, type OfferId } from './priceBook.ts';
import type { FeatureFlags } from './featureFlags.ts';

export interface QuoteInput { cadence: Cadence; liveTv: boolean }
export interface Quote {
  id: string;
  priceBookVersion: number;
  cadence: Cadence;
  lines: Array<{ offerId: OfferId; qty: 1; unitPence: number; periodStart: string; periodEnd: string }>;
  totalPence: number;
  nextBillingDate: string;
  createdAt: string;
  expiresAt: string;
  signature: string;
}
export interface AcceptedQuote { accountId: string; acceptedAt: string; quote: Quote }
export class QuoteError extends Error {
  readonly status = 409;
  readonly code: 'quote_invalid' | 'quote_expired' | 'price_changed' | 'live_tv_not_orderable';
  readonly quote?: Quote;
  constructor(code: QuoteError['code'], quote?: Quote) {
    super(code);
    this.code = code;
    this.quote = quote;
  }
}

/** Stable key order at every depth; arrays retain their order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createQuoteService(options: {
  dataDir: string; flags: () => FeatureFlags; now?: () => Date; books?: readonly PriceBook[];
}) {
  const now = options.now ?? (() => new Date());
  const secretPath = join(options.dataDir, 'secrets', 'quote-signing.enc');
  const ledgerPath = join(options.dataDir, 'secrets', 'quotes.enc');
  const secret = (): string => {
    if (existsSync(secretPath)) {
      const stored = readSealed<{ secret: string }>(options.dataDir, secretPath);
      if (!stored || !/^[a-f0-9]{64}$/.test(stored.secret)) throw new Error('quote_secret_unreadable');
      return stored.secret;
    }
    const value = randomBytes(32).toString('hex');
    writeSealed(options.dataDir, secretPath, { secret: value });
    return value;
  };
  // Account binding is authenticated too, without adding account identifiers to public quotes.
  const sign = (value: Omit<Quote, 'signature'>, accountId: string): string =>
    createHmac('sha256', secret()).update(canonicalJson({ accountId, quote: value })).digest('hex');
  const quote = (input: QuoteInput, accountId: string): Quote => {
    if ((input.cadence !== 'month' && input.cadence !== 'year') || typeof input.liveTv !== 'boolean') throw new Error('invalid_quote_input');
    if (input.liveTv && !options.flags()['liveTv.orderable']) throw new QuoteError('live_tv_not_orderable');
    const at = now();
    const book = priceBookAt(at, options.books);
    const start = at.toISOString();
    const end = periodEnd(at, input.cadence).toISOString();
    const lines = orderOffers(book, input.cadence, input.liveTv).map(offer => ({
      offerId: offer.id, qty: 1 as const, unitPence: offer.unitPence, periodStart: start, periodEnd: end,
    }));
    const value: Omit<Quote, 'signature'> = {
      id: `quote_${randomUUID()}`, priceBookVersion: book.version, cadence: input.cadence, lines,
      totalPence: lines.reduce((total, line) => total + line.unitPence, 0), nextBillingDate: end,
      createdAt: start, expiresAt: new Date(at.getTime() + 15 * 60_000).toISOString(),
    };
    return { ...value, signature: sign(value, accountId) };
  };
  const verifyQuote = (input: unknown, accountId: string): Quote => {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as Partial<Quote> : {};
    const selection: QuoteInput = {
      cadence: raw.cadence === 'year' ? 'year' : 'month',
      liveTv: Array.isArray(raw.lines) && raw.lines.some(line => typeof line?.offerId === 'string' && line.offerId.startsWith('tvm.liveTv.')),
    };
    const reject = (code: 'quote_invalid' | 'quote_expired' | 'price_changed'): never => {
      // If ordering was disabled since issue, the replacement can only offer base TVM.
      throw new QuoteError(code, quote({ ...selection, liveTv: selection.liveTv && options.flags()['liveTv.orderable'] }, accountId));
    };
    if (typeof raw.signature !== 'string' || !/^[a-f0-9]{64}$/.test(raw.signature)) return reject('quote_invalid');
    const { signature, ...unsigned } = raw;
    let expected: string;
    try { expected = sign(unsigned as Omit<Quote, 'signature'>, accountId); }
    catch { return reject('quote_invalid'); }
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return reject('quote_invalid');
    if (!Number.isFinite(Date.parse(raw.expiresAt ?? '')) || Date.parse(raw.expiresAt!) <= now().getTime()) return reject('quote_expired');
    if (raw.priceBookVersion !== priceBookAt(now(), options.books).version) return reject('price_changed');
    if (selection.liveTv && !options.flags()['liveTv.orderable']) throw new QuoteError('live_tv_not_orderable');
    return structuredClone(raw as Quote);
  };
  const accepted = (): AcceptedQuote[] => {
    if (!existsSync(ledgerPath)) return [];
    return readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map(blob => {
      const row = openJson<AcceptedQuote>(options.dataDir, blob);
      if (!row?.accountId || !row.quote?.id || !row.acceptedAt) throw new Error('quote_ledger_unreadable');
      return row;
    });
  };
  return {
    quote, verifyQuote, accepted,
    accept(input: unknown, accountId: string): AcceptedQuote {
      const verified = verifyQuote(input, accountId);
      const previous = accepted().find(row => row.accountId === accountId && row.quote.id === verified.id);
      if (previous) return previous;
      const row: AcceptedQuote = { accountId, quote: verified, acceptedAt: now().toISOString() };
      mkdirSync(dirname(ledgerPath), { recursive: true, mode: 0o700 });
      // Each immutable snapshot is independently sealed; appending never rewrites earlier entries.
      appendFileSync(ledgerPath, `${sealJson(options.dataDir, row)}\n`, { encoding: 'utf8', mode: 0o600, flush: true });
      return structuredClone(row);
    },
  };
}
export type QuoteService = ReturnType<typeof createQuoteService>;
