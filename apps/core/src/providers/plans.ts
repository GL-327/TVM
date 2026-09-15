import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  billingPath,
  entitlementPath,
  planPath,
  poolRdPath,
  usagePath,
} from '../update/paths.ts';
import { randomUUID } from 'node:crypto';
import {
  CARD_DATA_NOT_SUPPORTED,
  cardFieldsPresent,
  emptyCardVault,
  findToken,
  hydrateCardVault,
  parseCardIntake,
  publicPaymentMethod,
  rememberToken,
  tokenizeCard,
  type CardIntake,
  type CardVaultState,
  type PublicCardToken,
} from './cardVault.ts';
import { declineCharge, type ChargeResult } from './charges.ts';
import { deleteSecret } from './secrets.ts';
import { readSealed, writeSealed } from './vault.ts';
import { loadStripeConfig, publicStripeStatus } from './stripeConfig.ts';
import type { OrderQuote, PaymentOrder, SettledPayment } from './payments.ts';

export const PLAN_IDS = ['free', 'basic', 'premium', 'ultra', 'max'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/**
 * Live TV pack on paid plans. Removing it restores the previous list price.
 *
 * Priced off what the upstream IPTV panel actually costs, because £3.00 did
 * not cover it. The panel's rates are in dollars: $39.99 per 3 months, $89.99
 * per year, $599 once. At roughly 0.79 GBP/USD the annual rate — the cheapest
 * any sensible operator would buy — is £71.09 a year, or £5.92 a month. The
 * old £3.00 therefore sold the pack at a little over half what it cost to
 * supply, losing money on every subscriber who took it.
 *
 * £9.99 applies the same markup the pricing brief asked for (£70 becoming
 * £99.99, about 1.43x) to that £5.92 floor and rounds up: £119.88 a year
 * against £71.09 of cost, a 69% margin that survives the panel putting its
 * prices up or the exchange rate moving.
 *
 * Every plan sold with Live TV reprices from this one number, since
 * priceFor() is base + addon.
 */
export const LIVE_TV_ADDON_PENCE = 999;
export const LIVE_TV_EXTRA = 'Live TV pack and your own playlist';

/** Retro — 1970s/80s television-set pack. Sold on every plan, including Free. */
export const SYNTHWAVE_ADDON_PENCE = 499;
export const ANIME_ADDON_PENCE = 499;
export const THEME_BUNDLE_PENCE = 999;
export const SYNTHWAVE_EXTRA = 'Retro — 1970s/80s television-set look';

export function formatGbp(pence: number): string {
  if (pence === 0) return 'Free';
  return `£${(pence / 100).toFixed(2)}`;
}

export const STYLE_IDS = [
  'classic',
  'cinema',
  'midnight',
  'ember',
  'forest',
  'slate',
  'contrast',
  'gold',
  'aurora',
] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export type StreamTier = 'basic' | 'premium' | 'luxury';
export type MaxHeight = 720 | 1080 | 2160;

export interface StyleSpec {
  id: StyleId;
  name: string;
  minPlan: PlanId;
}

export const STYLE_CATALOG: readonly StyleSpec[] = [
  { id: 'classic', name: 'Classic', minPlan: 'premium' },
  { id: 'cinema', name: 'Cinema', minPlan: 'premium' },
  { id: 'midnight', name: 'Midnight', minPlan: 'premium' },
  { id: 'ember', name: 'Ember', minPlan: 'ultra' },
  { id: 'forest', name: 'Forest', minPlan: 'ultra' },
  { id: 'slate', name: 'Slate', minPlan: 'ultra' },
  { id: 'contrast', name: 'High contrast', minPlan: 'ultra' },
  { id: 'gold', name: 'MAX Gold', minPlan: 'max' },
  { id: 'aurora', name: 'Aurora', minPlan: 'max' },
];

export interface PlanDefinition {
  id: PlanId;
  name: string;
  price: string;
  pricePence: number;
  basePrice: string;
  basePricePence: number;
  liveTvAddonPence: number;
  mocks: boolean;
  liveTv: boolean;
  ads: boolean;
  stream: StreamTier;
  maxHeight: MaxHeight;
  queueMs: number;
  queueSkipToTop: boolean;
  startDelayMs: number;
  weeklySeconds: number | null;
  profilesMax: number;
  skipRecap: boolean;
  extras: readonly string[];
  badges: readonly string[];
}

function priced(
  def: Omit<PlanDefinition, 'price' | 'pricePence' | 'basePrice'>,
): PlanDefinition {
  const pricePence = def.basePricePence + (def.liveTv ? def.liveTvAddonPence : 0);
  return {
    ...def,
    basePrice: formatGbp(def.basePricePence),
    pricePence,
    price: formatGbp(pricePence),
  };
}

export const PLAN_CATALOG: readonly PlanDefinition[] = [
  priced({
    id: 'free',
    name: 'TVM Free',
    basePricePence: 0,
    liveTvAddonPence: 0,
    mocks: false,
    liveTv: false,
    ads: true,
    stream: 'basic',
    maxHeight: 720,
    queueMs: 28_000,
    queueSkipToTop: false,
    startDelayMs: 2500,
    weeklySeconds: 12 * 60 * 60,
    profilesMax: 1,
    skipRecap: false,
    extras: ['TVM Stream only', 'Shared Real-Debrid pool when you add it', 'Ads do not use watch hours'],
    badges: [],
  }),
  priced({
    id: 'basic',
    name: 'TVM Basic',
    basePricePence: 499,
    liveTvAddonPence: LIVE_TV_ADDON_PENCE,
    mocks: false,
    liveTv: true,
    ads: true,
    stream: 'basic',
    maxHeight: 1080,
    queueMs: 3500,
    queueSkipToTop: true,
    startDelayMs: 4000,
    weeklySeconds: null,
    profilesMax: 2,
    skipRecap: false,
    extras: [LIVE_TV_EXTRA, 'Always skipped to the top of the queue', 'Two TVM Stream profiles'],
    badges: ['Live'],
  }),
  priced({
    id: 'premium',
    name: 'TVM Premium',
    basePricePence: 899,
    liveTvAddonPence: LIVE_TV_ADDON_PENCE,
    mocks: false,
    liveTv: true,
    ads: false,
    stream: 'premium',
    maxHeight: 1080,
    queueMs: 0,
    queueSkipToTop: false,
    startDelayMs: 1200,
    weeklySeconds: null,
    profilesMax: 4,
    skipRecap: false,
    extras: [LIVE_TV_EXTRA, 'No ads', 'No queue', 'Cinema, Midnight and Classic styles', 'Four profiles'],
    badges: ['Live'],
  }),
  priced({
    id: 'ultra',
    name: 'TVM Ultra',
    basePricePence: 1299,
    liveTvAddonPence: LIVE_TV_ADDON_PENCE,
    mocks: true,
    liveTv: true,
    ads: false,
    stream: 'premium',
    maxHeight: 2160,
    queueMs: 0,
    queueSkipToTop: false,
    startDelayMs: 400,
    weeklySeconds: null,
    profilesMax: 6,
    skipRecap: true,
    extras: [
      LIVE_TV_EXTRA,
      'Mock Netflix, Prime Video, Max, Apple TV, Disney+, Hulu and Peacock',
      '4K',
      'Skip recap',
      'Six profiles',
      'Almost every style',
      'Ultra picks on Home',
    ],
    badges: ['4K', 'Dolby', 'Live'],
  }),
  priced({
    id: 'max',
    name: 'TVM MAX',
    basePricePence: 1599,
    liveTvAddonPence: LIVE_TV_ADDON_PENCE,
    mocks: true,
    liveTv: true,
    ads: false,
    stream: 'luxury',
    maxHeight: 2160,
    queueMs: 0,
    queueSkipToTop: false,
    startDelayMs: 0,
    weeklySeconds: null,
    profilesMax: 10,
    skipRecap: true,
    extras: [
      LIVE_TV_EXTRA,
      'Lightning-fast start',
      'Every style, including MAX Gold and Aurora',
      'Mock streaming services',
      '10 profiles',
      'MAX Exclusive row',
      'HDR and Atmos presentation',
    ],
    badges: ['4K', 'HDR', 'Atmos', 'Live'],
  }),
];

export interface DevOverrides {
  ads?: boolean;
  queue?: boolean;
  mocks?: boolean;
  liveTv?: boolean;
  maxHeight?: MaxHeight;
  startDelayMs?: number;
  weeklySeconds?: number | null;
}

export interface Entitlement {
  id: PlanId;
  styleId: StyleId;
  source: 'free' | 'checkout' | 'dev';
  overrides: DevOverrides;
  /** When set, overrides the plan default for the Live TV add-on. */
  liveTvAddon?: boolean;
  /** Paid Retro aesthetic. Independent of the monthly plan. */
  animeAddon?: boolean;
  themeBundle?: boolean;
  synthwaveAddon?: boolean;
}

/**
 * `mock` and `mode` are what separate a sandbox receipt from one backed by a
 * real card payment, and `chargedPence` is what was actually taken. They used
 * to be the literals `true`, `'sandbox'` and `0`, which made a real charge
 * impossible to represent; a sandbox receipt is now simply one where `mock` is
 * true and `chargedPence` is zero.
 */
export interface BillingReceipt {
  id: string;
  requestId: string;
  fingerprint: string;
  planId: PlanId;
  mock: boolean;
  mode: 'sandbox' | 'test' | 'live';
  event: 'checkout' | 'cancellation' | 'refund';
  currency: 'GBP';
  monthlyPence: number;
  oneTimePence: number;
  chargedPence: number;
  liveTv: boolean;
  animePurchased?: boolean;
  bundlePurchased?: boolean;
  synthwavePurchased: boolean;
  consentVersion: string;
  at: string;
  tokenId?: string;
  last4?: string;
  /** Present on a card payment. Ties the receipt to the Stripe dashboard. */
  paymentIntentId?: string;
  receiptUrl?: string | null;
}

export interface BillingStatus {
  mode: 'sandbox' | 'test' | 'live';
  livePaymentsEnabled: boolean;
  currency: 'GBP';
  subscription: 'free' | 'test-active' | 'active';
  monthlyPence: number;
  nextChargeAt: string | null;
  synthwaveOwned: boolean;
  anime?: boolean;
  bundle?: boolean;
  animeAddonPence?: number;
  themeBundlePence?: number;
  animeOwned?: boolean;
  bundleOwned?: boolean;
  receipts: BillingReceipt[];
  processor: { linked: boolean; reason: string; mode: 'test' | 'live' | null; webhookConfigured: boolean };
  paymentMethod: PublicCardToken | null;
}

interface BillingLedger {
  version: 2 | 3;
  receipts: BillingReceipt[];
  cards?: CardVaultState;
}

export const BILLING_CONSENT_VERSION = '2026-09-12-testing';

export interface UsageRecord {
  weekStart: string;
  seconds: number;
}

export interface PlanStatus {
  id: PlanId;
  name: string;
  price: string;
  pricePence: number;
  basePrice: string;
  basePricePence: number;
  liveTvAddonPence: number;
  liveTvOptional: boolean;
  synthwave: boolean;
  synthwaveOwned: boolean;
  anime: boolean;
  animeOwned: boolean;
  bundle: boolean;
  bundleOwned: boolean;
  animeAddonPence: number;
  themeBundlePence: number;
  synthwaveAddonPence: number;
  mocks: boolean;
  liveTv: boolean;
  ads: boolean;
  stream: StreamTier;
  maxHeight: MaxHeight;
  queueMs: number;
  queueSkipToTop: boolean;
  startDelayMs: number;
  weeklySeconds: number | null;
  weeklyUsedSeconds: number;
  weeklyRemainingSeconds: number | null;
  profilesMax: number;
  skipRecap: boolean;
  extras: string[];
  badges: string[];
  styleIds: StyleId[];
  styleId: StyleId;
  developer: boolean;
  catalog: PlanDefinition[];
  styles: StyleSpec[];
}

export interface CheckoutInput {
  planId?: unknown;
  name?: unknown;
  number?: unknown;
  expiry?: unknown;
  cvc?: unknown;
  liveTv?: unknown;
  pack?: unknown;
  synthwave?: unknown;
  consent?: unknown;
  requestId?: unknown;
  simulate?: unknown;
  packOnly?: unknown;
  quotedMonthlyPence?: unknown;
  quotedOneTimePence?: unknown;
  zip?: unknown;
}

function planRank(id: PlanId): number {
  return PLAN_IDS.indexOf(id);
}

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

export function isStyleId(value: unknown): value is StyleId {
  return typeof value === 'string' && (STYLE_IDS as readonly string[]).includes(value);
}

export function migratePlanId(value: unknown): PlanId | null {
  if (isPlanId(value)) return value;
  if (value === 'tvm-max' || value === 'gold') return 'max';
  return null;
}

export function definition(id: PlanId): PlanDefinition {
  return PLAN_CATALOG.find((entry) => entry.id === id) ?? PLAN_CATALOG[0]!;
}

export function liveTvIncluded(plan: PlanDefinition, addon: boolean | undefined): boolean {
  if (plan.liveTvAddonPence <= 0) return false;
  if (addon === true) return true;
  if (addon === false) return false;
  return plan.liveTv;
}

export function priceFor(plan: PlanDefinition, liveTv: boolean): { price: string; pricePence: number } {
  const pricePence = plan.basePricePence + (liveTv ? plan.liveTvAddonPence : 0);
  return { pricePence, price: formatGbp(pricePence) };
}

function extrasFor(plan: PlanDefinition, liveTv: boolean, synthwave: boolean): string[] {
  const extras = plan.extras.filter((line) => line !== LIVE_TV_EXTRA && line !== SYNTHWAVE_EXTRA);
  if (synthwave) extras.unshift(SYNTHWAVE_EXTRA);
  if (liveTv) extras.unshift(LIVE_TV_EXTRA);
  return extras;
}

function badgesFor(plan: PlanDefinition, liveTv: boolean): string[] {
  const badges = plan.badges.filter((badge) => badge !== 'Live');
  if (liveTv) badges.push('Live');
  return badges;
}

function checkoutWantsLiveTv(plan: PlanDefinition, value: unknown): boolean {
  if (plan.liveTvAddonPence <= 0) return false;
  if (value === false) return false;
  if (value === true) return true;
  return plan.liveTv;
}

export function stylesFor(id: PlanId): StyleId[] {
  return STYLE_CATALOG.filter((style) => planRank(id) >= planRank(style.minPlan)).map((style) => style.id);
}

function mondayUtc(now = new Date()): string {
  const day = now.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
  return monday.toISOString().slice(0, 10);
}

function defaultEntitlement(): Entitlement {
  return { id: 'free', styleId: 'classic', source: 'free', overrides: {} };
}

interface EntitlementSnapshot {
  id?: unknown;
  styleId?: unknown;
  source?: unknown;
  liveTvAddon?: unknown;
  animeAddon?: unknown;
  themeBundle?: unknown;
  synthwaveAddon?: unknown;
}

function writeSnapshot(dataDir: string, entitlement: Entitlement): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    planPath(dataDir),
    JSON.stringify({
      id: entitlement.id,
      styleId: entitlement.styleId,
      source: entitlement.source,
      liveTvAddon: entitlement.liveTvAddon ?? null,
      animeAddon: entitlement.animeAddon ?? null, themeBundle: entitlement.themeBundle ?? null,
      synthwaveAddon: entitlement.synthwaveAddon ?? null,
    }),
  );
}

