import type { PlanStatus } from './plan';

export function isMobileClient(userAgent = navigator.userAgent): boolean {
  return /TVM-iOS|TVM-Android|iPhone|iPad|iPod|Android/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
}

/** Basic is the first Full HD plan. DEV may select a paid test plan but does not unlock Free playback. */
export function mobilePlanAllowed(plan: Pick<PlanStatus, 'id' | 'maxHeight'>): boolean {
  return ['basic', 'premium', 'ultra', 'max'].includes(plan.id) && plan.maxHeight >= 1080;
}

export const MOBILE_PLAN_EVENT = 'tvm:plan-changed';
