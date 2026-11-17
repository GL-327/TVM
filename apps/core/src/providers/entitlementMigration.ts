/** Pure dry run. No grants, charges, store hydration or account services are invoked. */
export interface MigrationInput {
  accounts?: unknown;
  entitlement?: unknown;
  billing?: unknown;
  payments?: unknown;
  subscriptions?: unknown;
}
type Row = Record<string, unknown>;
const object = (raw: unknown): Row => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Row : {};
const rows = (raw: unknown): Row[] => Array.isArray(raw) ? raw.map(object) : [];
const text = (raw: unknown): string | null => typeof raw === 'string' && raw !== '' ? raw : null;
export type GrantClassification = 'valid' | 'expired' | 'ambiguous' | 'none';

export function classifyLegacyLiveGrant(raw: unknown, at: Date): { classification: GrantClassification; expiresAt: string | null; reason: string } {
  const grant = object(raw);
  const expiresAt = text(grant['liveTvExpiresAt']);
  if (grant['liveTvAddon'] === false) return { classification: 'none', expiresAt, reason: 'explicitly_disabled' };
  if (grant['liveTvAddon'] !== true) {
    const evidence = grant['liveTvTerm'] != null || expiresAt !== null;
    return { classification: evidence ? 'ambiguous' : 'none', expiresAt, reason: evidence ? 'grant_marker_missing' : 'no_grant' };
  }
  if (grant['liveTvTerm'] === 'lifetime' && expiresAt === null) return { classification: 'valid', expiresAt: null, reason: 'legacy_lifetime' };
  if ((grant['liveTvTerm'] !== 'quarter' && grant['liveTvTerm'] !== 'year') || expiresAt === null || !Number.isFinite(Date.parse(expiresAt))) {
    return { classification: 'ambiguous', expiresAt, reason: 'term_or_expiry_needs_verification' };
  }
  return { classification: Date.parse(expiresAt) > at.getTime() ? 'valid' : 'expired', expiresAt, reason: 'known_legacy_expiry' };
}

