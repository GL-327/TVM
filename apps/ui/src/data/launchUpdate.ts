import { readAutoUpdate } from './prefs';
import { rememberPendingChangelog } from './changelog';

interface LaunchUpdateStatus {
  available?: {
    version?: string;
    commit?: string;
    notes?: string;
    changelog?: unknown;
  } | null;
  applyAllowed?: boolean;
  currentCommit?: string | null;
}

interface ApplyResponse {
  version?: string;
  commit?: string | null;
  /** Absent from older cores, which only answered once they had changed something. */
  changed?: boolean;
  /** reload: a phone swapped its interface bundle, so only the page needs to reload. */
  restart?: 'automatic' | 'self' | 'manual' | 'reload';
}

/** One automatic apply per app session, whatever the core says afterwards. */
export const LAUNCH_APPLY_KEY = 'tvm.update.launchApplied';

function session(): Storage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Decides whether a launch-time apply may reload the page.
 *
 * This is the guard that was missing. The iPhone core compared its bundle
 * with the tip of GitHub main, but the bundle is only rebuilt for some
 * commits — so after every apply it still saw "available", applied the same
 * bundle again, and this function reloaded the page again: forever, a few
 * seconds apart, starting the moment someone got past the sign-in. Whatever a
 * core claims, the interface now reloads at most once per session, and not at
 * all when the apply reports that nothing changed.
 */
export function shouldReloadAfterApply(result: ApplyResponse, alreadyApplied: string | null): boolean {
  if (alreadyApplied !== null) return false;
  if (result.changed === false) return false;
  return result.restart !== 'manual';
}

/**
 * When the UI is ready, pull GitHub if automatic updates are on. The phones
 * stage a bundle natively in the background as well; this is the path that
 * applies one while the app is open, and the desktop's only path.
 */
export async function applyGithubUpdateOnLaunch(): Promise<boolean> {
  if (!readAutoUpdate()) return false;
  const store = session();
  const alreadyApplied = store?.getItem(LAUNCH_APPLY_KEY) ?? null;
  if (alreadyApplied !== null) return false;
  try {
    const check = await fetch('/api/update/check', { method: 'POST' });
    if (!check.ok) return false;
    const body = (await check.json()) as LaunchUpdateStatus;
    if (body.available == null || body.applyAllowed !== true) return false;
    const version = body.available.version ?? 'github';
    const apply = await fetch('/api/update/apply', { method: 'POST' });
    if (!apply.ok) return false;
    const result = (await apply.json().catch(() => ({}))) as ApplyResponse;
    if (!shouldReloadAfterApply(result, null)) return false;
    // After a successful apply only: a failed download must still be retried
    // in this session, but a core that always says "available" must not loop.
    try {
      store?.setItem(LAUNCH_APPLY_KEY, version);
    } catch {
      // Without session storage the changed flag above is the only guard.
    }
    rememberPendingChangelog({
      version: result.version ?? version,
      from: body.currentCommit?.slice(0, 7) ?? null,
      entries: body.available.changelog,
      notes: body.available.notes,
    });
    // A desktop Core restarts to take the new build; give it a moment.
    window.setTimeout(() => window.location.reload(), result.restart === 'self' || result.restart === 'automatic' ? 2500 : 0);
    return true;
  } catch {
    return false;
  }
}
