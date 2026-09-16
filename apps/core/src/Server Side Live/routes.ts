import type { IncomingMessage, ServerResponse } from 'node:http';
import { isLoopback } from '../security.ts';
import { createServerSideLive, type ServerSideLive } from './index.ts';
import { GLOBAL_PROFILE_ID, type HeaderProfile } from './headers.ts';
import { isTokenShaped } from './tokens.ts';
import { checkEgress } from './egress.ts';

/**
 * The `/api/live/...` surface, and who is allowed to reach it.
 *
 * Auth is inherited rather than invented. Core's accessError() runs before any
 * of this and already decides the hard part: loopback needs no token, anything
 * else needs `Authorization: Bearer <TVM_LAN_TOKEN>` or an authenticated LAN
 * session. `/api/live` is not in the loopback-only list, so the proxy is a
 * content route and a Roku reaches it with the same header it already sends
 * for Core-hosted streams. Nothing here changes that contract.
 *
 * The two routes that *write* are the exception. Loading a playlist carries a
 * provider's credentials in its body, and rotating the signing secret cuts off
 * every client at once; both are configuration, not content, so both are
 * loopback-only — set up on the appliance or the desktop, consumed everywhere.
 */

let cached: { dataDir: string; service: ServerSideLive } | null = null;

/**
 * One service per data directory, built once.
 *
 * The token map lives in this object, so rebuilding it per request would
 * invalidate every URL a player is holding mid-stream.
 */
export function serverSideLiveFor(dataDir: string, env: NodeJS.ProcessEnv): ServerSideLive {
  if (cached !== null && cached.dataDir === dataDir) return cached.service;
  const service = createServerSideLive({ dataDir, env });
  cached = { dataDir, service };
  return service;
}

/** Test seam: forget the memoised service so a fresh data directory is honoured. */
export function resetServerSideLive(): void {
  cached = null;
}

function readProfile(raw: unknown): HeaderProfile | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const profile: HeaderProfile = { id: typeof source['id'] === 'string' && source['id'] !== '' ? source['id'] : GLOBAL_PROFILE_ID };
  for (const field of ['userAgent', 'referer', 'origin', 'cookie'] as const) {
    const value = source[field];
    if (typeof value === 'string' && value !== '') profile[field] = value;
  }
  const extra = source['extra'];
  if (typeof extra === 'object' && extra !== null) {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(extra as Record<string, unknown>)) {
      if (typeof value === 'string' && value !== '') out[name] = value;
    }
    if (Object.keys(out).length > 0) profile.extra = out;
  }
  return profile;
}

export interface LiveRouteContext {
  dataDir: string;
  env: NodeJS.ProcessEnv;
  /** Core's JSON responder, so error shapes match every other route. */
  sendJson: (response: ServerResponse, status: number, body: unknown) => void;
  readJson: (request: IncomingMessage) => Promise<unknown>;
  /** Core's live responder: Range handling, CORS and probe correction. */
  sendProxy: (response: ServerResponse, result: unknown, method: string) => Promise<void>;
  cors: Record<string, string>;
  /*
   * Turns a Core-relative path into the absolute URL this particular
   * client should use, from its own Host header. A Roku asking at
   * 192.168.1.10:7345 gets that address back, which is what makes its
   * existing coreOwnsUrl() check attach the bearer token to the video
   * node without any change on the Roku side.
   */
  publicUrl: (path: string) => string;
}

/**
 * Returns true when it has answered. Called before Core's own `/api/live`
 * handlers so the proxy paths win, and falls through for everything else so
 * the existing catalogue, picks and check routes are untouched.
 */
export async function handleServerSideLive(
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
  ctx: LiveRouteContext,
): Promise<boolean> {
  if (!path.startsWith('/api/live/')) return false;
  const service = serverSideLiveFor(ctx.dataDir, ctx.env);
  const method = request.method ?? 'GET';

  if (path.startsWith('/api/live/proxy/')) {
    if (method === 'OPTIONS') {
      response.writeHead(204, ctx.cors);
      response.end();
      return true;
    }
    if (method !== 'GET' && method !== 'HEAD') return false;
    const token = path.slice('/api/live/proxy/'.length);
    if (!isTokenShaped(token)) {
      ctx.sendJson(response, 404, { error: 'not_found' });
      return true;
    }
    const incoming: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') incoming[name] = value;
    }
    await ctx.sendProxy(response, await service.serve(token, incoming, method), method);
    return true;
  }

  if (path === '/api/live/sources' && method === 'GET') {
    // Opaque by construction: publicView has nowhere to put a provider URL.
    const channels = service.channels().map((channel) => ({ ...channel, play: ctx.publicUrl(channel.play) }));
    ctx.sendJson(response, 200, { channels, stats: service.stats() });
    return true;
  }

  if (path === '/api/live/sources' && method === 'PUT') {
    if (!isLoopback(request.socket.remoteAddress)) {
      ctx.sendJson(response, 403, { error: 'local_access_required' });
      return true;
    }
    const body = (await ctx.readJson(request)) as { url?: unknown; profile?: unknown };
    if (typeof body.url !== 'string' || body.url.trim() === '') {
      ctx.sendJson(response, 400, { error: 'playlist url required' });
      return true;
    }
    try {
      const loaded = await service.loadPlaylist(body.url.trim(), readProfile(body.profile));
      ctx.sendJson(response, 200, { ok: true, channels: loaded.count });
    } catch (error) {
      // Reason codes only: the upstream address must not come back out here.
      ctx.sendJson(response, 502, { error: error instanceof Error ? error.message : 'playlist_unreachable' });
    }
    return true;
  }

  /*
   * Loopback-only, because it answers with an IP address: that is a fact
   * about the operator network, not something a LAN client needs. It is also
   * the kill-switch test — with the tunnel down this must fail rather than
   * report the real address.
   */
  if (path === '/api/live/egress' && method === 'GET') {
    if (!isLoopback(request.socket.remoteAddress)) {
      ctx.sendJson(response, 403, { error: 'local_access_required' });
      return true;
    }
    const report = await checkEgress({ env: ctx.env });
    ctx.sendJson(response, report.ok ? 200 : 503, report);
    return true;
  }

  if (path === '/api/live/rotate' && method === 'POST') {
    if (!isLoopback(request.socket.remoteAddress)) {
      ctx.sendJson(response, 403, { error: 'local_access_required' });
      return true;
    }
    service.rotate();
    ctx.sendJson(response, 200, { ok: true, ...service.stats() });
    return true;
  }

  return false;
}
