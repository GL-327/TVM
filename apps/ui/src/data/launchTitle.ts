import type { Title } from './catalog';
import type { Navigate } from '../nav/ViewStackContext';
import { currentProfileId, fetchRdStatus, peekHome, type RdStatus } from './media';
import { detailsParams } from './openDetails';
import { applyPlanClass, fetchPlan, type PlanStatus } from './plan';
import { fetchProfiles, type ProfileRegistry } from './profiles';

export interface LaunchChecks {
  /** Someone is signed in, so the "Who's watching?" gate can be skipped. */
  profileActive: boolean;
  plan: PlanStatus | null;
  rd: RdStatus | null;
}

const EMPTY_CHECKS: LaunchChecks = { profileActive: true, plan: null, rd: null };

/** Runs TVM Stream's front-door checks in parallel; none of them throws. */
export async function runLaunchChecks(): Promise<LaunchChecks> {
  const [registry, plan, rd] = await Promise.all([
    fetchProfiles().catch((): ProfileRegistry | null => null),
    fetchPlan().catch((): PlanStatus | null => null),
    fetchRdStatus().catch((): RdStatus | null => null),
  ]);
  if (plan !== null) applyPlanClass(plan);
  return { profileActive: registry !== null && registry.activeId !== '', plan, rd };
}

export const RD_NOTICE = {
  title: 'Real-Debrid is not connected',
  body: 'This title opens, but playback needs a Real-Debrid account. Connect one now or later from Account.',
  action: 'realdebrid',
} as const;

/**
 * Home → title. Instead of dropping the viewer at TVM Stream's front door,
 * run its checks (profile, plan, Real-Debrid) and land on the title itself.
 * Home stays underneath so Back returns to Home.
 *
 * Movies and series both open details — never the player. Playback needs a
 * resolved stream; a series still needs a season pick first.
 */
export async function launchTitle(navigate: Navigate, title: Title): Promise<void> {
  const params = detailsParams(title);
  // Home already checked this viewer. In particular, don't wait for another
  // Real-Debrid status call before opening a title that is already on screen.
  if (currentProfileId() !== '' && peekHome()?.rd.configured === true) {
    navigate.home();
    navigate.push('details', { params });
    return;
  }
  let checks: LaunchChecks;
  try {
    checks = await runLaunchChecks();
  } catch {
    checks = EMPTY_CHECKS;
  }
  navigate.home();
  if (!checks.profileActive) {
    navigate.push('profiles', { params: { next: 'details', nextParams: params } });
    return;
  }
  navigate.push('details', { params });
  if (checks.rd !== null && !checks.rd.configured) {
    navigate.pushModal('notice', { params: { ...RD_NOTICE } });
  }
}