export function entitlementMigrationReport(input: MigrationInput, at = new Date()) {
  const warnings: string[] = [];
  const accounts = rows(object(input.accounts)['accounts']);
  const manualAccounts = accounts.map(account => {
    const tier = text(account['tier']);
    const dev = account['role'] === 'dev';
    const knownTier = tier === 'stream' || tier === 'stream-live';
    const active = dev || (account['activated'] === true && account['suspended'] !== true && knownTier);
    const ambiguous = !dev && account['activated'] === true && !knownTier;
    if (ambiguous) warnings.push(`account:${String(account['id'])}:verify_tier`);
    return {
      accountId: text(account['id']), tier, activated: account['activated'] === true, suspended: account['suspended'] === true,
      mapping: { base: active, liveTv: active && (dev || tier === 'stream-live'), source: dev ? 'dev' : 'manual', expiresAt: null, priceBookVersion: null },
      operatorVerification: ambiguous,
    };
  });
  const entitlement = object(input.entitlement);
  const billingReceipts = rows(object(input.billing)['receipts']);
  const paymentOrders = rows(object(input.payments)['orders']);
  const current = object(object(input.subscriptions)['current']);
  const machineGrant = classifyLegacyLiveGrant(entitlement, at);
  const liveTvGrants = [
    ...manualAccounts.filter(account => account.mapping.liveTv).map(account => ({
      scope: 'account', id: account.accountId, classification: 'valid' as GrantClassification,
      expiresAt: null, reason: account.mapping.source, operatorVerification: false,
      mapping: { liveTv: true, source: 'legacy', expiresAt: null },
    })),
    ...(input.entitlement == null ? [] : [{
      scope: 'machine', id: 'machine', ...machineGrant,
      operatorVerification: machineGrant.classification === 'ambiguous' || machineGrant.classification === 'valid',
      mapping: { liveTv: machineGrant.classification === 'valid', source: 'legacy', expiresAt: machineGrant.expiresAt },
    }]),
  ];
  if (liveTvGrants.some(grant => grant.scope === 'machine' && grant.operatorVerification)) warnings.push('machine_grant:verify_account_owner_before_migration');
  if (machineGrant.classification === 'ambiguous') warnings.push('machine_grant:verify_term_and_expiry');
  const knownPlans = ['free', 'basic', 'premium', 'ultra', 'max', 'tvm-max'];
  const tierIds = new Set([...(manualAccounts.map(account => account.tier).filter((tier): tier is string => tier !== null)),
    ...(typeof entitlement['id'] === 'string' ? [entitlement['id']] : []),
    ...[...billingReceipts, ...paymentOrders, current].map(row => text(row['planId'])).filter((id): id is string => id !== null)]);
  const tiers = [...tierIds].sort().map(id => ({
    id, mapping: { base: id !== 'free' && (knownPlans.includes(id) || id === 'stream' || id === 'stream-live'), liveTv: id === 'stream-live' },
    preserveAcquiredCapabilities: true, operatorVerification: !knownPlans.includes(id) && id !== 'stream' && id !== 'stream-live',
  }));
  const receipts = [
    ...billingReceipts.map(receipt => ({ receipt, store: 'billing' })),
    ...paymentOrders.map(receipt => ({ receipt, store: 'payments' })),
  ].map(({ receipt, store }) => ({
    id: text(receipt['id']) ?? text(receipt['paymentIntentId']), store, planId: text(receipt['planId']),
    liveTvTerm: text(receipt['liveTvTerm']), chargedPence: receipt['chargedPence'] ?? null,
    state: text(receipt['event']) ?? text(receipt['status']),
    mapping: { preserveReceipt: true, replayGrant: false, reprice: false, priceBookVersion: null },
    operatorVerification: receipt['liveTv'] === true || !knownPlans.includes(String(receipt['planId'])),
  }));
  const subscriptionGrants = current['state'] === 'active' || current['state'] === 'past_due';
  const subscriptions = Object.keys(current).length === 0 ? [] : [{
    subscriptionId: text(current['subscriptionId']), planId: text(current['planId']), state: text(current['state']),
    currentPeriodEnd: current['currentPeriodEnd'] ?? null, cancelAtPeriodEnd: current['cancelAtPeriodEnd'] === true,
    mapping: { preserveProviderSubscription: true, reprice: false, rebill: false, priceBookVersion: null, cadence: 'verify_legacy_cadence',
      base: subscriptionGrants, liveTv: subscriptionGrants && current['liveTv'] === true, liveTvTerm: text(current['liveTvTerm']) },
    // Machine subscriptions lack authoritative account ownership and launch-cadence mapping.
    operatorVerification: true,
  }];
  if (subscriptions.length) warnings.push('subscriptions:verify_account_cadence_and_paid_through_before_migration');
  if (receipts.some(receipt => receipt.operatorVerification)) warnings.push('receipts:historical_live_claims_require_verification_not_replay');
  return {
    schemaVersion: 1, dryRun: true, generatedAt: at.toISOString(),
    summary: { manualAccounts: manualAccounts.length, tiers: tiers.length, receipts: receipts.length, subscriptions: subscriptions.length,
      liveTvGrants: { valid: liveTvGrants.filter(g => g.classification === 'valid').length, expired: liveTvGrants.filter(g => g.classification === 'expired').length,
        ambiguous: liveTvGrants.filter(g => g.classification === 'ambiguous').length } },
    manualAccounts, tiers, liveTvGrants, receipts, subscriptions,
    preservedOwnership: { styleId: text(entitlement['styleId']), anime: entitlement['animeAddon'] === true, synthwave: entitlement['synthwaveAddon'] === true, themeBundle: entitlement['themeBundle'] === true },
    warnings,
  };
}
