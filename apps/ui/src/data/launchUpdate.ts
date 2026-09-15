import { readAutoUpdate } from './prefs';
import { rememberPendingChangelog } from './changelog';

interface LaunchUpdateStatus {
  available?: {
    version?: string;
    notes?: string;
    changelog?: unknown;
  } | null;
  applyAllowed?: boolean;
  changelog?: { pending?: boolean; version?: string; entries?: unknown } | null;
}

/**
 * When the UI is ready, pull GitHub if automatic updates are on. iOS also
 * applies a UI bundle natively before the first paint; this covers desktop
 * and a second chance if that native pass could not reach GitHub.
 */
export async function applyGithubUpdateOnLaunch(): Promise<boolean> {
  if (!readAutoUpdate()) return false;
  try {
    const check = await fetch('/api/update/check', { method: 'POST' });
    if (!check.ok) return false;
    const body = (await check.json()) as LaunchUpdateStatus;
    if (body.available == null || body.applyAllowed !== true) return false;
    const apply = await fetch('/api/update/apply', { method: 'POST' });
    if (!apply.ok) return false;
    rememberPendingChangelog({
      version: body.available.version ?? 'github',
      entries: body.available.changelog,
      notes: body.available.notes,
    });
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}
