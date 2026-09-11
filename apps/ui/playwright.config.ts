import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const uiPort = '15173';
const corePort = '17345';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${uiPort}`,
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
    // The suite is the remote. A click here would hide a broken D-pad.
    launchOptions: { args: ['--disable-extensions'] },
  },
  webServer: [
    {
      command: 'node src/index.ts',
      cwd: '../core',
      url: `http://127.0.0.1:${corePort}/api/health`,
      reuseExistingServer: false,
      env: { ...process.env, TVM_ENV: 'development', TVM_CORE_PORT: corePort, TVM_CORE_BIND: '127.0.0.1', TVM_DATA_DIR: resolve('cache/e2e-core') },
    },
    {
      command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${uiPort}`,
      url: `http://127.0.0.1:${uiPort}`,
      reuseExistingServer: false,
      env: { ...process.env, TVM_CORE_PORT: corePort },
    },
  ],
});
