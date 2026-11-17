import type { LiveTvTermSpec } from './liveTv.ts';
import { orderOffers, priceBookAt, type PriceBook } from './priceBook.ts';
import { resolveFlags, type FeatureFlags } from './featureFlags.ts';
import type { AccountTier } from './accounts.ts';
import type { PlanId } from './plans.ts';

/**
 * What TVM offers, as the two things it actually is.
 *
 * There used to be five tiers, a free mode with advertising, watch-hour caps
 * and a queue, all sold through an in-app checkout. None of that survives:
 * TVM is not self-serve any more. There are two kinds of access, the operator
 * grants them by hand, and the prices below exist to answer "what does this
 * cost" rather than to be paid inside the app.
 *
 * The old plan ids are kept underneath because they still drive real
 * behaviour — picture quality, profile count, which visual styles unlock — and
 * rewriting that machinery would risk breaking playback to achieve nothing a
 * viewer would see. Both tiers map to the fullest of them; the only difference
 * between them is Live TV, which is the only difference anyone is buying.
 */

export interface AccessTierSpec {
  id: AccountTier;
  name: string;
  /** One line, for a card. */
  summary: string;
  /** The internal plan whose capabilities this tier grants. */
  planId: PlanId;
  liveTv: boolean;
  /** Base TVM cost; the Live TV add-on is shown separately. */
  monthlyPence: number | null;
  yearlyPence: number;
  liveTvMonthlyPence: number;
  liveTvYearlyPence: number;
  orderable: boolean;
  availability: 'available' | 'Coming soon';
  /** Compatibility field: legacy term offers are no longer advertised. */
  liveTvTerms: readonly LiveTvTermSpec[];
  includes: readonly string[];
}

/** Compatibility export; live routes resolve the current book on every request. */
export const STREAM_MONTHLY_PENCE = orderOffers(priceBookAt(), 'month', false)[0]!.unitPence;

export function accessTiers(flags: FeatureFlags = resolveFlags(), book: PriceBook = priceBookAt()): readonly AccessTierSpec[] {
  const month = orderOffers(book, 'month', true);
  const year = orderOffers(book, 'year', true);
  const prices = { monthlyPence: month[0]!.unitPence, yearlyPence: year[0]!.unitPence };
  const tiers: AccessTierSpec[] = [
  {
    id: 'stream',
    name: 'Movies and TV shows',
    summary: 'Films and series from your own sources, with the best available picture.',
    planId: 'max',
    liveTv: false,
    ...prices,
    liveTvMonthlyPence: 0, liveTvYearlyPence: 0,
    orderable: true, availability: 'available',
    liveTvTerms: [],
    includes: [
      'Films and series through your own sources',
      '4K where the source has it, HDR and Atmos passthrough',
      'Light and Dark appearance',
      'Up to 10 viewing profiles',
      'No advertising, no queue, no watch-hour limit',
    ],
  },
  {
    id: 'stream-live',
    name: 'Movies and TV shows + Live TV',
    summary: flags['liveTv.orderable'] ? 'Everything above, plus Live TV through your own IPTV subscription.' : 'Live TV: Coming soon.',
    planId: 'max',
    liveTv: true,
    ...prices,
    liveTvMonthlyPence: month[1]!.unitPence, liveTvYearlyPence: year[1]!.unitPence,
    orderable: flags['liveTv.orderable'], availability: flags['liveTv.orderable'] ? 'available' : 'Coming soon',
    liveTvTerms: [],
    includes: [
      'Everything in Movies and TV shows',
      'Live TV, using an IPTV subscription you supply',
      'Channel check, so you can see which channels actually stream',
      'Back to live after pausing',
    ],
  },
];
  return flags['liveTv.visible'] ? tiers : tiers.filter(tier => !tier.liveTv);
}

export const ACCESS_TIERS = accessTiers();

export function accessTier(id: AccountTier): AccessTierSpec {
  return ACCESS_TIERS.find((tier) => tier.id === id) ?? ACCESS_TIERS[0]!;
}

/** What an activated account is entitled to, as the plan engine understands it. */
export function entitlementForTier(id: AccountTier): { planId: PlanId; liveTv: boolean } {
  // Stored grant vocabulary is independent of purchase visibility/orderability.
  return { planId: 'max', liveTv: id === 'stream-live' };
}

/**
 * How someone gets access.
 *
 * Stated in one place so the interface cannot drift into implying a purchase
 * flow that does not exist.
 */
export const ACCESS_ROUTE = {
  headline: 'Access is arranged with the app owner',
  detail:
    'There is no checkout here and nothing to buy in the app. Create an account, then contact the owner to have it switched on. The prices above are what access costs.',
  action: 'Contact the app owner',
} as const;