function snapshotToEntitlement(raw: EntitlementSnapshot): Entitlement | null {
  const id = migratePlanId(raw.id);
  if (id === null) return null;
  const source = raw.source === 'checkout' || raw.source === 'dev' ? raw.source : id === 'free' ? 'free' : 'checkout';
  return {
    id,
    styleId: clampStyle(id, isStyleId(raw.styleId) ? raw.styleId : 'classic'),
    source,
    overrides: {},
    liveTvAddon: typeof raw.liveTvAddon === 'boolean' ? raw.liveTvAddon : undefined,
    animeAddon: raw.animeAddon === true ? true : undefined, themeBundle: raw.themeBundle === true ? true : undefined,
    synthwaveAddon: raw.synthwaveAddon === true ? true : undefined,
  };
}

function clampStyle(id: PlanId, styleId: StyleId): StyleId {
  const allowed = stylesFor(id);
  if (allowed.includes(styleId)) return styleId;
  return allowed[0] ?? 'classic';
}

function publicReceipt(receipt: BillingReceipt): BillingReceipt {
  return {
    id: receipt.id,
    requestId: receipt.requestId,
    fingerprint: receipt.fingerprint,
    planId: receipt.planId,
    mock: true,
    mode: 'sandbox',
    event: receipt.event,
    currency: 'GBP',
    monthlyPence: receipt.monthlyPence,
    oneTimePence: receipt.oneTimePence,
    chargedPence: 0,
    liveTv: receipt.liveTv,
    animePurchased: receipt.animePurchased, bundlePurchased: receipt.bundlePurchased,
    synthwavePurchased: receipt.synthwavePurchased,
    consentVersion: receipt.consentVersion,
    at: receipt.at,
    ...(typeof receipt.tokenId === 'string' && typeof receipt.last4 === 'string'
      ? { tokenId: receipt.tokenId, last4: receipt.last4 }
      : {}),
  };
}

