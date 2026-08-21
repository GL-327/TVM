import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CORE_HOST, CORE_VERSION, resolveBindHost, resolvePort } from './config.ts';
import { readJson, sendJson } from './http.ts';
import { fetchVastPreroll } from './providers/ads.ts';
import { isAllowedArtUrl, sendArtProxy } from './providers/artProxy.ts';
import { createAppsService, type AppsService } from './providers/apps.ts';
import { createDevUnlockService, type DevUnlockService } from './providers/devUnlock.ts';
import { createLiveService, type LiveProxyResult, type LiveService } from './providers/live.ts';
import { probeContentLength } from './providers/hlsProxy.ts';
import { createMediaService, type MediaService } from './providers/media.ts';
import {
  createPlanService,
  isPlanId,
  isStyleId,
  type DevOverrides,
  type PlanService,
} from './providers/plans.ts';
import { createRealDebrid } from './providers/realdebrid.ts';
import { createSessionService, type SessionService } from './providers/session.ts';
import { createStreamer, type StreamerService } from './providers/streamer.ts';
import { serveExactStatic, serveStatic } from './static.ts';
import { resolveDataDir } from './update/paths.ts';
import { createUpdateService, restartAfterApply, type UpdateService } from './update/service.ts';

export { CORE_VERSION };

const startedAt = Date.now();

/** Port from an HTTP Host header. Missing port is 80 (http). */
export function portOfHost(host: string): number {
  const trimmed = host.trim();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    const rest = end === -1 ? '' : trimmed.slice(end + 1);
    if (rest.startsWith(':')) {
      const port = Number(rest.slice(1));
      if (Number.isInteger(port) && port > 0) return port;
    }
    return 80;
  }
  const idx = trimmed.lastIndexOf(':');
  if (idx <= 0) return 80;
  const port = Number(trimmed.slice(idx + 1));
  return Number.isInteger(port) && port > 0 ? port : 80;
}

/**
 * HTML5 media must be fetched from Core, not from the Vite UI origin.
 * The desktop shell loads the UI on :5173 and proxies /api; mpegts.js live
 * MPEG-TS never ends, so a buffered UI proxy leaves MSE empty (black video).
 * Roku / appliance Host already is Core's listen port — keep that LAN origin.
 */
export function mediaPublicOrigin(hostHeader: string | undefined, listenPort: number): string {
  const core = `http://${CORE_HOST}:${listenPort}`;
  if (hostHeader === undefined || hostHeader.trim() === '') return core;
  const host = hostHeader.trim();
  if (portOfHost(host) === listenPort) return `http://${host}`;
  return core;
}

function withPublicUrl<T extends { kind: string; url?: string }>(
  request: IncomingMessage,
  result: T,
  listenPort: number,
): T {
  if (result.kind !== 'stream' || typeof result.url !== 'string' || !result.url.startsWith('/')) return result;
  return { ...result, url: `${mediaPublicOrigin(request.headers.host, listenPort)}${result.url}` };
}

const PROXY_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Range, Content-Type, Accept, Origin',
  'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  'access-control-max-age': '86400',
} as const;

function incomingHeader(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const part of value) {
      if (part !== '') return part;
    }
  }
  return '';
}

function proxyRequestHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  const range = incomingHeader(request.headers.range);
  if (range !== '') headers.range = range;
  const accept = incomingHeader(request.headers.accept);
  if (accept !== '') headers.accept = accept;
  const ua = incomingHeader(request.headers['user-agent']);
  if (ua !== '') headers['user-agent'] = ua;
  return headers;
}

