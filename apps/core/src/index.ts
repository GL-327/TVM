import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_HOST, resolvePort } from './config.ts';
import { startCoreServer } from './server.ts';

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

const uiDist = findUiDist();
const core = await startCoreServer(resolvePort(), { uiDist });

console.log(`tvm-core listening on http://${CORE_HOST}:${core.port}`);
console.log(uiDist === undefined ? 'tvm-core: API only (UI served by dev server)' : `tvm-core: serving UI from ${uiDist}`);

let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;

    void core.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error('tvm-core failed to shut down cleanly', error);
        process.exit(1);
      },
    );
  });
}
