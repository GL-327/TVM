import { THEMES } from '../theme/registry';
import { MOBILE_PLAN_EVENT } from './mobileAccess';

export type LiveTvTerm = 'quarter' | 'year' | 'lifetime';

export interface LiveTvTermSpec {
  id: LiveTvTerm;
  name: string;
  usdCents: number;
  amountPence: number;
  interval: 'month' | 'year' | null;
  intervalCount: number;
  blurb: string;
}

export const LIVE_TV_TERMS: readonly LiveTvTermSpec[] = [
  { id: 'quarter', name: '3-month', usdCents: 3999, amountPence: 3999, interval: 'month', intervalCount: 3, blurb: 'Billed every 3 months' },
  { id: 'year', name: '1-year', usdCents: 8999, amountPence: 8999, interval: 'year', intervalCount: 1, blurb: 'Billed once per year' },
  { id: 'lifetime', name: 'Lifetime', usdCents: 59900, amountPence: 59900, interval: null, intervalCount: 0, blurb: 'One payment; access lasts only while the service stays online' },
];

export function formatUsdCents(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export type PlanId = 'free' | 'basic' | 'premium' | 'ultra' | 'max';
export type StyleId =
  | 'classic'
  | 'cinema'
  | 'midnight'
  | 'ember'
  | 'forest'
  | 'slate'
  | 'contrast'
  | 'gold'
  | 'aurora';
export type StreamTier = 'basic' | 'premium' | 'luxury';

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
  basePrice?: string;
  basePricePence?: number;
  liveTvAddonPence?: number;
  mocks: boolean;
  liveTv: boolean;
  extras: string[];
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
  liveTvTerm: LiveTvTerm | null;
  liveTvExpiresAt: string | null;
  liveTvTerms: LiveTvTermSpec[];
  ads: boolean;
  stream: StreamTier;
  maxHeight: 720 | 1080 | 2160;
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

export const FALLBACK_PLAN: PlanStatus = {
  id: 'free',
  name: 'TVM Free',
  price: 'Free',
  pricePence: 0,
  basePrice: 'Free',
  basePricePence: 0,
  liveTvAddonPence: 0,
  liveTvOptional: false,
  synthwave: false,
  synthwaveOwned: false,
  anime: false, animeOwned: false, bundle: false, bundleOwned: false, animeAddonPence: 499, themeBundlePence: 999,
  synthwaveAddonPence: 499,
  mocks: false,
  liveTv: false,
  liveTvTerm: null,
  liveTvExpiresAt: null,
  liveTvTerms: [...LIVE_TV_TERMS],
  ads: false,
  stream: 'basic',
  maxHeight: 720,
  queueMs: 28_000,
  queueSkipToTop: false,
  startDelayMs: 2500,
  weeklySeconds: 12 * 60 * 60,
  weeklyUsedSeconds: 0,
  weeklyRemainingSeconds: 12 * 60 * 60,
  profilesMax: 1,
  skipRecap: false,
  extras: [],
  badges: [],
  styleIds: [],
  styleId: 'classic',
  developer: false,
  catalog: [],
  styles: [...STYLE_CATALOG],
};

function asPlan(body: Partial<PlanStatus>): PlanStatus {
  if (
    body.id !== 'free' &&
    body.id !== 'basic' &&
    body.id !== 'premium' &&
    body.id !== 'ultra' &&
    body.id !== 'max'
  ) {
    return FALLBACK_PLAN;
  }
  return { ...FALLBACK_PLAN, ...body, id: body.id };
}

async function requestJson<T>(url: string, init: RequestInit = {}, timeoutMs = 10_000, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? 'The request could not be completed. Please try again.');
    return body;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The service took too long to respond. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function fetchPlan(signal?: AbortSignal, strict = false): Promise<PlanStatus> {
  try {
    const body = await requestJson<Partial<PlanStatus>>('/api/plan', {}, 5_000, signal);
    if (strict && (!body.id || !Array.isArray(body.catalog) || body.catalog.length === 0)) {
      throw new Error('Plan information is unavailable. Please try again.');
    }
    return asPlan(body);
  } catch (error) {
    if (strict) throw error;
    return FALLBACK_PLAN;
  }
}

export interface BillingReceipt {
  id: string;
  planId: PlanId;
  /** 'sandbox' takes no money; 'test' and 'live' are Stripe payments. */
  mode: 'sandbox' | 'test' | 'live';
  mock?: boolean;
  event: 'checkout' | 'cancellation' | 'refund';
  currency: 'GBP';
  monthlyPence: number;
  oneTimePence: number;
  chargedPence: number;
  paymentIntentId?: string;
  receiptUrl?: string | null;
  liveTv: boolean;
  animePurchased?: boolean;
  bundlePurchased?: boolean;
  synthwavePurchased: boolean;
  at: string;
  tokenId?: string;
  last4?: string;
}

export interface PublicCardToken {
  tokenId: string;
  last4: string;
  brand: string;
  expiry: string;
  name: string;
  zip: string | null;
  createdAt: string;
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
  processor?: { linked: boolean; reason: string; mode: 'test' | 'live' | null; webhookConfigured: boolean };
  paymentMethod?: PublicCardToken | null;
}

export interface CheckoutRequest {
  planId: PlanId;
  consent: boolean;
  requestId: string;
  liveTv?: boolean;
  liveTvTerm?: LiveTvTerm | null;
  pack?: 'synthwave' | 'anime' | 'theme-bundle';
  synthwave?: boolean;
  simulate?: 'success' | 'decline' | 'cancel';
  packOnly?: boolean;
  quotedMonthlyPence?: number;
  quotedOneTimePence?: number;
  name?: string;
  number?: string;
  expiry?: string;
  cvc?: string;
  zip?: string;
}

/** What /api/billing/stripe reports. The secret key is never part of it. */
export interface StripeStatus {
  configured: boolean;
  mode: 'test' | 'live' | null;
  publishableKey: string | null;
  webhookConfigured: boolean;
  reason: string | null;
}

export interface PaymentIntentStart {
  paymentIntentId: string;
  clientSecret: string;
  publishableKey: string;
  amountPence: number;
  monthlyPence: number;
  oneTimePence: number;
  currency: 'GBP';
  mode: 'test' | 'live';
  description: string;
}

export interface PaymentOrderView {
  paymentIntentId: string;
  planId: string;
  amountPence: number;
  chargedPence: number;
  refundedPence: number;
  currency: 'GBP';
  mode: 'test' | 'live';
  status: 'pending' | 'paid' | 'failed' | 'canceled' | 'refunded';
  createdAt: string;
  settledAt: string | null;
  receiptUrl: string | null;
  failureMessage: string | null;
}

export interface ChargeResult {
  status: 'declined';
  reason: 'no_processor' | 'missing_token';
  code: 'not_configured' | 'missing_token';
  chargedPence: 0;
  tokenId: string | null;
  last4: string | null;
  message: string;
}

export function formatBillingMoney(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatPanInput(value: string): string {
  return digitsOnly(value).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

export function formatExpiryInput(value: string): string {
  const digits = digitsOnly(value).slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function formatCvcInput(value: string): string {
  return digitsOnly(value).slice(0, 4);
}

export function panLooksValid(value: string): boolean {
  const digits = digitsOnly(value);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function expiryLooksValid(value: string, now = new Date()): boolean {
  const match = value.trim().match(/^(\d{1,2})\s*[/-]\s*(\d{2}|\d{4})$/);
  if (match === null || match[1] === undefined || match[2] === undefined) return false;
  const month = Number(match[1]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  let year = Number(match[2]);
  if (year < 100) year += 2000;
  if (year < now.getFullYear()) return false;
  if (year === now.getFullYear() && month < now.getMonth() + 1) return false;
  return true;
}

export function cvcLooksValid(value: string): boolean {
  return /^\d{3,4}$/.test(value.trim());
}

export function cardholderLooksValid(value: string): boolean {
  const name = value.trim();
  return name.length >= 2 && name.length <= 80 && /[A-Za-z]/.test(name);
}

export function checkoutQuote(
  plan: PlanStatus,
  selectedId: PlanId,
  liveTv: boolean,
  synthwave: boolean,
  packOnly = false,
  pack?: ThemePack,
  liveTvTerm: LiveTvTerm | null = null,
): {
  monthlyPence: number;
  oneTimePence: number;
  liveTvPence: number;
  liveTvTerm: LiveTvTerm | null;
  dueTodayPence: number;
  referenceTotalPence: number;
} {
  const entry = plan.catalog.find((item) => item.id === (packOnly ? plan.id : selectedId));
  if (entry === undefined || entry.basePricePence === undefined) throw new Error('Plan information is unavailable.');
  const terms = plan.liveTvTerms.length > 0 ? plan.liveTvTerms : LIVE_TV_TERMS;
  const term = packOnly ? plan.liveTvTerm : (liveTvTerm ?? (liveTv ? 'quarter' : null));
  const spec = term === null ? null : terms.find((row) => row.id === term) ?? null;
  const monthlyPence = packOnly ? 0 : entry.basePricePence;
  const liveTvPence = packOnly || spec === null || spec.id === 'lifetime' ? 0 : spec.amountPence;
  const lifetimePence = packOnly || spec === null || spec.id !== 'lifetime' ? 0 : spec.amountPence;
  const packPence = pack === 'theme-bundle'
    ? (plan.bundleOwned ? 0 : plan.themeBundlePence)
    : pack === 'anime'
      ? (plan.animeOwned || plan.bundleOwned ? 0 : plan.animeAddonPence)
      : synthwave && !plan.synthwaveOwned && !plan.bundleOwned ? plan.synthwaveAddonPence : 0;
  const oneTimePence = packPence + lifetimePence;
  const dueTodayPence = monthlyPence + liveTvPence + oneTimePence;
  return { monthlyPence, oneTimePence, liveTvPence, liveTvTerm: spec?.id ?? null, dueTodayPence, referenceTotalPence: dueTodayPence };
}

function checkedPlan(body: Partial<PlanStatus>): PlanStatus {
  if (!body.id || !['free', 'basic', 'premium', 'ultra', 'max'].includes(body.id)) {
    throw new Error('The service returned an invalid plan. Reload before trying again.');
  }
  return asPlan(body);
}

export async function checkoutPlan(input: CheckoutRequest): Promise<PlanStatus> {
  const body = await requestJson<Partial<PlanStatus>>('/api/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return checkedPlan(body);
}

export async function fetchBilling(signal?: AbortSignal): Promise<BillingStatus> {
  const body = await requestJson<BillingStatus>('/api/billing', {}, 5_000, signal);
  // This used to insist on mode === 'sandbox', which made the screen throw as
  // soon as a real processor was configured. The shape is what matters.
  if (!['sandbox', 'test', 'live'].includes(body.mode) || !Array.isArray(body.receipts)) {
    throw new Error('Billing information is unavailable. Please try again.');
  }
  return body;
}

export async function cancelPlan(requestId: string): Promise<PlanStatus> {
  return checkedPlan(await requestJson<Partial<PlanStatus>>('/api/billing/cancel', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ consent: true, requestId }),
  }));
}

export async function chargeSavedCard(tokenId?: string): Promise<ChargeResult> {
  return requestJson<ChargeResult>('/api/billing/charge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(tokenId === undefined ? {} : { tokenId }),
  });
}

export async function savePlan(id: PlanId): Promise<PlanStatus> {
  const response = await fetch('/api/plan', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const body = (await response.json()) as Partial<PlanStatus> & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Plan was not saved.');
  return asPlan(body);
}

export async function saveLiveTv(enabled: boolean): Promise<PlanStatus> {
  const response = await fetch('/api/plan/live-tv', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  const body = (await response.json()) as Partial<PlanStatus> & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Live TV was not updated.');
  return asPlan(body);
}

export async function saveSynthwave(enabled: boolean): Promise<PlanStatus> {
  const response = await fetch('/api/plan/synthwave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  const body = (await response.json()) as Partial<PlanStatus> & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Retro was not updated.');
  return asPlan(body);
}

export async function saveStyle(id: StyleId): Promise<PlanStatus> {
  const response = await fetch('/api/plan/style', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const body = (await response.json()) as Partial<PlanStatus> & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'That style is locked.');
  return asPlan(body);
}

export async function tickUsage(seconds: number, billable: boolean): Promise<PlanStatus> {
  const response = await fetch('/api/usage/tick', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seconds, billable }),
  });
  if (!response.ok) return FALLBACK_PLAN;
  return asPlan((await response.json()) as Partial<PlanStatus>);
}

export async function resetUsage(): Promise<PlanStatus> {
  const response = await fetch('/api/usage/reset', { method: 'POST' });
  const body = (await response.json()) as Partial<PlanStatus> & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Hours were not reset.');
  return asPlan(body);
}

export async function unlockDeveloper(password: string): Promise<{ unlocked: boolean; error?: string }> {
  const response = await fetch('/api/dev/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return (await response.json()) as { unlocked: boolean; error?: string };
}

export async function lockDeveloper(): Promise<void> {
  await fetch('/api/dev/lock', { method: 'POST' });
}

export async function fetchDeveloper(): Promise<{ unlocked: boolean }> {
  try {
    const response = await fetch('/api/dev/status');
    if (!response.ok) return { unlocked: false };
    return (await response.json()) as { unlocked: boolean };
  } catch {
    return { unlocked: false };
  }
}

export async function saveOverrides(overrides: Record<string, unknown>): Promise<PlanStatus> {
  const response = await fetch('/api/dev/overrides', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(overrides),
  });
  const body = (await response.json()) as Partial<PlanStatus> & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Override failed.');
  return asPlan(body);
}

export function applyPlanClass(plan: PlanStatus): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.plan = plan.id;
  const allowed = plan.developer || plan.styleIds.includes(plan.styleId);
  document.documentElement.dataset.style = allowed ? plan.styleId : 'classic';
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MOBILE_PLAN_EVENT, { detail: plan }));
}

