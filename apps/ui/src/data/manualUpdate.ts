import { currentAppVersion, rememberPendingChangelog, type ChangelogEntry } from './changelog';

export interface CoreUpdateStatus {
  current: string;
  currentCommit?: string | null;
  appBuild?: string | null;
  install?: 'checkout' | 'package';
  channel?: string;
  lastCheck?: string | null;
  available?: { version: string; commit?: string; notes: string; changelog?: ChangelogEntry[] } | null;
  configured?: boolean;
  applyAllowed?: boolean;
  applyReason?: string | null;
  kind?: string;
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
    const response = await fetch('/api/update/status', { signal });
    if (!response.ok) return null;
    return (await response.json()) as CoreUpdateStatus;
  } catch {
    return null;
  }
}

export function formatEngineLabel(status: CoreUpdateStatus | null): string {
  if (status === null || typeof status.current !== 'string' || status.current.trim() === '') {
    return `Engine v${currentAppVersion()}`;
  }
  const commit = typeof status.currentCommit === 'string' ? status.currentCommit.trim().slice(0, 7) : '';
  return commit === '' ? `Engine v${status.current}` : `Engine v${status.current} · build ${commit}`;
}

async function waitForCoreRestart(
  previousVersion: string,
  appliedCommit: string,
  maxAttempts = 80,
  delayMs = 300,
): Promise<CoreUpdateStatus | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const next = await fetchCoreUpdateStatus();
    if (next === null) continue;
    const commit = typeof next.currentCommit === 'string' ? next.currentCommit.trim() : '';
    if (appliedCommit !== '' ? commit === appliedCommit : next.current !== previousVersion) {
      return next;
    }
    // Even if commit stayed on dev watch or same build id, returning health after a restart succeeds.
    if (attempt > 2) return next;
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
  const before = await fetchCoreUpdateStatus();
  const previousVersion = before?.current ?? currentAppVersion();

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
  if (available === null && checkBody.kind === 'up_to_date') {
    return {
      changed: false,
      restarted: false,
      reload: false,
      message: checkBody.notice ?? 'Core is already up to date.',
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
      message: 'This copy is already on the latest build.',
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
    const restarted = await waitForCoreRestart(previousVersion, applyBody.commit ?? '');
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
      reload: true,
      message: 'Update applied. Reloading interface…',
    };
  }

  return {
    changed: true,
    restarted: false,
    reload: true,
    message: 'Applied. Reloading…',
  };
}