async function sendLiveProxy(response: ServerResponse, result: LiveProxyResult, method = 'GET'): Promise<void> {
  if (result.kind === 'error') {
    sendJson(response, result.status ?? 502, { error: result.reason ?? 'unreachable' });
    return;
  }
  if (result.kind === 'playlist' && typeof result.body === 'string') {
    const payload = Buffer.from(result.body, 'utf8');
    response.writeHead(200, {
      'content-type': result.contentType ?? 'application/vnd.apple.mpegurl',
      'content-length': payload.length,
      'cache-control': 'no-store',
      ...PROXY_CORS,
    });
    if (method === 'HEAD') {
      response.end();
      return;
    }
    response.end(payload);
    return;
  }
  if (result.kind === 'media' && result.body !== undefined && typeof result.body !== 'string') {
    const headers: Record<string, string | number> = {
      'content-type': result.contentType ?? 'video/mp4',
      'cache-control': 'no-store',
      ...PROXY_CORS,
    };
    const ranges = result.acceptRanges;
    if (ranges != null && ranges !== '') headers['accept-ranges'] = ranges;
    const contentRange =
      result.contentRange != null && result.contentRange !== '' ? result.contentRange : null;
    const ranged = method !== 'HEAD' && result.status === 206 && contentRange !== null;
    let contentLength =
      result.contentLength != null && result.contentLength !== '' ? result.contentLength : null;
    if (method === 'HEAD') {
      contentLength = probeContentLength(contentLength, contentRange);
    } else if (result.status === 206 && contentRange === null) {
      contentLength = probeContentLength(contentLength, null);
    }
    if (contentLength != null && contentLength !== '') headers['content-length'] = contentLength;
    if (ranged && contentRange !== null) headers['content-range'] = contentRange;
    response.writeHead(ranged ? 206 : 200, headers);
    response.flushHeaders();
    try {
      response.socket?.setNoDelay(true);
    } catch {
      // Socket already closed.
    }
    if (method === 'HEAD' || response.writableEnded) {
      try {
        await result.body.cancel();
      } catch {
        // Headers-only.
      }
      if (!response.writableEnded) response.end();
      return;
    }
    try {
      await pipeline(Readable.fromWeb(result.body, { highWaterMark: 64 * 1024 }), response);
    } catch {
      try {
        await result.body.cancel();
      } catch {
        // Client left; dropping the upstream body is the right cleanup.
      }
    }
    return;
  }
  sendJson(response, 502, { error: 'unreachable' });
}

export interface HealthPayload {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
}

