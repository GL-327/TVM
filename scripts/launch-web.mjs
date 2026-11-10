// Starts the shared Core and responsive browser client without Electron.
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

export async function launchWeb({ open = true } = {}) {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = [here, dirname(here)].find(folder => existsSync(join(folder, 'core/index.js')) || existsSync(join(folder, 'apps/core/src/index.ts')));
  if (!root) throw new Error('Extract the whole TVM web package before starting it.');
  const packaged = existsSync(join(root, 'core/index.js'));
  const entry = join(root, packaged ? 'core/index.js' : 'apps/core/src/index.ts');
  const ui = process.env.TVM_UI_DIST || join(root, packaged ? 'ui' : 'apps/ui/dist');
  if (!existsSync(join(ui, 'index.html'))) throw new Error('The built interface is missing. From source, run pnpm install and pnpm build first.');
  const port = process.env.TVM_CORE_PORT || '7345';
  if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) throw new Error('TVM_CORE_PORT must be between 1 and 65535.');
  const url = `http://127.0.0.1:${port}/`;
  const healthy = async () => {
    try {
      const response = await fetch(`${url}api/health`, { signal: AbortSignal.timeout(750) });
      const body = await response.json();
      return response.ok && body.status === 'ok' && typeof body.version === 'string' && typeof body.uptimeSeconds === 'number';
    } catch { return false; }
  };
  let child;
  if (!await healthy()) {
    const paths = await import(pathToFileURL(join(dirname(entry), packaged ? 'update/paths.js' : 'update/paths.ts')).href);
    const dataDir = paths.resolveDataDir();
    const logs = join(dataDir, 'logs');
    mkdirSync(logs, { recursive: true });
    const output = openSync(join(logs, 'web-core.log'), 'a');
    let startError;
    try {
      child = spawn(process.execPath, [entry], {
        cwd: root, detached: true, windowsHide: true, stdio: ['ignore', output, output],
        env: { ...process.env, TVM_CORE_BIND: process.env.TVM_CORE_BIND || '127.0.0.1', TVM_CORE_PORT: port,
          TVM_UI_DIST: ui, TVM_DATA_DIR: dataDir, TVM_ENV: packaged ? 'production' : 'development' },
      });
      child.once('error', error => { startError = error; });
    } finally { closeSync(output); }
    const deadline = Date.now() + 40_000;
    while (!await healthy()) {
      if (startError || child.exitCode !== null || Date.now() > deadline) {
        child.kill();
        throw new Error(`TVM Core could not start. Check ${join(logs, 'web-core.log')}.`);
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    child.unref();
  }
  if (open) {
    const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const browser = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    browser.once('error', () => { console.log(`Open ${url} in your browser.`); });
    browser.unref();
  }
  console.log(`TVM is ready at ${url}`);
  return { url, started: child !== undefined, pid: child?.pid };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  launchWeb({ open: !process.argv.includes('--no-open') }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
