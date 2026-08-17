import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_HOST, resolveBindHost, resolvePort } from './config.ts';
import { startCoreServer } from './server.ts';
import { notifySystemdReady } from './notify.ts';
import { CHECK_INTERVAL_MS, resolveDataDir } from './update/paths.ts';
import { createUpdateService, startUpdatePolling } from './update/service.ts';

/**
 * In a packaged appliance the UI bundle sits next to core. During development
 * the Vite server owns the UI, so finding nothing here is expected.
 */
function findUiDist(): string | undefined {
  const fromEnv = process.env['TVM_UI_DIST'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') return resolve(fromEnv);

  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, '../../ui/dist');
  return existsSync(candidate) ? candidate : undefined;
}

function findRokuPreview(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, '../../roku/preview');
  return existsSync(join(candidate, 'index.html')) ? candidate : undefined;
}

const uiDist = findUiDist();
const rokuPreview = findRokuPreview();
const dataDir = resolveDataDir();
const update = createUpdateService({ dataDir });
const bindHost = resolveBindHost();
const core = await startCoreServer(resolvePort(), { uiDist, rokuPreview, update, dataDir });
notifySystemdReady();
const stopPolling = startUpdatePolling(update, CHECK_INTERVAL_MS);

console.log(`tvm-core listening on http://${bindHost}:${core.port}`);
if (bindHost !== CORE_HOST) {
  console.log('tvm-core: LAN bind is on; Core has no API auth. Use only while developing a Roku client.');
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