function streamFileType(name: string): string {
  if (name.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (name.endsWith('.m4s')) return 'video/iso.segment';
  if (name.endsWith('.mp4')) return 'video/mp4';
  if (name.endsWith('.ts')) return 'video/mp2t';
  return 'application/octet-stream';
}

async function sendStreamFile(response: ServerResponse, path: string, name: string): Promise<void> {
  const { createReadStream } = await import('node:fs');
  const { stat } = await import('node:fs/promises');
  let size = 0;
  try {
    size = (await stat(path)).size;
  } catch {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  response.writeHead(200, {
    'content-type': streamFileType(name),
    'content-length': size,
    'cache-control': 'no-store',
    ...PROXY_CORS,
  });
  try {
    await pipeline(createReadStream(path), response);
  } catch {
    // Player dropped the request (seek or close) — nothing to clean up.
  }
}

/**
 * Range proxy for direct-play files. The player only ever sees a same-origin
 * token, so CORS, redirects and hoster credentials stay inside core, and the
 * probed mime type overrides whatever the hoster claims.
 */
async function sendDirectProxy(
  request: IncomingMessage,
  response: ServerResponse,
  target: { url: string; mimeType: string },
  method: string,
): Promise<void> {
  const headers: Record<string, string> = { 'user-agent': 'tvm-core' };
  const range = incomingHeader(request.headers.range);
  if (range !== '') headers['range'] = range;
  let upstream: Response;
  try {
    upstream = await fetch(target.url, { headers, redirect: 'follow' });
  } catch {
    sendJson(response, 502, { error: 'unreachable' });
    return;
  }
  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 416) {
    try {
      await upstream.body?.cancel();
    } catch {
      // Upstream error body is irrelevant.
    }
    sendJson(response, 502, { error: `upstream ${upstream.status}` });
    return;
  }
  const out: Record<string, string | number> = {
    'content-type': target.mimeType,
    'accept-ranges': upstream.headers.get('accept-ranges') ?? 'bytes',
    'cache-control': 'no-store',
    ...PROXY_CORS,
  };
  const contentLength = upstream.headers.get('content-length');
  if (contentLength !== null && contentLength !== '') out['content-length'] = contentLength;
  const contentRange = upstream.headers.get('content-range');
  if (contentRange !== null && contentRange !== '') out['content-range'] = contentRange;
  response.writeHead(upstream.status === 206 ? 206 : upstream.status === 416 ? 416 : 200, out);
  if (method === 'HEAD' || upstream.body === null) {
    try {
      await upstream.body?.cancel();
    } catch {
      // Headers-only response.
    }
    response.end();
    return;
  }
  try {
    response.socket?.setNoDelay(true);
  } catch {
    // Socket already closed.
  }
  try {
    await pipeline(Readable.fromWeb(upstream.body, { highWaterMark: 512 * 1024 }), response);
  } catch {
    try {
      await upstream.body.cancel();
    } catch {
      // Client left mid-stream; dropping upstream is the correct cleanup.
    }
  }
}

async function handleStreamApi(
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
  streamer: StreamerService,
): Promise<boolean> {
  if (!path.startsWith('/api/stream/')) return false;
  const method = request.method ?? 'GET';

  if (method === 'OPTIONS') {
    response.writeHead(204, PROXY_CORS);
    response.end();
    return true;
  }

  if (path === '/api/stream/status' && method === 'GET') {
    sendJson(response, 200, { ffmpeg: streamer.ready() });
    return true;
  }

  if (path.startsWith('/api/stream/direct/') && (method === 'GET' || method === 'HEAD')) {
    const token = path.slice('/api/stream/direct/'.length);
    const target = token === '' || token.includes('/') ? null : streamer.direct.lookup(token);
    if (target === null) {
      sendJson(response, 404, { error: 'not_found' });
      return true;
    }
    await sendDirectProxy(request, response, target, method);
    return true;
  }

  if (path.startsWith('/api/stream/hls/')) {
    const rest = path.slice('/api/stream/hls/'.length);
    const slash = rest.indexOf('/');
    const id = slash === -1 ? rest : rest.slice(0, slash);
    const tail = slash === -1 ? '' : rest.slice(slash + 1);
    if (id === '' || !streamer.sessions.has(id)) {
      sendJson(response, 404, { error: 'not_found' });
      return true;
    }

    if (tail === 'seek' && method === 'POST') {
      const body = (await readJson(request)) as { at?: unknown };
      const at = typeof body.at === 'number' && Number.isFinite(body.at) ? Math.max(0, body.at) : null;
      if (at === null) {
        sendJson(response, 400, { error: 'at must be a number' });
        return true;
      }
      const session = streamer.sessions.seek(id, at);
      if (session === null) sendJson(response, 404, { error: 'not_found' });
      else sendJson(response, 200, { ok: true, offset: session.offset });
      return true;
    }

    if (tail === 'stop' && method === 'POST') {
      streamer.sessions.stop(id);
      sendJson(response, 200, { ok: true });
      return true;
    }

    if (tail === 'ping' && method === 'POST') {
      sendJson(response, 200, { ok: streamer.sessions.ping(id) });
      return true;
    }

    if (tail === 'index.m3u8' && (method === 'GET' || method === 'HEAD')) {
      const text = await streamer.sessions.waitForPlaylist(id, 30_000);
      if (text === null) {
        sendJson(response, 404, { error: 'not_ready' });
        return true;
      }
      const payload = Buffer.from(text, 'utf8');
      response.writeHead(200, {
        'content-type': 'application/vnd.apple.mpegurl',
        'content-length': payload.length,
        'cache-control': 'no-store',
        ...PROXY_CORS,
      });
      response.end(method === 'HEAD' ? undefined : payload);
      return true;
    }

    if (tail !== '' && !tail.includes('/') && method === 'GET') {
      const file = await streamer.sessions.waitForFile(id, tail, 30_000);
      if (file === null) {
        sendJson(response, 404, { error: 'not_found' });
        return true;
      }
      await sendStreamFile(response, file, tail);
      return true;
    }
  }

  sendJson(response, 404, { error: 'not_found', path });
  return true;
}

export interface CoreOptions {
  /**
   * Directory holding the built UI. When set, core serves the interface on the
   * same origin as the API, which is what the appliance shell loads. In
   * development the Vite server serves the UI instead and proxies /api here.
   */
  uiDist?: string | undefined;
  /**
   * Development-only loader that frames the desktop UI for TV preview.
   * Served at /roku-preview when TVM_ENV=development. Not a second UI.
   */
  rokuPreview?: string | undefined;
  update?: UpdateService;
  media?: MediaService;
  live?: LiveService;
  apps?: AppsService;
  session?: SessionService;
  plans?: PlanService;
  developer?: DevUnlockService;
  streamer?: StreamerService;
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
}

async function handleApi(
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
  update: UpdateService,
  media: MediaService,
  live: LiveService,
  session: SessionService,
  apps: AppsService,
  plans: PlanService,
  developer: DevUnlockService,
  listenPort: number,
): Promise<boolean> {
  const requestedProfile = request.headers['x-tvm-profile'];
  if (typeof requestedProfile === 'string' && requestedProfile !== '') {
    try {
      media.switchProfile(requestedProfile);
    } catch {
      // Keep the stored active profile if the header is stale.
    }
  }

  if (path === '/api/health' && request.method === 'GET') {
    const payload: HealthPayload = {
      status: 'ok',
      version: CORE_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
    sendJson(response, 200, payload);
    return true;
  }

  if (path === '/api/update/status' && request.method === 'GET') {
    sendJson(response, 200, update.status());
    return true;
  }

  if (path === '/api/update/check' && request.method === 'POST') {
    try {
      sendJson(response, 200, await update.check());
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'check failed' });
    }
    return true;
  }

  if (path === '/api/update/apply' && request.method === 'POST') {
    try {
      const result = await update.apply();
      sendJson(response, 200, result);
      if (process.env['TVM_ENV'] === 'production') restartAfterApply();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'apply failed';
      const status = error instanceof Error && error.name === 'ApplyRefused' ? 403 : 400;
      sendJson(response, status, { error: 'apply_refused', reason: message });
    }
    return true;
  }

  if (path === '/api/update/token' && request.method === 'PUT') {
    try {
      const body = (await readJson(request)) as { token?: unknown };
      if (typeof body.token !== 'string') {
        sendJson(response, 400, { error: 'token must be a string' });
        return true;
      }
      sendJson(response, 200, update.setToken(body.token));
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'token rejected' });
    }
    return true;
  }

  if (path === '/api/rd/status' && request.method === 'GET') {
    sendJson(response, 200, await media.status());
    return true;
  }

  if (path === '/api/profiles' && request.method === 'GET') {
    sendJson(response, 200, media.profiles());
    return true;
  }

  if (path === '/api/profiles' && request.method === 'POST') {
    const body = (await readJson(request)) as { name?: unknown };
    try {
      sendJson(response, 200, media.createProfile(typeof body.name === 'string' ? body.name : ''));
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'profile rejected' });
    }
    return true;
  }

  if (path === '/api/profiles' && request.method === 'PUT') {
    const body = (await readJson(request)) as { id?: unknown; name?: unknown };
    if (typeof body.id !== 'string' || typeof body.name !== 'string') {
      sendJson(response, 400, { error: 'id and name are required' });
      return true;
    }
    sendJson(response, 200, media.renameProfile(body.id, body.name));
    return true;
  }

  if (path === '/api/profiles/active' && request.method === 'POST') {
    const body = (await readJson(request)) as { id?: unknown };
    if (typeof body.id !== 'string') {
      sendJson(response, 400, { error: 'id must be a string' });
      return true;
    }
    try {
      sendJson(response, 200, media.switchProfile(body.id));
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'profile rejected' });
    }
    return true;
  }

  if (path === '/api/profiles/remove' && request.method === 'POST') {
    const body = (await readJson(request)) as { id?: unknown };
    if (typeof body.id !== 'string') {
      sendJson(response, 400, { error: 'id must be a string' });
      return true;
    }
    try {
      sendJson(response, 200, media.removeProfile(body.id));
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'profile rejected' });
    }
    return true;
  }

  if (path === '/api/rd/configured' && request.method === 'GET') {
    sendJson(response, 200, { configured: media.configured() });
    return true;
  }

  if (path === '/api/rd/token' && request.method === 'PUT') {
    try {
      const body = (await readJson(request)) as { token?: unknown };
      if (typeof body.token !== 'string') {
        sendJson(response, 400, { error: 'token must be a string' });
        return true;
      }
      sendJson(response, 200, await media.setToken(body.token));
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'token rejected' });
    }
    return true;
  }

  if (path === '/api/apps' && request.method === 'GET') {
    sendJson(response, 200, apps.list());
    return true;
  }

  if (path.startsWith('/api/apps/') && request.method === 'GET') {
    const id = decodeURIComponent(path.slice('/api/apps/'.length));
    if (id === '' || id.includes('/')) {
      sendJson(response, 404, { error: 'not_found' });
      return true;
    }
    const hub = await apps.hub(id);
    if (hub === null) sendJson(response, 404, { error: 'not_found' });
    else sendJson(response, 200, hub);
    return true;
  }

  if (path === '/api/home' && request.method === 'GET') {
    const home = await media.home();
    sendJson(response, 200, home);
    return true;
  }

  if (path === '/api/library' && request.method === 'GET') {
    try {
      sendJson(response, 200, { items: await media.library() });
    } catch {
      sendJson(response, 200, { items: [] });
    }
    return true;
  }

  if (path === '/api/media' && request.method === 'GET') {
    const id = new URL(request.url ?? '/', `http://${CORE_HOST}`).searchParams.get('id') ?? '';
    const item = await media.item(id);
    if (item === null) sendJson(response, 404, { error: 'not_found' });
    else sendJson(response, 200, item);
    return true;
  }

  if (path === '/api/media/children' && request.method === 'GET') {
    const id = new URL(request.url ?? '/', `http://${CORE_HOST}`).searchParams.get('id') ?? '';
    sendJson(response, 200, { items: await media.children(id) });
    return true;
  }

  if (path === '/api/watchlist' && request.method === 'GET') {
    sendJson(response, 200, { items: media.watchlist() });
    return true;
  }

  if (path === '/api/watchlist' && request.method === 'PUT') {
    const body = (await readJson(request)) as { item?: unknown };
    const items = media.addToWatchlist(body.item);
    sendJson(response, 200, { items });
    return true;
  }

  if (path === '/api/watchlist/remove' && request.method === 'POST') {
    const body = (await readJson(request)) as { id?: unknown };
    if (typeof body.id !== 'string') {
      sendJson(response, 400, { error: 'id must be a string' });
      return true;
    }
    sendJson(response, 200, { items: media.removeFromWatchlist(body.id) });
    return true;
  }

  if (path === '/api/live/catalog' && request.method === 'GET') {
    const params = new URL(request.url ?? '/', `http://${CORE_HOST}`).searchParams;
    const offsetRaw = params.get('offset');
    const limitRaw = params.get('limit');
    sendJson(
      response,
      200,
      await live.catalog({
        q: params.get('q') ?? '',
        group: params.get('group') ?? '',
        offset: offsetRaw === null ? 0 : Number(offsetRaw),
        limit: limitRaw === null ? undefined : Number(limitRaw),
      }),
    );
    return true;
  }

  if (path === '/api/live/picks' && request.method === 'PUT') {
    const body = (await readJson(request)) as { ids?: unknown };
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== 'string')) {
      sendJson(response, 400, { error: 'ids must be a string array' });
      return true;
    }
    sendJson(response, 200, await live.setPicks(body.ids));
    return true;
  }

  if (path === '/api/live/picks' && request.method === 'POST') {
    const body = (await readJson(request)) as { id?: unknown; picked?: unknown };
    if (typeof body.id !== 'string' || typeof body.picked !== 'boolean') {
      sendJson(response, 400, { error: 'id and picked are required' });
      return true;
    }
    sendJson(response, 200, await live.togglePick(body.id, body.picked));
    return true;
  }

  if (path === '/api/live/picks/group' && request.method === 'POST') {
    const body = (await readJson(request)) as { group?: unknown; picked?: unknown };
    if (typeof body.group !== 'string' || typeof body.picked !== 'boolean') {
      sendJson(response, 400, { error: 'group and picked are required' });
      return true;
    }
    sendJson(response, 200, await live.setGroupPicks(body.group, body.picked));
    return true;
  }

  if (path === '/api/live' && request.method === 'GET') {
    sendJson(response, 200, await live.status());
    return true;
  }

  if (path === '/api/live' && request.method === 'PUT') {
    const body = (await readJson(request)) as { url?: unknown; text?: unknown };
    const text = typeof body.text === 'string' ? body.text : '';
    const url = typeof body.url === 'string' ? body.url : '';
    if (typeof body.url !== 'string' && typeof body.text !== 'string') {
      sendJson(response, 400, { error: 'url or playlist text is required' });
      return true;
    }
    sendJson(response, 200, await live.setPlaylist(text.trim() !== '' ? text : url));
    return true;
  }

  if (path === '/api/live/xtream' && request.method === 'PUT') {
    const body = (await readJson(request)) as { host?: unknown; username?: unknown; password?: unknown };
    if (typeof body.host !== 'string' || typeof body.username !== 'string' || typeof body.password !== 'string') {
      sendJson(response, 400, { error: 'host, username and password are required' });
      return true;
    }
    sendJson(response, 200, await live.setXtream({ host: body.host, username: body.username, password: body.password }));
    return true;
  }

  if (path === '/api/live/xtream' && request.method === 'DELETE') {
    sendJson(response, 200, await live.clearXtream());
    return true;
  }

  if (path.startsWith('/api/live/stream/') && request.method === 'OPTIONS') {
    response.writeHead(204, PROXY_CORS);
    response.end();
    return true;
  }

  if (path.startsWith('/api/live/stream/') && (request.method === 'GET' || request.method === 'HEAD')) {
    const id = decodeURIComponent(path.slice('/api/live/stream/'.length));
    if (id === '' || id.includes('/')) {
      sendJson(response, 404, { error: 'not_found' });
      return true;
    }
    await sendLiveProxy(response, await live.proxyChannel(id, proxyRequestHeaders(request), request.method), request.method);
    return true;
  }

  if (path.startsWith('/api/live/hop/') && request.method === 'OPTIONS') {
    response.writeHead(204, PROXY_CORS);
    response.end();
    return true;
  }

  if (path.startsWith('/api/live/hop/') && (request.method === 'GET' || request.method === 'HEAD')) {
    const token = path.slice('/api/live/hop/'.length);
    if (token === '' || token.includes('/')) {
      sendJson(response, 404, { error: 'not_found' });
      return true;
    }
    await sendLiveProxy(response, await live.proxyHop(token, proxyRequestHeaders(request), request.method), request.method);
    return true;
  }

  if (path === '/api/art' && request.method === 'GET') {
    const src = new URL(request.url ?? '/', `http://${CORE_HOST}`).searchParams.get('src') ?? '';
    const target = isAllowedArtUrl(src);
    if (target === null) {
      sendJson(response, 400, { error: 'art host not allowed' });
      return true;
    }
    await sendArtProxy(response, target);
    return true;
  }

  if (path === '/api/search' && request.method === 'GET') {
    const query = new URL(request.url ?? '/', `http://${CORE_HOST}`).searchParams.get('q') ?? '';
    sendJson(response, 200, { items: await media.search(query) });
    return true;
  }

  if (path === '/api/playback' && request.method === 'POST') {
    const body = (await readJson(request)) as {
      id?: unknown;
      link?: unknown;
      title?: unknown;
      season?: unknown;
      episode?: unknown;
    };
    const id = typeof body.id === 'string' ? body.id : undefined;
    if (id !== undefined && !id.startsWith('live:') && plans.hoursBlocked()) {
      sendJson(response, 409, { kind: 'unavailable', reason: 'hours-cap' });
      return true;
    }
    const result =
      id !== undefined && id.startsWith('live:')
        ? await live.play(id)
        : await media.play({
            id,
            link: typeof body.link === 'string' ? body.link : undefined,
            title: typeof body.title === 'string' ? body.title : undefined,
            season: typeof body.season === 'number' ? body.season : undefined,
            episode: typeof body.episode === 'number' ? body.episode : undefined,
          });
    // On-demand streams keep their upstream URL. Routing Real-Debrid media
    // through the Core hop re-buffers every byte in Node and was the desktop
    // play→buffer loop; the hop exists for live panels that need CORS and
    // password stripping, and those already resolve to /api/live/stream/.
    sendJson(response, result.kind === 'stream' ? 200 : 409, withPublicUrl(request, result, listenPort));
    return true;
  }

  if (path === '/api/progress' && request.method === 'POST') {
    const body = (await readJson(request)) as { id?: unknown; position?: unknown; duration?: unknown };
    if (typeof body.id !== 'string' || typeof body.position !== 'number' || typeof body.duration !== 'number') {
      sendJson(response, 400, { error: 'invalid progress' });
      return true;
    }
    media.saveProgress(body.id, body.position, body.duration);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (path === '/api/maintenance/clear-cache' && request.method === 'POST') {
    media.clearCache();
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (path === '/api/maintenance/factory-reset' && request.method === 'POST') {
    media.factoryReset();
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (path === '/api/plan' && request.method === 'GET') {
    sendJson(response, 200, plans.status());
    return true;
  }

  if (path === '/api/plan' && request.method === 'PUT') {
    if (!developer.unlocked()) {
      sendJson(response, 403, { error: 'developer_required' });
      return true;
    }
    const body = (await readJson(request)) as { id?: unknown };
    if (!isPlanId(body.id)) {
      sendJson(response, 400, { error: 'unknown_plan' });
      return true;
    }
    sendJson(response, 200, plans.set(body.id, 'dev'));
    return true;
  }

  if (path === '/api/plan/style' && request.method === 'POST') {
    const body = (await readJson(request)) as { id?: unknown };
    if (!isStyleId(body.id)) {
      sendJson(response, 400, { error: 'unknown_style' });
      return true;
    }
    try {
      sendJson(response, 200, plans.setStyle(body.id));
    } catch (error) {
      sendJson(response, 403, { error: error instanceof Error ? error.message : 'style locked' });
    }
    return true;
  }

  if (path === '/api/plan/live-tv' && request.method === 'POST') {
    const body = (await readJson(request)) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      sendJson(response, 400, { error: 'enabled must be a boolean' });
      return true;
    }
    try {
      sendJson(response, 200, plans.setLiveTv(body.enabled));
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'live tv failed' });
    }
    return true;
  }

  if (path === '/api/plan/synthwave' && request.method === 'POST') {
    const body = (await readJson(request)) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      sendJson(response, 400, { error: 'enabled must be a boolean' });
      return true;
    }
    try {
      sendJson(response, 200, plans.setSynthwave(body.enabled));
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'synthwave failed' });
    }
    return true;
  }

  if (path === '/api/billing/checkout' && request.method === 'POST') {
    try {
      const body = (await readJson(request)) as {
        planId?: unknown;
        name?: unknown;
        number?: unknown;
        expiry?: unknown;
        cvc?: unknown;
        liveTv?: unknown;
        synthwave?: unknown;
      };
      sendJson(response, 200, plans.checkout(body));
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'checkout failed' });
    }
    return true;
  }

  if (path === '/api/usage/tick' && request.method === 'POST') {
    const body = (await readJson(request)) as { seconds?: unknown; billable?: unknown };
    const seconds = typeof body.seconds === 'number' ? body.seconds : 0;
    const billable = body.billable !== false;
    sendJson(response, 200, plans.tickUsage(seconds, billable));
    return true;
  }

  if (path === '/api/usage/reset' && request.method === 'POST') {
    if (!developer.unlocked()) {
      sendJson(response, 403, { error: 'developer_required' });
      return true;
    }
    sendJson(response, 200, plans.resetUsage());
    return true;
  }

  if (path === '/api/ads/preroll' && request.method === 'GET') {
    sendJson(response, 200, await fetchVastPreroll());
    return true;
  }

  if (path === '/api/dev/status' && request.method === 'GET') {
    sendJson(response, 200, { unlocked: developer.unlocked() });
    return true;
  }

  if (path === '/api/dev/unlock' && request.method === 'POST') {
    const body = (await readJson(request)) as { password?: unknown };
    const password = typeof body.password === 'string' ? body.password : '';
    const ok = developer.unlock(password);
    sendJson(response, ok ? 200 : 403, { unlocked: ok, error: ok ? undefined : 'That code is not valid.' });
    return true;
  }

  if (path === '/api/dev/lock' && request.method === 'POST') {
    developer.lock();
    plans.clearOverrides();
    sendJson(response, 200, { unlocked: false });
    return true;
  }

  if (path === '/api/dev/overrides' && request.method === 'PUT') {
    if (!developer.unlocked()) {
      sendJson(response, 403, { error: 'developer_required' });
      return true;
    }
    const body = (await readJson(request)) as DevOverrides;
    sendJson(response, 200, plans.setOverrides(body));
    return true;
  }

  if (path === '/api/system/session' && request.method === 'GET') {
    sendJson(response, 200, session.status());
    return true;
  }

  if (path === '/api/system/session' && request.method === 'POST') {
    const body = (await readJson(request)) as { mode?: unknown };
    const result = session.request(body.mode);
    sendJson(response, result.ok ? 200 : 409, result);
    return true;
  }

  return false;
}

