export const LIVE_TV_TERMS = ['quarter', 'year', 'lifetime'] as const;
export type LiveTvTerm = (typeof LIVE_TV_TERMS)[number];

export interface LiveTvTermSpec {
  id: LiveTvTerm;
  name: string;
  /** Listed dollar price from the Live TV panel (cents). */
  usdCents: number;
  /** Charged in GBP pence at the same listed figure. */
  amountPence: number;
  interval: 'month' | 'year' | null;
  intervalCount: number;
  blurb: string;
}

export const LIVE_TV_CATALOG: readonly LiveTvTermSpec[] = [
  {
    id: 'quarter',
    name: '3-month',
    usdCents: 3999,
    amountPence: 3999,
    interval: 'month',
    intervalCount: 3,
    blurb: 'Billed every 3 months',
  },
  {
    id: 'year',
    name: '1-year',
    usdCents: 8999,
    amountPence: 8999,
    interval: 'year',
    intervalCount: 1,
    blurb: 'Billed once per year',
  },
  {
    id: 'lifetime',
    name: 'Lifetime',
    usdCents: 59900,
    amountPence: 59900,
    interval: null,
    intervalCount: 0,
    blurb: 'One payment; access lasts only while the service stays online',
  },
];

/** Lowest Live TV list price — the 3-month term. Kept as a named export for older tests. */
export const LIVE_TV_ADDON_PENCE = LIVE_TV_CATALOG[0]!.amountPence;

export const LIVE_TV_EXTRA = 'Live TV pack and your own playlist';

export function parseLiveTvTerm(value: unknown): LiveTvTerm | null {
  return typeof value === 'string' && (LIVE_TV_TERMS as readonly string[]).includes(value)
    ? (value as LiveTvTerm)
    : null;
}

export function liveTvSpec(term: LiveTvTerm): LiveTvTermSpec {
  return LIVE_TV_CATALOG.find((row) => row.id === term) ?? LIVE_TV_CATALOG[0]!;
}

export function formatUsdCents(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export function liveTvServiceOnline(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['TVM_LIVE_TV_ONLINE'] !== '0';
}

export function liveTvExpiryIso(term: LiveTvTerm, from = new Date()): string | null {
  if (term === 'lifetime') return null;
  const next = new Date(from.getTime());
  if (term === 'quarter') next.setUTCMonth(next.getUTCMonth() + 3);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next.toISOString();
}

export function liveTvIsActive(input: {
  liveTvAddon?: boolean;
  liveTvTerm?: LiveTvTerm | null;
  liveTvExpiresAt?: string | null;
  now?: Date;
  serviceOnline?: boolean;
}): boolean {
  if (input.serviceOnline === false) return false;
  if (input.liveTvAddon !== true) return false;
  if (input.liveTvTerm === 'lifetime') return true;
  const expires = input.liveTvExpiresAt;
  if (typeof expires !== 'string' || expires === '') return false;
  const at = new Date(expires);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() > (input.now ?? new Date()).getTime();
}

export function resolveCheckoutLiveTvTerm(input: { liveTv?: unknown; liveTvTerm?: unknown }): LiveTvTerm | null {
  const explicit = parseLiveTvTerm(input.liveTvTerm);
  if (explicit !== null) return explicit;
  if (input.liveTv === true) return 'quarter';
  return null;
}
