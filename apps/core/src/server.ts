import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { CORE_HOST, CORE_VERSION, resolveBindHost } from './config.ts';
import { readJson, sendJson } from './http.ts';
import { createAppsService, type AppsService } from './providers/apps.ts';
import { createLiveService, type LiveService } from './providers/live.ts';
import { createMediaService, type MediaService } from './providers/media.ts';
import { createPlanService, isPlanId, type PlanService } from './providers/plans.ts';
import { createRealDebrid } from './providers/realdebrid.ts';
import { createSessionService, type SessionService } from './providers/session.ts';
import { serveExactStatic, serveStatic } from './static.ts';
import { resolveDataDir } from './update/paths.ts';
import { createUpdateService, restartAfterApply, type UpdateService } from './update/service.ts';

export { CORE_VERSION };

const startedAt = Date.now();

export interface HealthPayload {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
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

  if (path === '/api/live' && request.method === 'GET') {
    sendJson(response, 200, await live.status());
    return true;
  }

  if (path === '/api/live' && request.method === 'PUT') {
    const body = (await readJson(request)) as { url?: unknown };
    if (typeof body.url !== 'string') {
      sendJson(response, 400, { error: 'url must be a string' });
      return true;
    }
    sendJson(response, 200, await live.setPlaylist(body.url));
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
    sendJson(response, result.kind === 'stream' ? 200 : 409, result);
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
    const body = (await readJson(request)) as { id?: unknown };
    if (!isPlanId(body.id)) {
      sendJson(response, 400, { error: 'unknown_plan' });
      return true;
    }
    sendJson(response, 200, plans.set(body.id));
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
  const live = options.live ?? createLiveService({ dataDir });
  const session = options.session ?? createSessionService({ dataDir });
  const media =
    options.media ??
    createMediaService({
      dataDir,
      rd: createRealDebrid({ dataDir, env }),
    });
  const apps =
    options.apps ??
    createAppsService({
      dataDir,
      env,
      continueWatching: async () => (await media.home()).continueWatching,
    });
  const plans = options.plans ?? createPlanService({ dataDir });

  return createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', `http://${CORE_HOST}`).pathname;

      if (await handleApi(path, request, response, update, media, live, session, apps, plans)) return;

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
}

export interface RunningCore {
  port: number;
  host: string;
  close: () => Promise<void>;
}

export function startCoreServer(port: number, options: CoreOptions = {}): Promise<RunningCore> {
  const server = createCoreServer(options);
  const host = resolveBindHost(options.env ?? process.env);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);

      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Core server did not bind to a TCP address'));
        return;
      }

      resolve({
        port: address.port,
        host: address.address,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
