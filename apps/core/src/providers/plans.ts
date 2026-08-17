import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { planPath } from '../update/paths.ts';

export const PLAN_IDS = ['basic', 'premium', 'tvm-max'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanStatus {
  id: PlanId;
  name: string;
  mocks: boolean;
  stream: 'basic' | 'premium' | 'luxury';
}

const NAMES: Record<PlanId, string> = {
  basic: 'Basic',
  premium: 'Premium',
  'tvm-max': 'TVM MAX',
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

export function planStatus(id: PlanId): PlanStatus {
  return {
    id,
    name: NAMES[id],
    mocks: id !== 'basic',
    stream: id === 'basic' ? 'basic' : id === 'tvm-max' ? 'luxury' : 'premium',
  };
}

export function createPlanService(options: { dataDir: string }) {
  const read = (): PlanId => {
    try {
      const raw = JSON.parse(readFileSync(planPath(options.dataDir), 'utf8')) as { id?: unknown };
      if (isPlanId(raw.id)) return raw.id;
    } catch {
      // Default premium so mock services are reachable while this is a prototype.
    }
    return 'premium';
  };

  return {
    status(): PlanStatus {
      return planStatus(read());
    },
    set(id: PlanId): PlanStatus {
      mkdirSync(dirname(planPath(options.dataDir)), { recursive: true });
      writeFileSync(planPath(options.dataDir), JSON.stringify({ id }));
      return planStatus(id);
    },
  };
}

export type PlanService = ReturnType<typeof createPlanService>;
