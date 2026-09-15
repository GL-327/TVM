import { describe, expect, it } from 'vitest';
import {
  formatUsdCents,
  LIVE_TV_ADDON_PENCE,
  LIVE_TV_CATALOG,
  liveTvExpiryIso,
  liveTvIsActive,
  liveTvSpec,
  parseLiveTvTerm,
  resolveCheckoutLiveTvTerm,
} from './liveTv.ts';

describe('live TV terms', () => {
  it('lists the 3-month, yearly and lifetime prices from the panel', () => {
    expect(LIVE_TV_CATALOG.map((row) => row.id)).toEqual(['quarter', 'year', 'lifetime']);
    expect(formatUsdCents(3999)).toBe('$39.99');
    expect(formatUsdCents(8999)).toBe('$89.99');
    expect(formatUsdCents(59900)).toBe('$599');
    expect(LIVE_TV_ADDON_PENCE).toBe(3999);
    expect(liveTvSpec('year').blurb).toMatch(/year/i);
    expect(parseLiveTvTerm('lifetime')).toBe('lifetime');
    expect(parseLiveTvTerm('weekly')).toBeNull();
  });

  it('treats a boolean Live TV toggle as the 3-month term', () => {
    expect(resolveCheckoutLiveTvTerm({ liveTv: true })).toBe('quarter');
    expect(resolveCheckoutLiveTvTerm({ liveTv: false })).toBeNull();
    expect(resolveCheckoutLiveTvTerm({ liveTvTerm: 'year' })).toBe('year');
  });

  it('expires prepaid terms and keeps lifetime while the service is online', () => {
    const now = new Date('2026-09-15T12:00:00Z');
    expect(liveTvExpiryIso('lifetime', now)).toBeNull();
    expect(liveTvExpiryIso('quarter', now)).toBe('2026-12-15T12:00:00.000Z');
    expect(liveTvIsActive({ liveTvAddon: true, liveTvTerm: 'lifetime', serviceOnline: true })).toBe(true);
    expect(liveTvIsActive({ liveTvAddon: true, liveTvTerm: 'lifetime', serviceOnline: false })).toBe(false);
    expect(liveTvIsActive({
      liveTvAddon: true,
      liveTvTerm: 'year',
      liveTvExpiresAt: '2026-09-14T12:00:00Z',
      now,
    })).toBe(false);
    expect(liveTvIsActive({
      liveTvAddon: true,
      liveTvTerm: 'year',
      liveTvExpiresAt: '2027-09-15T12:00:00Z',
      now,
    })).toBe(true);
  });
});