export function visibleMockApps(allowMocks: boolean, _id: string, isMock: boolean): boolean {
  if (!isMock) return true;
  return allowMocks;
}

export function mockAppLocked(allowMocks: boolean, isMock: boolean): boolean {
  return isMock && !allowMocks;
}

export function styleUnlocked(plan: PlanStatus, styleId: StyleId): boolean {
  return plan.developer || plan.styleIds.includes(styleId);
}

export function styleMinPlanLabel(minPlan: PlanId): string {
  if (minPlan === 'max') return 'TVM MAX';
  if (minPlan === 'ultra') return 'TVM Ultra';
  return 'TVM Premium';
}

export function themeUnlocked(plan: PlanStatus, themeId: string): boolean {
  const theme = THEMES.find((item) => item.id === themeId);
  if (!theme) return false;
  if (!theme.premium) return true;
  return plan.developer || plan.bundle || (plan as unknown as Record<string, unknown>)[themeId] === true;
}

export function displayMaxLabel(maxHeight: 720 | 1080 | 2160): string {
  if (maxHeight >= 2160) return '4K (2160p)';
  if (maxHeight >= 1080) return 'Full HD (1080p)';
  return 'HD (720p)';
}

export type ThemePack = 'synthwave' | 'anime' | 'theme-bundle';
export function checkoutPack(value: unknown): ThemePack | undefined {
  return value === 'synthwave' || value === 'anime' || value === 'theme-bundle' ? value : undefined;
}
export function packName(pack: ThemePack): string { return pack === 'theme-bundle' ? 'All paid themes' : pack === 'anime' ? 'Anime' : 'Retro'; }