export function createCoreServer(options: CoreOptions = {}): Server {
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? resolveDataDir(env);
  const update = options.update ?? createUpdateService({ dataDir, env });
  const developer = options.developer ?? createDevUnlockService({ dataDir });
  const plans = options.plans ?? createPlanService({ dataDir, developer: () => developer.unlocked() });
  const live = options.live ?? createLiveService({ dataDir, includeMock: () => plans.status().liveTv });
  const session = options.session ?? createSessionService({ dataDir });
  const streamer = options.streamer ?? createStreamer({ dataDir, env });
  const media =
    options.media ??
    createMediaService({
      dataDir,
      rd: createRealDebrid({ dataDir, env }),
      streamer,
      plan: () => plans.status(),
      poolToken: () => plans.poolToken(),
    });
  const apps =
    options.apps ??
    createAppsService({
      dataDir,
      env,
      continueWatching: async () => (await media.home()).continueWatching,
    });

  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', `http://${CORE_HOST}`).pathname;
      const addr = server.address();
      const listenPort = addr !== null && typeof addr === 'object' ? addr.port : resolvePort(env);

      if (await handleStreamApi(path, request, response, streamer)) return;
      if (await handleApi(path, request, response, update, media, live, session, apps, plans, developer, listenPort)) return;

      if (path.startsWith('/api/')) {
        sendJson(response, 404, { error: 'not_found', path });
        return;
      }

      if (request.method === 'GET' && env['TVM_ENV'] === 'development' && options.rokuPreview !== undefined) {
        if (path === '/roku-preview' || path === '/roku-preview/' || path.startsWith('/roku-preview/')) {
          const rel =
            path === '/roku-preview' || path === '/roku-preview/' ? '/index.html' : path.slice('/roku-preview'.length);
          const previewed = await serveExactStatic(options.rokuPreview, rel, response);
          if (!previewed) sendJson(response, 404, { error: 'not_found', path });
          return;
        }
      }

      const uiDist = options.uiDist;
      if (uiDist === undefined || request.method !== 'GET') {
        sendJson(response, 404, { error: 'not_found', path });
        return;
      }

      const served = await serveStatic(uiDist, path, response);
      if (!served) sendJson(response, 404, { error: 'not_found', path });
    })().catch((error: unknown) => {
      if (error instanceof Error && error.message === 'request body too large') {
        sendJson(response, 413, { error: 'request body too large' });
        return;
      }
      sendJson(response, 500, { error: 'internal_error' });
    });
  });
  server.on('close', () => streamer.sessions.stopAll());
  return server;
}

export interface RunningCore {
  port: number;
  host: string;
  close: () => Promise<void>;
}

function listen(server: Server, port: number, host: string): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Core server did not bind to a TCP address'));
        return;
      }
      resolve(address);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function canFallBackToLoopback(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = String((error as { code?: unknown }).code);
  return code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT' || code === 'EINVAL';
}

export async function startCoreServer(port: number, options: CoreOptions = {}): Promise<RunningCore> {
  const server = createCoreServer(options);
  const requested = resolveBindHost(options.env ?? process.env);
  let address: AddressInfo;
  try {
    address = await listen(server, port, requested);
  } catch (error) {
    if (requested === CORE_HOST || !canFallBackToLoopback(error)) throw error;
    address = await listen(server, port, CORE_HOST);
  }

  return {
    port: address.port,
    host: address.address,
    close: () =>
      new Promise<void>((done, fail) => {
        server.close((error) => (error ? fail(error) : done()));
      }),
  };
}
