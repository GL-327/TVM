import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
    // The suite is the remote. A click here would hide a broken D-pad.
    launchOptions: { args: ['--disable-extensions'] },
  },
  webServer: [
    {
      command: 'node src/index.ts',
      cwd: '../core',
      url: 'http://127.0.0.1:7345/api/health',
      reuseExistingServer: true,
      env: { ...process.env, TVM_ENV: 'development' },
    },
    {
      command: 'vite --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
    },
  ],
});