/** Whether a card can be taken, and the publishable key needed to take one. */
export async function fetchStripeStatus(signal?: AbortSignal): Promise<StripeStatus> {
  return requestJson<StripeStatus>('/api/billing/stripe', {}, 5_000, signal);
}

/**
 * Opens a payment. The amount comes back from the server, priced from the
 * catalogue — the browser cannot name its own total.
 */
export async function startPaymentIntent(input: CheckoutRequest): Promise<PaymentIntentStart> {
  return requestJson<PaymentIntentStart>('/api/billing/intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }, 20_000);
}

/**
 * Asks the server to re-read the payment from Stripe and settle it. The
 * browser's own word that the card went through is never enough.
 */
export async function confirmPaymentIntent(paymentIntentId: string): Promise<PaymentOrderView> {
  return requestJson<PaymentOrderView>('/api/billing/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paymentIntentId }),
  }, 20_000);
}

/** Where a monthly plan stands with the card behind it. */
export interface SubscriptionView {
  state: 'none' | 'incomplete' | 'active' | 'past_due' | 'canceled';
  planId: string | null;
  liveTv: boolean;
  amountPence: number;
  currency: 'GBP';
  /** ISO date of the next charge, or null when nothing is due. */
  nextChargeAt: string | null;
  cancelAtPeriodEnd: boolean;
  renewals: number;
  lastError: string | null;
}