export function createPlanService(options: { dataDir: string; developer?: () => boolean; env?: NodeJS.ProcessEnv }) {
  const dataDir = options.dataDir;

  const readLedger = (): BillingLedger => {
    const stored = readSealed<BillingLedger>(dataDir, billingPath(dataDir));
    // Legacy card-check receipts are deliberately not carried into the sandbox ledger.
    if ((stored?.version === 2 || stored?.version === 3) && Array.isArray(stored.receipts)) {
      return { version: 3, receipts: stored.receipts, cards: hydrateCardVault(stored.cards) };
    }
    return { version: 3, receipts: [], cards: emptyCardVault() };
  };

  const readReceipts = (): BillingReceipt[] => readLedger().receipts;

  const writeLedger = (receipts: BillingReceipt[], cards: CardVaultState): void => {
    writeSealed(dataDir, billingPath(dataDir), {
      version: 3,
      receipts,
      cards,
    } satisfies BillingLedger);
  };

  const saveReceipt = (receipt: BillingReceipt, cards?: CardVaultState): void => {
    const current = readLedger();
    writeLedger([receipt, ...current.receipts].slice(0, 100), cards ?? current.cards ?? emptyCardVault());
  };

  const requestKey = (input: { consent?: unknown; requestId?: unknown }): string => {
    if (options.env?.['TVM_ENV'] === 'production') throw new Error('Live billing is not configured. Use a private development build for test checkout.');
    if (input.consent !== true) throw new Error('Confirm that this is a test transaction with no real charge.');
    if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)) {
      throw new Error('A valid checkout request ID is required. Please reopen checkout.');
    }
    return input.requestId;
  };

  const alreadyProcessed = (requestId: string, fingerprint: string): boolean => {
    const previous = readReceipts().find((receipt) => receipt.requestId === requestId);
    if (previous === undefined) return false;
    if (previous.fingerprint !== fingerprint) throw new Error('This request ID was used for a different transaction.');
    return true;
  };

  const readUsage = (): UsageRecord => {
    const weekStart = mondayUtc();
    const stored = readSealed<UsageRecord>(dataDir, usagePath(dataDir));
    if (stored !== null && stored.weekStart === weekStart && Number.isFinite(stored.seconds)) return stored;
    return { weekStart, seconds: 0 };
  };

  const writeUsage = (record: UsageRecord): void => {
    writeSealed(dataDir, usagePath(dataDir), record);
  };

  const readEntitlement = (): Entitlement => {
    const sealed = readSealed<Entitlement>(dataDir, entitlementPath(dataDir));
    if (sealed !== null && isPlanId(sealed.id)) {
      const next = {
        id: sealed.id,
        styleId: clampStyle(sealed.id, isStyleId(sealed.styleId) ? sealed.styleId : 'classic'),
        source: sealed.source === 'checkout' || sealed.source === 'dev' ? sealed.source : 'free',
        overrides: sealed.overrides ?? {},
        liveTvAddon: typeof sealed.liveTvAddon === 'boolean' ? sealed.liveTvAddon : undefined,
        animeAddon: sealed.animeAddon === true ? true : undefined, themeBundle: sealed.themeBundle === true ? true : undefined,
    synthwaveAddon: sealed.synthwaveAddon === true ? true : undefined,
      } satisfies Entitlement;
      if (!existsSync(planPath(dataDir))) writeSnapshot(dataDir, next);
      return next;
    }
    if (existsSync(entitlementPath(dataDir))) return defaultEntitlement();
    if (existsSync(planPath(dataDir))) {
      try {
        const raw = JSON.parse(readFileSync(planPath(dataDir), 'utf8')) as EntitlementSnapshot;
        const next = snapshotToEntitlement(raw);
        if (next !== null) {
          try {
            writeSealed(dataDir, entitlementPath(dataDir), next);
          } catch {
            // Vault can stay unread; the snapshot is enough to keep the plan.
          }
          writeSnapshot(dataDir, next);
          return next;
        }
      } catch {
        // Fall through to default.
      }
    }
    return defaultEntitlement();
  };

  const writeEntitlement = (next: Entitlement): Entitlement => {
    const stored = {
      ...next,
      styleId: clampStyle(next.id, next.styleId),
    };
    writeSealed(dataDir, entitlementPath(dataDir), stored);
    writeSnapshot(dataDir, stored);
    return stored;
  };

  const compose = (entitlement = readEntitlement()): PlanStatus => {
    const base = definition(entitlement.id);
    const developer = options.developer?.() === true;
    const over = developer ? entitlement.overrides : {};
    const ads = over.ads ?? base.ads;
    const mocks = over.mocks ?? base.mocks;
    const liveTv = over.liveTv ?? liveTvIncluded(base, entitlement.liveTvAddon);
    const bundleOwned = entitlement.themeBundle === true;
    const animeOwned = bundleOwned || entitlement.animeAddon === true;
    const synthwaveOwned = bundleOwned || entitlement.synthwaveAddon === true;
    const synthwave = developer || synthwaveOwned;
    const charged = priceFor(base, liveTv);
    const maxHeight = over.maxHeight ?? base.maxHeight;
    const startDelayMs = over.startDelayMs ?? base.startDelayMs;
    const weeklySeconds = over.weeklySeconds === undefined ? base.weeklySeconds : over.weeklySeconds;
    const queueOn = over.queue ?? base.queueMs > 0;
    const queueMs = queueOn ? (over.queue === false ? 0 : base.queueMs || 3500) : 0;
    const usage = readUsage();
    const remaining =
      weeklySeconds === null ? null : Math.max(0, weeklySeconds - usage.seconds);
    const styleIds = developer ? [...STYLE_IDS] : stylesFor(entitlement.id);
    const styleId = styleIds.includes(entitlement.styleId) ? entitlement.styleId : (styleIds[0] ?? 'classic');
    return {
      id: entitlement.id,
      name: base.name,
      price: charged.price,
      pricePence: charged.pricePence,
      basePrice: base.basePrice,
      basePricePence: base.basePricePence,
      liveTvAddonPence: base.liveTvAddonPence,
      liveTvOptional: base.liveTvAddonPence > 0,
      synthwave,
      synthwaveOwned,
      anime: developer || animeOwned, animeOwned, bundle: developer || bundleOwned, bundleOwned, animeAddonPence: ANIME_ADDON_PENCE, themeBundlePence: THEME_BUNDLE_PENCE,
      synthwaveAddonPence: SYNTHWAVE_ADDON_PENCE,
      mocks,
      liveTv,
      ads,
      stream: base.stream,
      maxHeight,
      queueMs,
      queueSkipToTop: base.queueSkipToTop,
      startDelayMs,
      weeklySeconds,
      weeklyUsedSeconds: usage.seconds,
      weeklyRemainingSeconds: remaining,
      profilesMax: base.profilesMax,
      skipRecap: base.skipRecap || entitlement.id === 'ultra' || entitlement.id === 'max',
      extras: extrasFor(base, liveTv, synthwaveOwned),
      badges: badgesFor(base, liveTv),
      styleIds,
      styleId,
      developer,
      catalog: [...PLAN_CATALOG],
      styles: [...STYLE_CATALOG],
    };
  };

  /**
   * Prices an order.
   *
   * The single place a total is worked out, so the amount a card is charged
   * cannot drift from the amount the sandbox records or the interface quoted.
   * Every caller passes the buyer's *request*; the price comes from the
   * catalogue here, never from the client.
   */
  const priceOrder = (input: CheckoutInput, card: boolean) => {
    if (!isPlanId(input.planId)) throw new Error('unknown_plan');
    for (const value of [input.liveTv, input.synthwave, input.packOnly]) {
      if (value !== undefined && typeof value !== 'boolean') throw new Error('Invalid checkout option.');
    }
    if (input.pack !== undefined && (typeof input.pack !== 'string' || !['anime', 'synthwave', 'theme-bundle'].includes(input.pack))) {
      throw new Error('Unknown theme pack.');
    }
    const current = readEntitlement();
    const plan = definition(input.packOnly === true ? current.id : input.planId);
    const includeLive = input.packOnly === true
      ? liveTvIncluded(plan, current.liveTvAddon)
      : checkoutWantsLiveTv(plan, input.liveTv);
    const includeBundle = input.pack === 'theme-bundle';
    const includeAnime = includeBundle || input.pack === 'anime';
    const includeSynthwave = includeBundle || input.pack === 'synthwave' || input.synthwave === true;
    const monthlyPence = priceFor(plan, includeLive).pricePence;
    const oneTimePence = current.themeBundle
      ? 0
      : includeBundle
        ? THEME_BUNDLE_PENCE
        : (includeAnime && !current.animeAddon ? ANIME_ADDON_PENCE : 0)
          + (includeSynthwave && !current.synthwaveAddon ? SYNTHWAVE_ADDON_PENCE : 0);
    const fingerprint = JSON.stringify({
      event: 'checkout', pack: input.pack ?? null, planId: input.planId, liveTv: input.liveTv ?? null,
      synthwave: includeSynthwave, packOnly: input.packOnly === true,
      quotedMonthlyPence: input.quotedMonthlyPence ?? null,
      quotedOneTimePence: input.quotedOneTimePence ?? null,
      card,
    });
    // A quote the buyer has already seen must not change under them.
    if ((input.quotedMonthlyPence !== undefined && input.quotedMonthlyPence !== monthlyPence)
      || (input.quotedOneTimePence !== undefined && input.quotedOneTimePence !== oneTimePence)) {
      throw new Error('The order has changed. Reopen checkout to review the current total.');
    }
    return { current, plan, includeLive, includeAnime, includeBundle, includeSynthwave, monthlyPence, oneTimePence, fingerprint };
  };

  /** Applies what an order bought. Shared by the sandbox and the card path. */
  const applyOrder = (priced: ReturnType<typeof priceOrder>): void => {
    const { current, plan, includeLive, includeAnime, includeBundle, includeSynthwave } = priced;
    writeEntitlement({
      ...current,
      id: plan.id,
      source: plan.id === 'free' && !includeSynthwave && !includeAnime ? 'free' : 'checkout',
      styleId: clampStyle(plan.id, current.styleId),
      liveTvAddon: includeLive,
      animeAddon: includeAnime ? true : current.animeAddon,
      themeBundle: includeBundle ? true : current.themeBundle,
      synthwaveAddon: includeSynthwave ? true : current.synthwaveAddon,
    });
  };

  return {
    status(): PlanStatus {
      return compose();
    },
    catalog(): PlanDefinition[] {
      return [...PLAN_CATALOG];
    },
    set(id: PlanId, source: Entitlement['source']): PlanStatus {
      const current = readEntitlement();
      writeEntitlement({
        ...current,
        id,
        source,
        styleId: clampStyle(id, current.styleId),
        liveTvAddon: undefined,
      });
      return compose();
    },
    setLiveTv(enabled: boolean): PlanStatus {
      const current = readEntitlement();
      const plan = definition(current.id);
      if (plan.liveTvAddonPence <= 0) {
        throw new Error('Live TV is a paid add-on from Basic up.');
      }
      writeEntitlement({ ...current, liveTvAddon: enabled });
      return compose();
    },
    setSynthwave(enabled: boolean): PlanStatus {
      const current = readEntitlement();
      const developer = options.developer?.() === true;
      if (enabled && !developer && current.source !== 'checkout' && current.source !== 'dev') {
        throw new Error('Retro is a paid pack. Open Plans to buy it, or unlock developer mode.');
      }
      writeEntitlement({ ...current, synthwaveAddon: enabled ? true : undefined });
      return compose();
    },
    setStyle(styleId: StyleId): PlanStatus {
      const current = readEntitlement();
      const allowed = options.developer?.() === true ? STYLE_IDS : stylesFor(current.id);
      if (!(allowed as readonly string[]).includes(styleId)) {
        throw new Error('That style is locked on this plan.');
      }
      writeEntitlement({ ...current, styleId });
      return compose();
    },
    setOverrides(overrides: DevOverrides): PlanStatus {
      const current = readEntitlement();
      writeEntitlement({ ...current, overrides: { ...current.overrides, ...overrides } });
      return compose();
    },
    clearOverrides(): PlanStatus {
      const current = readEntitlement();
      writeEntitlement({ ...current, overrides: {} });
      return compose();
    },
    checkout(input: CheckoutInput): PlanStatus {
      let intake: CardIntake | null = null;
      if (cardFieldsPresent(input)) {
        const parsed = parseCardIntake(input);
        if (!parsed.ok) {
          throw new Error(`${CARD_DATA_NOT_SUPPORTED}: Card details are invalid or incomplete.`);
        }
        intake = parsed.intake;
      }
      const requestId = requestKey(input);
      if (input.simulate !== undefined && !['success', 'decline', 'cancel'].includes(String(input.simulate))) {
        throw new Error('Invalid test outcome.');
      }
      const priced = priceOrder(input, intake !== null);
      const { plan, includeLive, includeAnime, includeBundle, includeSynthwave, monthlyPence, oneTimePence, fingerprint } = priced;
      if (alreadyProcessed(requestId, fingerprint)) return compose();
      if (input.simulate === 'decline') throw new Error('Test payment declined. Your plan has not changed. Choose Success to try again.');
      if (input.simulate === 'cancel') throw new Error('Test checkout cancelled. Your plan has not changed.');
      const ledger = readLedger();
      let cards = ledger.cards ?? emptyCardVault();
      let tokenId: string | undefined;
      let last4: string | undefined;
      if (intake !== null) {
        const minted = tokenizeCard(dataDir, intake);
        cards = rememberToken(cards, minted.token);
        tokenId = minted.token.tokenId;
        last4 = minted.token.last4;
      }
      applyOrder(priced);
      saveReceipt({
        id: `TEST-${randomUUID()}`,
        requestId,
        fingerprint,
        planId: plan.id,
        mock: true,
        mode: 'sandbox',
        event: 'checkout',
        currency: 'GBP',
        monthlyPence,
        oneTimePence,
        chargedPence: 0,
        liveTv: includeLive,
        animePurchased: includeAnime, bundlePurchased: includeBundle,
        synthwavePurchased: includeSynthwave,
        consentVersion: BILLING_CONSENT_VERSION,
        at: new Date().toISOString(),
        ...(tokenId !== undefined ? { tokenId, last4 } : {}),
      }, cards);
      return compose();
    },
    /**
     * Prices an order for the card path.
     *
     * Deliberately shares priceOrder with the sandbox checkout, so the figure
     * a card is charged is the same figure the catalogue quotes. Grants
     * nothing — the buyer has not paid at this point.
     */
    quote(input: Record<string, unknown>): OrderQuote {
      const priced = priceOrder(input as CheckoutInput, false);
      const parts = [priced.plan.name];
      if (priced.includeLive) parts.push('Live TV');
      if (priced.includeBundle) parts.push('theme bundle');
      else {
        if (priced.includeAnime) parts.push('Anime pack');
        if (priced.includeSynthwave) parts.push('Retro pack');
      }
      return {
        planId: priced.plan.id,
        fingerprint: priced.fingerprint,
        monthlyPence: priced.monthlyPence,
        oneTimePence: priced.oneTimePence,
        // Taken now: the first month plus any one-off packs.
        amountPence: priced.monthlyPence + priced.oneTimePence,
        liveTv: priced.includeLive,
        anime: priced.includeAnime,
        bundle: priced.includeBundle,
        synthwave: priced.includeSynthwave,
        packOnly: (input as CheckoutInput).packOnly === true,
        description: `TVM — ${parts.join(' + ')}`,
      };
    },

    /**
     * Applies a paid order. Called only after Stripe has confirmed the money
     * moved, from the webhook and from the buyer's return trip, so it has to be
     * safe to run twice: a receipt already written for this payment wins.
     */
    grantPaid(order: PaymentOrder, payment: SettledPayment): PlanStatus {
      const existing = readReceipts().find((receipt) => receipt.paymentIntentId === order.paymentIntentId);
      if (existing !== undefined) return compose();
      const priced = priceOrder({
        planId: order.planId,
        liveTv: order.liveTv,
        synthwave: order.synthwave,
        packOnly: order.packOnly,
        pack: order.bundle ? 'theme-bundle' : order.anime ? 'anime' : order.synthwave ? 'synthwave' : undefined,
      } as CheckoutInput, false);
      applyOrder(priced);
      saveReceipt({
        id: order.paymentIntentId,
        requestId: order.requestId,
        fingerprint: order.fingerprint,
        planId: priced.plan.id,
        mock: false,
        mode: payment.mode,
        event: 'checkout',
        currency: 'GBP',
        monthlyPence: order.monthlyPence,
        oneTimePence: order.oneTimePence,
        chargedPence: payment.chargedPence,
        liveTv: order.liveTv,
        animePurchased: order.anime,
        bundlePurchased: order.bundle,
        synthwavePurchased: order.synthwave,
        consentVersion: BILLING_CONSENT_VERSION,
        at: payment.at,
        paymentIntentId: order.paymentIntentId,
        receiptUrl: payment.receiptUrl,
      });
      return compose();
    },

    /** Takes back what a refunded order bought, and records why. */
    revokePaid(order: PaymentOrder): PlanStatus {
      const current = readEntitlement();
      writeEntitlement({
        ...current,
        id: 'free',
        source: 'free',
        styleId: 'classic',
        liveTvAddon: false,
        ...(order.anime ? { animeAddon: undefined } : {}),
        ...(order.bundle ? { themeBundle: undefined } : {}),
        ...(order.synthwave ? { synthwaveAddon: undefined } : {}),
      });
      saveReceipt({
        id: `refund_${order.paymentIntentId}`,
        requestId: order.requestId,
        fingerprint: order.fingerprint,
        planId: 'free',
        mock: false,
        mode: order.mode,
        event: 'refund',
        currency: 'GBP',
        monthlyPence: 0,
        oneTimePence: 0,
        chargedPence: -order.refundedPence,
        liveTv: false,
        synthwavePurchased: false,
        consentVersion: BILLING_CONSENT_VERSION,
        at: new Date().toISOString(),
        paymentIntentId: order.paymentIntentId,
      });
      return compose();
    },

    cancel(input: { consent?: unknown; requestId?: unknown }): PlanStatus {
      const requestId = requestKey(input);
      const fingerprint = JSON.stringify({ event: 'cancellation' });
      if (alreadyProcessed(requestId, fingerprint)) return compose();
      const current = readEntitlement();
      writeEntitlement({ ...current, id: 'free', source: 'free', styleId: 'classic', liveTvAddon: false });
      saveReceipt({
        id: `TEST-${randomUUID()}`, requestId, fingerprint, planId: 'free', mock: true,
        mode: 'sandbox', event: 'cancellation', currency: 'GBP', monthlyPence: 0,
        oneTimePence: 0, chargedPence: 0, liveTv: false, synthwavePurchased: false,
        consentVersion: BILLING_CONSENT_VERSION, at: new Date().toISOString(),
      });
      return compose();
    },
    billing(): BillingStatus {
      const status = compose();
      const ledger = readLedger();
      const stripe = publicStripeStatus(loadStripeConfig(dataDir, options.env ?? process.env));
      const paidByCard = ledger.receipts.some((receipt) => receipt.mock === false && receipt.event === 'checkout');
      return {
        mode: stripe.configured && stripe.mode !== null ? stripe.mode : 'sandbox',
        livePaymentsEnabled: stripe.configured && stripe.mode === 'live',
        currency: 'GBP',
        subscription: status.id === 'free' ? 'free' : paidByCard ? 'active' : 'test-active',
        monthlyPence: status.pricePence,
        nextChargeAt: null, anime: status.anime, bundle: status.bundle, animeAddonPence: ANIME_ADDON_PENCE, themeBundlePence: THEME_BUNDLE_PENCE, animeOwned: status.animeOwned, bundleOwned: status.bundleOwned, synthwaveOwned: status.synthwaveOwned, receipts: ledger.receipts.map(publicReceipt),
        processor: {
          linked: stripe.configured,
          reason: stripe.reason ?? (stripe.mode === 'live' ? 'stripe_live' : 'stripe_test'),
          mode: stripe.mode,
          webhookConfigured: stripe.webhookConfigured,
        },
        paymentMethod: publicPaymentMethod(ledger.cards ?? emptyCardVault()),
      };
    },
    charge(input: { tokenId?: unknown } = {}): ChargeResult {
      const ledger = readLedger();
      const cards = ledger.cards ?? emptyCardVault();
      const token = findToken(cards, typeof input.tokenId === 'string' ? input.tokenId : undefined);
      // Nothing to charge against: no card number is kept. A real charge goes
      // through /api/billing/intent and Stripe.
      return declineCharge(token);
    },
    receipt(): BillingReceipt | null {
      return readReceipts()[0] ?? null;
    },
    tickUsage(seconds: number, billable: boolean): PlanStatus {
      if (!billable || !Number.isFinite(seconds) || seconds <= 0) return compose();
      const usage = readUsage();
      writeUsage({ ...usage, seconds: usage.seconds + Math.round(seconds) });
      return compose();
    },
    resetUsage(): PlanStatus {
      writeUsage({ weekStart: mondayUtc(), seconds: 0 });
      return compose();
    },
    hoursBlocked(): boolean {
      const status = compose();
      return status.weeklyRemainingSeconds !== null && status.weeklyRemainingSeconds <= 0;
    },
    poolToken(): string | null {
      const sealed = readSealed<{ token?: string }>(dataDir, poolRdPath(dataDir));
      const token = sealed?.token?.trim();
      return token !== undefined && token !== '' ? token : null;
    },
    setPoolToken(token: string): void {
      writeSealed(dataDir, poolRdPath(dataDir), { token: token.trim() });
    },
    clearBilling(): void {
      deleteSecret(billingPath(dataDir));
      deleteSecret(entitlementPath(dataDir));
      deleteSecret(usagePath(dataDir));
      deleteSecret(poolRdPath(dataDir));
    },
  };
}

export type PlanService = ReturnType<typeof createPlanService>;
