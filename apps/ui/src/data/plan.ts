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
  synthwaveAddonPence: number;
  mocks: boolean;
  liveTv: boolean;
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
  synthwaveAddonPence: 499,
  mocks: false,
  liveTv: false,
  ads: true,
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
  mode: 'sandbox';
  event: 'checkout' | 'cancellation';
  currency: 'GBP';
  monthlyPence: number;
  oneTimePence: number;
  chargedPence: 0;
  liveTv: boolean;
  synthwavePurchased: boolean;
  at: string;
}

export interface BillingStatus {
  mode: 'sandbox';
  livePaymentsEnabled: false;
  currency: 'GBP';
  subscription: 'free' | 'test-active';
  monthlyPence: number;
  nextChargeAt: null;
  synthwaveOwned: boolean;
  receipts: BillingReceipt[];
}

export interface CheckoutRequest {
  planId: PlanId;
  consent: boolean;
  requestId: string;
  liveTv?: boolean;
  synthwave?: boolean;
  simulate?: 'success' | 'decline' | 'cancel';
  packOnly?: boolean;
  quotedMonthlyPence?: number;
  quotedOneTimePence?: number;
}

export function formatBillingMoney(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export function checkoutQuote(plan: PlanStatus, selectedId: PlanId, liveTv: boolean, synthwave: boolean, packOnly = false): {
  monthlyPence: number; oneTimePence: number; referenceTotalPence: number;
} {
  const entry = plan.catalog.find((item) => item.id === (packOnly ? plan.id : selectedId));
  if (entry === undefined || entry.basePricePence === undefined) throw new Error('Plan information is unavailable.');
  const includeLive = packOnly ? plan.liveTv : liveTv;
  const monthlyPence = entry.basePricePence + (includeLive ? entry.liveTvAddonPence ?? 0 : 0);
  const oneTimePence = synthwave && !plan.synthwaveOwned ? plan.synthwaveAddonPence : 0;
  return { monthlyPence, oneTimePence, referenceTotalPence: (packOnly ? 0 : monthlyPence) + oneTimePence };
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
  if (body.mode !== 'sandbox' || body.livePaymentsEnabled !== false || !Array.isArray(body.receipts)) {
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
  if (!response.ok) throw new Error(body.error ?? 'Colourcast was not updated.');
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
  if (themeId !== 'synthwave') return true;
  return plan.developer || plan.synthwave;
}

export function displayMaxLabel(maxHeight: 720 | 1080 | 2160): string {
  if (maxHeight >= 2160) return '4K (2160p)';
  if (maxHeight >= 1080) return 'Full HD (1080p)';
  return 'HD (720p)';
}
