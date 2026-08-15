import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { CORE_HOST } from './config.ts';
import { serveStatic } from './static.ts';

export const CORE_VERSION = '0.1.0';

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
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

function handleApi(path: string, request: IncomingMessage, response: ServerResponse): boolean {
  if (path === '/api/health' && request.method === 'GET') {
    const payload: HealthPayload = {
      status: 'ok',
      version: CORE_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
    sendJson(response, 200, payload);
    return true;
  }
  return false;
}

export function createCoreServer(options: CoreOptions = {}): Server {
  return createServer((request, response) => {
    const path = new URL(request.url ?? '/', `http://${CORE_HOST}`).pathname;

    if (handleApi(path, request, response)) return;

    if (path.startsWith('/api/')) {
      sendJson(response, 404, { error: 'not_found', path });
      return;
    }

    const uiDist = options.uiDist;
    if (uiDist === undefined || request.method !== 'GET') {
      sendJson(response, 404, { error: 'not_found', path });
      return;
    }

    void serveStatic(uiDist, path, response)
      .then((served) => {
        if (!served) sendJson(response, 404, { error: 'not_found', path });
      })
      .catch(() => {
        sendJson(response, 500, { error: 'internal_error' });
      });
  });
}

export interface RunningCore {
  port: number;
  close: () => Promise<void>;
}

export function startCoreServer(port: number, options: CoreOptions = {}): Promise<RunningCore> {
  const server = createCoreServer(options);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, CORE_HOST, () => {
      server.removeListener('error', reject);

      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Core server did not bind to a TCP address'));
        return;
      }

      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
