/**
 * Core is a local service, not a network service.
 *
 * The default bind is loopback: Stremio's bundled server listens on 0.0.0.0 and
 * is reachable by anything on the LAN, but TVM holds provider credentials, so
 * it stays on 127.0.0.1 unless a developer opts in.
 *
 * TVM_CORE_BIND=0.0.0.0 (or a specific IPv4 address) is for Roku development
 * on the same LAN. It has no API authentication. Do not use it as the
 * appliance default.
 *
 * `TVM_ENV=development` also binds 0.0.0.0 when TVM_CORE_BIND is unset, so
 * `pnpm dev` / windowed TVM can serve a Roku without a separate env var.
 * Production and unset TVM_ENV stay on loopback. Pin loopback in development
 * with TVM_CORE_BIND=127.0.0.1.
 */
export const CORE_HOST = '127.0.0.1' as const;

export const DEFAULT_CORE_PORT = 7345;

export const CORE_VERSION = '0.1.0';

const IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/;

export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['TVM_CORE_PORT'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_CORE_PORT;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`TVM_CORE_PORT must be a port number between 0 and 65535, received: ${raw}`);
  }
  return parsed;
}

export function resolveBindHost(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env['TVM_CORE_BIND'];
  if (raw !== undefined && raw.trim() !== '') {
    const host = raw.trim();
    if (host === CORE_HOST || host === '0.0.0.0' || IPV4.test(host)) return host;
    throw new Error(
      `TVM_CORE_BIND must be 127.0.0.1, 0.0.0.0, or an IPv4 address, received: ${raw}`,
    );
  }

  if (env['TVM_ENV'] === 'development') return '0.0.0.0';
  return CORE_HOST;
}