export interface SubscriptionStart {
  subscriptionId: string;
  clientSecret: string;
  amountPence: number;
  planId: string;
  liveTv: boolean;
  description: string;
}

export async function fetchSubscription(signal?: AbortSignal): Promise<SubscriptionView | null> {
  try {
    return await requestJson<SubscriptionView>('/api/billing/subscription', {}, 8_000, signal);
  } catch {
    return null;
  }
}

/**
 * Opens a monthly subscription. Grants nothing on its own: the plan starts
 * when the first payment clears, not when this returns.
 */
export async function startSubscription(input: CheckoutRequest): Promise<SubscriptionStart> {
  return requestJson<SubscriptionStart>('/api/billing/subscription', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }, 20_000);
}

/** Asks the server to re-read Stripe and settle. The browser's word is not enough. */
export async function confirmSubscription(): Promise<SubscriptionView> {
  return requestJson<SubscriptionView>('/api/billing/subscription/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }, 20_000);
}

/** Stops future charges. Keeps the month already paid for unless `immediately`. */
export async function cancelSubscription(immediately = false): Promise<SubscriptionView> {
  return requestJson<SubscriptionView>('/api/billing/subscription', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ immediately }),
  }, 20_000);
}

/** "3 October" reads better on a payment screen than an ISO timestamp. */
export function formatChargeDate(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
