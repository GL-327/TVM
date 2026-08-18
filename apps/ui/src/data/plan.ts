export type PlanId = 'free' | 'basic' | 'premium' | 'ultra' | 'max';
export type StyleId =
  | 'classic'
  | 'cinema'
  | 'midnight'
  | 'light'
  | 'ocean'
  | 'ice'
  | 'ember'
  | 'forest'
  | 'slate'
  | 'contrast'
  | 'rose'
  | 'violet'
  | 'sand'
  | 'copper'
  | 'gold'
  | 'aurora'
  | 'eagles'
  | 'crimson'
  | 'royal'
  | 'sunset'
  | 'neon'
  | 'graphite';
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
  { id: 'light', name: 'Light', minPlan: 'premium' },
  { id: 'ocean', name: 'Ocean', minPlan: 'premium' },
  { id: 'ice', name: 'Ice', minPlan: 'premium' },
  { id: 'ember', name: 'Ember', minPlan: 'ultra' },
  { id: 'forest', name: 'Forest', minPlan: 'ultra' },
  { id: 'slate', name: 'Slate', minPlan: 'ultra' },
  { id: 'contrast', name: 'High contrast', minPlan: 'ultra' },
  { id: 'rose', name: 'Rose', minPlan: 'ultra' },
  { id: 'violet', name: 'Violet', minPlan: 'ultra' },
  { id: 'sand', name: 'Sand', minPlan: 'ultra' },
  { id: 'copper', name: 'Copper', minPlan: 'ultra' },
  { id: 'gold', name: 'MAX Gold', minPlan: 'max' },
  { id: 'aurora', name: 'Aurora', minPlan: 'max' },
  { id: 'eagles', name: 'Eagles', minPlan: 'max' },
  { id: 'crimson', name: 'Crimson', minPlan: 'max' },
  { id: 'royal', name: 'Royal', minPlan: 'max' },
  { id: 'sunset', name: 'Sunset', minPlan: 'max' },
  { id: 'neon', name: 'Neon', minPlan: 'max' },
  { id: 'graphite', name: 'Graphite', minPlan: 'max' },
];

export interface PlanDefinition {
  id: PlanId;
  name: string;
  price: string;
  pricePence: number;
  mocks: boolean;
  liveTv: boolean;
  extras: string[];
}

export interface PlanStatus {
  id: PlanId;
  name: string;
  price: string;
  pricePence: number;
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

export async function fetchPlan(): Promise<PlanStatus> {
  try {
    const response = await fetch('/api/plan');
    if (!response.ok) return FALLBACK_PLAN;
    return asPlan((await response.json()) as Partial<PlanStatus>);
  } catch {
    return FALLBACK_PLAN;
  }
}

export async function checkoutPlan(input: {
  planId: PlanId;
  name?: string;
  number?: string;
  expiry?: string;
  cvc?: string;
}): Promise<PlanStatus> {
  const response = await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as Partial<PlanStatus> & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Checkout failed.');
  return asPlan(body);
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
