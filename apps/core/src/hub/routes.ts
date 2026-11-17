import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson } from '../http.ts';
import { accountSessionToken, type AccountsService } from '../providers/accounts.ts';
import { readActivity } from './activity.ts';
import { ack, expireCommands, getCommand, inbox, sendCommand } from './commands.ts';
import { findDevice, publicDevice, register, rename, resolveDevice, revoke, setRoom, type Viewer } from './devices.ts';
import { bad, HubError, notFound } from './errors.ts';
import { createPairing } from './pairing.ts';
import { heartbeat } from './presence.ts';
import { bucket, createHubStore, transactHub } from './store.ts';
import { bodyObject } from './validation.ts';
import { HEARTBEAT_SEC } from './vocab.ts';

export function createHubContext(options: { dataDir: string; accounts: AccountsService; env?: NodeJS.ProcessEnv; now?: () => number }) {
  const now = options.now ?? Date.now;
  const store = createHubStore(options.dataDir, now);
  return { store, now, accounts: options.accounts, env: options.env ?? {}, pairing: createPairing(store, options.accounts, now) };
}
export type HubContext = ReturnType<typeof createHubContext>;
function header(request: IncomingMessage, key: string): string | undefined {
  const value = request.headers[key];
  return typeof value === 'string' ? value : undefined;
}
function accountViewer(ctx: HubContext, session: string | undefined, request: IncomingMessage): Viewer {
  const account = ctx.accounts.resolve(session);
  if (account === null || account.suspended) throw new HubError(401, 'auth_required');
  return { accountId: account.id, name: account.displayName, role: account.role, profileId: header(request, 'x-tvm-profile') };
}
function integerQuery(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) bad();
  return Number(value);
}
export async function handleHubApi(request: IncomingMessage, response: ServerResponse, path: string, ctx: HubContext): Promise<boolean> {
  if (path !== '/api/hub' && !path.startsWith('/api/hub/')) return false;
  response.setHeader('cache-control', 'no-store');
  const respond = (status: number, value: Record<string, unknown>): void => sendJson(response, status, { ...value, serverTime: new Date(ctx.now()).toISOString() });
  try {
    const base = '/api/hub/v1';
    if (!path.startsWith(`${base}/`)) notFound();
    const route = path.slice(base.length);
    const method = request.method ?? 'GET';
    const query = new URL(request.url ?? '/', 'http://localhost').searchParams;
    const session = accountSessionToken(header(request, 'authorization'), header(request, 'x-tvm-account'), ctx.env['TVM_LAN_TOKEN']);
    const input = method === 'POST' ? bodyObject(await readJson(request)) : {};
    if (route.startsWith('/pair/')) {
      const pairing = ctx.pairing;
      if (route === '/pair/start' && method === 'POST') {
        const protocol = 'encrypted' in request.socket && request.socket.encrypted ? 'https' : 'http';
        respond(200, pairing.start(input, `${protocol}://${request.headers.host}`)); return true;
      }
      if (route === '/pair/token' && method === 'POST') {
        respond(200, pairing.token(input['deviceCode'])); return true;
      }
      const viewer = accountViewer(ctx, session, request);
      const ip = request.socket.remoteAddress ?? 'unknown';
      if (route === '/pair/lookup' && method === 'GET') {
        respond(200, pairing.lookup(query.get('userCode'), viewer, session!, ip)); return true;
      }
      if ((route === '/pair/approve' || route === '/pair/deny') && method === 'POST') {
        respond(200, pairing.decide(input['userCode'], route === '/pair/approve', viewer, session!, ip)); return true;
      }
      notFound();
    }
    const result = transactHub(ctx.store, document => {
      const at = ctx.now();
      const ackMatch = /^\/commands\/([^/]+)\/ack$/.exec(route);
      const needsDevice = route === '/presence' || route === '/session/signout' || route === '/inbox' || ackMatch !== null;
      const credential = header(request, 'x-tvm-device');
      const identity = credential !== undefined || needsDevice ? resolveDevice(document, credential, at) : null;
      const viewer: Viewer = needsDevice && session === undefined
        ? { accountId: identity!.accountId, name: 'Device', role: 'member', profileId: header(request, 'x-tvm-profile') }
        : accountViewer(ctx, session, request);
      if (identity !== null) {
        if (identity.accountId !== viewer.accountId) notFound();
        viewer.installationId = identity.installationId;
      }
      const existing = document.accounts[viewer.accountId];
      if (existing !== undefined) expireCommands(existing, at);
      if (route === '/installations/register' && method === 'POST') return register(bucket(document, viewer.accountId), input, viewer, at);
      if (route === '/overview' && method === 'GET') return {
        v: 1, rev: document.rev, heartbeatSec: HEARTBEAT_SEC,
        account: { id: viewer.accountId, name: viewer.name, role: viewer.role },
        currentInstallationId: viewer.installationId ?? null, visibleSpokes: 6,
        devices: Object.values(existing?.installations ?? {}).filter(d => query.get('includeRevoked') === '1' || d.revokedAt === null)
          .sort((a, z) => a.slot - z.slot).map(d => publicDevice(d, viewer, at)),
      };
      const devicesMatch = /^\/devices\/([^/]+)\/(rename|room|revoke)$/.exec(route);
      if (devicesMatch !== null && method === 'POST') {
        findDevice(existing, devicesMatch[1]!, devicesMatch[2] === 'revoke');
        const operation = devicesMatch[2];
        const device = operation === 'rename' ? rename(existing!, devicesMatch[1]!, input['name'], viewer, at)
          : operation === 'room' ? setRoom(existing!, devicesMatch[1]!, input['room'], viewer, at)
          : revoke(existing!, devicesMatch[1]!, viewer, at);
        return { device: publicDevice(device, viewer, at) };
      }
      if (route === '/presence' && method === 'POST') {
        const device = findDevice(existing, identity!.installationId);
        return { ...heartbeat(device, input, at), heartbeatSec: HEARTBEAT_SEC, rev: document.rev,
          pendingCommands: inbox(existing!, device.id, 0).length };
      }
      if (route === '/session/signout' && method === 'POST') {
        revoke(existing!, identity!.installationId, viewer, at, true); return { ok: true };
      }
      if (route === '/commands' && method === 'POST') {
        if (existing === undefined) notFound();
        return { command: sendCommand(existing, input, viewer, at) };
      }
      if (route === '/inbox' && method === 'GET') return {
        commands: inbox(existing!, identity!.installationId, integerQuery(query.get('after'), 0, Number.MAX_SAFE_INTEGER)),
      };
      if (ackMatch !== null && method === 'POST') return { command: ack(existing!, ackMatch[1]!, identity!.installationId, input, at) };
      const commandMatch = /^\/commands\/([^/]+)$/.exec(route);
      if (commandMatch !== null && method === 'GET') return { command: getCommand(existing, commandMatch[1]!) };
      if (route === '/activity' && method === 'GET') return { events: readActivity(existing, integerQuery(query.get('limit'), 50, 500)) };
      notFound();
    });
    // A transaction may have pruned/expired entries; report its committed revision.
    if ('rev' in result) result.rev = ctx.store.read().rev;
    respond(200, result);
  } catch (error) {
    if (error instanceof HubError) respond(error.status, { error: error.code, message: error.message });
    else if (error instanceof SyntaxError) respond(400, { error: 'invalid_json', message: 'Send a JSON object.' });
    else if (error instanceof Error && error.message === 'request body too large') respond(413, { error: 'body_too_large', message: 'The request body is too large.' });
    else respond(500, { error: 'internal_error', message: 'The Hub request failed.' });
  }
  return true;
}
