import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  billingPath,
  entitlementPath,
  planPath,
  poolRdPath,
  usagePath,
} from '../update/paths.ts';
import { cvcOk, expiryOk, lastFour, luhnOk } from './card.ts';
import { deleteSecret } from './secrets.ts';
import { readSealed, writeSealed } from './vault.ts';

export const PLAN_IDS = ['free', 'basic', 'premium', 'ultra', 'max'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Live TV pack on paid plans. Removing it restores the previous list price. */
export const LIVE_TV_ADDON_PENCE = 300;
export const LIVE_TV_EXTRA = 'Live TV pack and your own playlist';

/** Colourcast — 1970s/80s broadcast ident pack. Sold on every plan, including Free. */
export const SYNTHWAVE_ADDON_PENCE = 499;
export const SYNTHWAVE_EXTRA = 'Colourcast — 1970s/80s broadcast ident';

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
  /** Paid Colourcast aesthetic. Independent of the monthly plan. */
  synthwaveAddon?: boolean;
}

export interface BillingReceipt {
  planId: PlanId;
  mock: true;
  last4: string | null;
  at: string;
}

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
  synthwave?: unknown;
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

export function priceFor(plan: PlanDefinition, liveTv: boolean, synthwave = false): { price: string; pricePence: number } {
  const pricePence =
    plan.basePricePence + (liveTv ? plan.liveTvAddonPence : 0) + (synthwave ? SYNTHWAVE_ADDON_PENCE : 0);
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
    synthwaveAddon: raw.synthwaveAddon === true ? true : undefined,
  };
}

function clampStyle(id: PlanId, styleId: StyleId): StyleId {
  const allowed = stylesFor(id);
  if (allowed.includes(styleId)) return styleId;
  return allowed[0] ?? 'classic';
}

export function createPlanService(options: { dataDir: string; developer?: () => boolean }) {
  const dataDir = options.dataDir;

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
        synthwaveAddon: sealed.synthwaveAddon === true ? true : undefined,
      } satisfies Entitlement;
      if (!existsSync(planPath(dataDir))) writeSnapshot(dataDir, next);
      return next;
    }
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
    const synthwaveOwned = entitlement.synthwaveAddon === true;
    const synthwave = developer || synthwaveOwned;
    const charged = priceFor(base, liveTv, synthwaveOwned);
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
        throw new Error('Colourcast is a paid pack. Open Plans to buy it, or unlock developer mode.');
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
      if (!isPlanId(input.planId)) throw new Error('unknown_plan');
      const plan = definition(input.planId);
      const includeLive = checkoutWantsLiveTv(plan, input.liveTv);
      const includeSynthwave = input.synthwave === true;
      const current = readEntitlement();
      if (plan.basePricePence === 0 && !includeSynthwave) {
        writeEntitlement({
          ...current,
          id: plan.id,
          source: 'free',
          styleId: clampStyle(plan.id, current.styleId),
          liveTvAddon: false,
          synthwaveAddon: undefined,
        });
        writeSealed(dataDir, billingPath(dataDir), {
          planId: plan.id,
          mock: true,
          last4: null,
          at: new Date().toISOString(),
        } satisfies BillingReceipt);
        return compose();
      }
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const number = typeof input.number === 'string' ? input.number : '';
      const expiry = typeof input.expiry === 'string' ? input.expiry : '';
      const cvc = typeof input.cvc === 'string' ? input.cvc : '';
      if (name.length < 2) throw new Error('Enter the name on the card.');
      if (!luhnOk(number)) throw new Error('That card number is not valid.');
      if (!expiryOk(expiry)) throw new Error('That expiry date is not valid.');
      if (!cvcOk(cvc)) throw new Error('That security code is not valid.');
      const four = lastFour(number);
      writeEntitlement({
        ...current,
        id: plan.id,
        source: 'checkout',
        styleId: clampStyle(plan.id, current.styleId),
        liveTvAddon: includeLive,
        synthwaveAddon: includeSynthwave ? true : current.synthwaveAddon,
      });
      writeSealed(dataDir, billingPath(dataDir), {
        planId: plan.id,
        mock: true,
        last4: four,
        at: new Date().toISOString(),
      } satisfies BillingReceipt);
      return compose();
    },
    receipt(): BillingReceipt | null {
      return readSealed<BillingReceipt>(dataDir, billingPath(dataDir));
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
