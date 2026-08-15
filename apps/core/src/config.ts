/**
 * Core is a local service, not a network service.
 *
 * The address is deliberately not configurable. Stremio's bundled server binds
 * 0.0.0.0:11470 and is reachable by anything on the LAN; TVM holds provider
 * credentials, so it stays on loopback.
 */
export const CORE_HOST = '127.0.0.1' as const;

export const DEFAULT_CORE_PORT = 7345;

export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['TVM_CORE_PORT'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_CORE_PORT;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`TVM_CORE_PORT must be a port number between 0 and 65535, received: ${raw}`);
  }
  return parsed;
}
