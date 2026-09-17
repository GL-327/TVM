import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_HOST, resolveBindHost, resolvePort } from './config.ts';
import { startCoreServer } from './server.ts';
import { notifySystemdReady } from './notify.ts';
import { CHECK_INTERVAL_MS, resolveDataDir } from './update/paths.ts';
import { appliedLaunch } from './update/launch.ts';
import { createUpdateService, startUpdatePolling } from './update/service.ts';
import { onRestartRequested, relaunchDetached, supervised } from './update/restart.ts';
import { readPrefs } from './prefs.ts';

const dataDir = resolveDataDir();
const hop = appliedLaunch(dataDir, import.meta.url, process.env);
if (hop !== null) {
  const hopped = spawnSync(process.execPath, [hop.coreEntry], {
    stdio: 'inherit',
    env: hop.env,
    windowsHide: true,
  });
  process.exit(hopped.status ?? 1);
}

/**
 * In a packaged appliance the UI bundle sits next to core. An applied GitHub
 * release uses `../ui`. During development the Vite server owns the UI, so
 * finding nothing here is expected.
 */
function findUiDist(): string | undefined {
  const fromEnv = process.env['TVM_UI_DIST'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') return resolve(fromEnv);

  const here = dirname(fileURLToPath(import.meta.url));
  const monorepo = resolve(here, '../../ui/dist');
  if (existsSync(monorepo)) return monorepo;
  const applied = resolve(here, '../ui');
  if (existsSync(join(applied, 'index.html'))) return applied;
  return undefined;
}

function findRokuPreview(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, '../../roku/preview');
  return existsSync(join(candidate, 'index.html')) ? candidate : undefined;
}

const uiDist = findUiDist();
const rokuPreview = findRokuPreview();
const update = createUpdateService({ dataDir });
const bindHost = resolveBindHost();
const core = await startCoreServer(resolvePort(), { uiDist, rokuPreview, update, dataDir });
notifySystemdReady();
const stopPolling = startUpdatePolling(update, CHECK_INTERVAL_MS, {
  autoApply: () => readPrefs(dataDir).autoUpdate,
});

console.log(`tvm-core listening on http://${bindHost}:${core.port}`);

// After an applied update: free the port, then let systemd restart Core, or
// start the replacement ourselves when nothing else will.
onRestartRequested(async () => {
  stopPolling();
  await Promise.race([core.close(), new Promise((done) => setTimeout(done, 3000))]);
  if (!supervised()) relaunchDetached();
});
if (bindHost !== CORE_HOST) {
  const token = process.env['TVM_LAN_TOKEN'] ?? '';
  if (token.length < 32) {
    console.log('tvm-core: TVM_LAN_TOKEN is missing or shorter than 32 characters. LAN clients will receive lan_authentication_required.');
  }
  console.log('tvm-core: LAN requests require Authorization: Bearer <TVM_LAN_TOKEN>, or a tvm_lan_session cookie from POST /api/lan/session. Admin, billing and privacy controls remain local.');
}
console.log(uiDist === undefined ? 'tvm-core: API only (UI served by dev server)' : `tvm-core: serving UI from ${uiDist}`);
if (process.env['TVM_ENV'] === 'development' && rokuPreview !== undefined) {
  console.log(`tvm-core: TV preview (desktop UI) at http://127.0.0.1:5173/?tv=1`);
  console.log(`tvm-core: loader at http://127.0.0.1:${core.port}/roku-preview/`);
}

let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;

    stopPolling();
    void core.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error('tvm-core failed to shut down cleanly', error);
        process.exit(1);
      },
    );
  });
}
