export type PlanId = 'basic' | 'premium' | 'tvm-max';

export interface PlanStatus {
  id: PlanId;
  name: string;
  mocks: boolean;
  stream: 'basic' | 'premium' | 'luxury';
}

const FALLBACK: PlanStatus = { id: 'premium', name: 'Premium', mocks: true, stream: 'premium' };

export async function fetchPlan(): Promise<PlanStatus> {
  try {
    const response = await fetch('/api/plan');
    if (!response.ok) return FALLBACK;
    const body = (await response.json()) as PlanStatus;
    if (body.id !== 'basic' && body.id !== 'premium' && body.id !== 'tvm-max') return FALLBACK;
    return body;
  } catch {
    return FALLBACK;
  }
}

export async function savePlan(id: PlanId): Promise<PlanStatus> {
  const response = await fetch('/api/plan', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error('Plan was not saved.');
  return (await response.json()) as PlanStatus;
}

export function applyPlanClass(plan: PlanStatus): void {
  document.documentElement.dataset.plan = plan.id;
}
