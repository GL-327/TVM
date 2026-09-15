import { LIVE_TV_CATALOG, type LiveTvTermSpec } from './liveTv.ts';
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
  /** Indicative monthly cost in pence, or null where Live TV is priced by term. */
  monthlyPence: number | null;
  /** Live TV is priced by the upstream panel's terms, not monthly. */
  liveTvTerms: readonly LiveTvTermSpec[];
  includes: readonly string[];
}

/** Sterling, per month, for the software itself. Live TV is on top and by term. */
export const STREAM_MONTHLY_PENCE = 999;

export const ACCESS_TIERS: readonly AccessTierSpec[] = [
  {
    id: 'stream',
    name: 'Movies and TV shows',
    summary: 'The full library, every picture setting, no advertising.',
    planId: 'max',
    liveTv: false,
    monthlyPence: STREAM_MONTHLY_PENCE,
    liveTvTerms: [],
    includes: [
      'Films and series through your own sources',
      '4K where the source has it, HDR and Atmos passthrough',
      'Every visual style, including MAX Gold and Aurora',
      'Up to 10 viewing profiles',
      'No advertising, no queue, no watch-hour limit',
    ],
  },
  {
    id: 'stream-live',
    name: 'Movies and TV shows + Live TV',
    summary: 'Everything above, plus live channels through your own IPTV subscription.',
    planId: 'max',
    liveTv: true,
    monthlyPence: STREAM_MONTHLY_PENCE,
    liveTvTerms: LIVE_TV_CATALOG,
    includes: [
      'Everything in Movies and TV shows',
      'Live TV, using an IPTV subscription you supply',
      'Channel check, so you can see which channels actually stream',
      'Back to live after pausing',
    ],
  },
];

export function accessTier(id: AccountTier): AccessTierSpec {
  return ACCESS_TIERS.find((tier) => tier.id === id) ?? ACCESS_TIERS[0]!;
}

/** What an activated account is entitled to, as the plan engine understands it. */
export function entitlementForTier(id: AccountTier): { planId: PlanId; liveTv: boolean } {
  const tier = accessTier(id);
  return { planId: tier.planId, liveTv: tier.liveTv };
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
