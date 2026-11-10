import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Non-secret marker used only to avoid connecting the native app to another data directory. */
export function desktopRuntime(dataDir: string): { protocol: 1; instanceId: string } {
  let instanceId = '';
  try { instanceId = readFileSync(join(dataDir, 'native-runtime-id'), 'utf8'); } catch { /* First native launch creates it. */ }
  return { protocol: 1, instanceId: /^[A-Za-z0-9+/=]{32}$/.test(instanceId) ? instanceId : '' };
}
