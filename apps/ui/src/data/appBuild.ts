import { apiFetch } from './media';

/**
 * How old the app underneath this interface is.
 *
 * The phones replace their interface from GitHub on their own, but the routes
 * and the dev-code digest behind it only change when a new IPA or APK is
 * installed. So a current screen can sit on top of a months-old app, and the
 * only symptom is a request that fails for no visible reason.
 *
 *   desktop — interface and core come from one checkout, so there is nothing
 *             to say.
 *   known   — the app reported the commit it was built from.
 *   old     — a phone app from before builds were stamped. Not knowing is
 *             itself the answer: it predates anything that asks.
 */
export type AppBuild = { kind: 'desktop' } | { kind: 'known'; build: string } | { kind: 'old' };

/** Inside the iPhone or Android app, whose shell sets its own agent. */
function inPhoneApp(userAgent = navigator.userAgent): boolean {
  return /TVM-iOS|TVM-Android/.test(userAgent);
}

export async function fetchAppBuild(): Promise<AppBuild> {
  if (!inPhoneApp()) return { kind: 'desktop' };
  try {
    const response = await apiFetch('/api/update/status');
    if (!response.ok) return { kind: 'old' };
    const body = (await response.json()) as { appBuild?: unknown };
    const build = typeof body.appBuild === 'string' ? body.appBuild.trim() : '';
    if (build === '' || build === 'unknown') return { kind: 'old' };
    return { kind: 'known', build: build.slice(0, 7) };
  } catch {
    return { kind: 'old' };
  }
}
