import { rememberPendingChangelog, type ChangelogEntry } from './changelog';

type UpdateKind =
  | 'idle'
  | 'no_release'
  | 'up_to_date'
  | 'available'
  | 'auth_required'
  | 'rate_limited'
  | 'app_update_required'
  | 'failed';

export interface CoreUpdateStatus {
  current: string;
  currentCommit?: string | null;
  bootId?: string;
  appBuild?: string | null;
  install?: 'checkout' | 'package';
  channel?: string;
  lastCheck?: string | null;
  available?: { version: string; commit?: string; notes: string; changelog?: ChangelogEntry[] } | null;
  configured?: boolean;
  applyAllowed?: boolean;
  applyReason?: string | null;
  kind?: UpdateKind;
  notice?: string | null;
}

export interface ManualUpdateOutcome {
  changed: boolean;
  restarted: boolean;
  reload: boolean;
  message: string;
  status?: CoreUpdateStatus;
}

export async function fetchCoreUpdateStatus(signal?: AbortSignal): Promise<CoreUpdateStatus | null> {
  try {
    const response = await fetch('/api/update/status', { cache: 'no-store', signal });
    if (!response.ok) return null;
    return (await response.json()) as CoreUpdateStatus;
  } catch {
    return null;
  }
}

export function formatEngineLabel(status: CoreUpdateStatus | null): string {
  if (status === null || typeof status.current !== 'string' || status.current.trim() === '') {
    return 'Engine version unavailable';
  }
  const commit = typeof status.currentCommit === 'string' ? status.currentCommit.trim().slice(0, 7) : '';
  return commit === '' ? `Engine v${status.current}` : `Engine v${status.current} · build ${commit}`;
}

export function describeUpdateCheck(status: CoreUpdateStatus): string {
  if (status.notice) return status.notice;
  if (status.kind === 'up_to_date') return 'You are on the latest published build.';
  if (status.available) return `Build ${status.available.version} is available.`;
  if (status.kind === 'no_release') return 'No update has been published yet.';
  if (status.kind === 'app_update_required') return 'Install a newer version of the app to update.';
  return 'The update check did not finish. Try again.';
}

async function waitForCoreRestart(
  previous: CoreUpdateStatus,
  appliedCommit: string,
  maxAttempts = 80,
  delayMs = 300,
): Promise<CoreUpdateStatus | null> {
  const deadline = Date.now() + maxAttempts * delayMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const next = await fetchCoreUpdateStatus(AbortSignal.timeout(Math.min(remaining, 1500)));
    if (next === null) continue;
    const commit = typeof next.currentCommit === 'string' ? next.currentCommit.trim() : '';
    const versionChanged = Boolean(next.current && previous.current && next.current !== previous.current);
    // A connection failure can occur while the same legacy Core is still running.
    const restarted = next.bootId
      ? next.bootId !== previous.bootId
      : !previous.bootId && versionChanged;
    const expectedBuild = appliedCommit !== '' ? commit === appliedCommit : Boolean(next.bootId) || versionChanged;
    if (restarted && expectedBuild) return next;
  }
  return null;
}

/**
 * Emergency manual update: runs POST /api/update/check, then POST /api/update/apply,
 * and waits for Core to restart when restart is automatic/self.
 */
export async function runManualCoreUpdate(
  onProgress?: (message: string) => void,
): Promise<ManualUpdateOutcome> {
  onProgress?.('Checking Core for updates…');

  const checkResp = await fetch('/api/update/check', { method: 'POST' });
  const checkBody = (await checkResp.json()) as CoreUpdateStatus & { error?: string };
  if (!checkResp.ok) {
    return {
      changed: false,
      restarted: false,
      reload: false,
      message: checkBody.error ?? 'Core update check failed.',
    };
  }

  const available = checkBody.available ?? null;
  if (available === null || checkBody.kind === 'up_to_date' || checkBody.applyAllowed === false) {
    return {
      changed: false,
      restarted: false,
      reload: false,
      message: available !== null && checkBody.applyAllowed === false
        ? checkBody.applyReason ?? 'Core update could not be applied.'
        : describeUpdateCheck(checkBody),
      status: checkBody,
    };
  }

  onProgress?.('Applying Core update…');
  const applyResp = await fetch('/api/update/apply', { method: 'POST' });
  const applyBody = (await applyResp.json()) as {
    version?: string;
    commit?: string;
    changed?: boolean;
    restart?: 'automatic' | 'self' | 'manual' | 'reload';
    error?: string;
    reason?: string;
  };
  if (!applyResp.ok) {
    return {
      changed: false,
      restarted: false,
      reload: false,
      message: applyBody.reason ?? applyBody.error ?? 'Core update could not be applied.',
      status: checkBody,
    };
  }

  if (applyBody.changed !== true) {
    const latest = await fetchCoreUpdateStatus();
    return {
      changed: false,
      restarted: false,
      reload: false,
      message: latest ? describeUpdateCheck(latest) : 'No new update was applied.',
      status: latest ?? checkBody,
    };
  }

  rememberPendingChangelog({
    version: applyBody.version ?? available?.version ?? 'github',
    from: checkBody.currentCommit?.slice(0, 7) ?? null,
    entries: available?.changelog,
    notes: available?.notes,
  });

  if (applyBody.restart === 'manual') {
    return {
      changed: true,
      restarted: false,
      reload: false,
      message: 'Updated. Restart TVM to finish.',
      status: (await fetchCoreUpdateStatus()) ?? checkBody,
    };
  }

  if (applyBody.restart === 'self' || applyBody.restart === 'automatic') {
    onProgress?.('Core updated. Waiting for Core to restart…');
    const restarted = await waitForCoreRestart(checkBody, applyBody.commit ?? available.commit ?? '');
    if (restarted !== null) {
      return {
        changed: true,
        restarted: true,
        reload: true,
        message: 'Core updated and restarted. Reloading…',
        status: restarted,
      };
    }
    return {
      changed: true,
      restarted: false,
      reload: false,
      message: 'Update applied. Core has not restarted yet. Reopen TVM when it is ready.',
    };
  }

  return {
    changed: true,
    restarted: false,
    reload: true,
    message: 'Applied. Reloading…',
  };
}
