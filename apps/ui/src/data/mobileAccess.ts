import type { PlanStatus } from './plan';

export function isMobileClient(userAgent = navigator.userAgent): boolean {
  return /TVM-iOS|TVM-Android|iPhone|iPad|iPod|Android/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
}

/**
 * Phone and tablet playback starts at Premium, and must reach 1080p.
 *
 * This list read `basic` while core/src/mobileAccess.ts, apps/ios TVMPlans and
 * apps/android TvmPlans all read `premium`, and the disagreement fell entirely
 * on the viewer: the interface let a Basic account into the catalogue, opened a
 * title, and then Core refused /api/playback. Stopping that is the only reason
 * this check exists on the client at all — it cannot grant anything the server
 * will not, so a looser copy of the rule is worse than no copy.
 *
 * The reasoning belongs to core and is written down there. DEV may select a
 * paid test plan; it does not unlock Free.
 */
export function mobilePlanAllowed(plan: Pick<PlanStatus, 'id' | 'maxHeight'>): boolean {
  return ['premium', 'ultra', 'max'].includes(plan.id) && plan.maxHeight >= 1080;
}

export const MOBILE_PLAN_EVENT = 'tvm:plan-changed';
