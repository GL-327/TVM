const DEV_UI_ORIGIN = 'http://127.0.0.1:5173';

function corePort(): string {
  const raw = process.env['TVM_CORE_PORT'];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : '7345';
}

/**
 * In development the Vite server owns the UI and proxies /api to core. In the
 * appliance core serves both, so the UI is always same-origin with its API.
 */
export function uiOrigin(): string {
  const override = process.env['TVM_UI_URL'];
  if (override !== undefined && override.trim() !== '') return override.trim();

  return process.env['TVM_ENV'] === 'production'
    ? `http://127.0.0.1:${corePort()}`
    : DEV_UI_ORIGIN;
}

export const LOAD_RETRY_DELAY_MS = 600;
export const LOAD_RETRY_LIMIT = 50;
