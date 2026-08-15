import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/**
 * Resolves a URL path inside the bundle root, or null if it is not acceptable.
 *
 * The UI bundle is served over HTTP, so a traversal bug here would expose the
 * whole filesystem to anything that reaches the port. Rather than relying on
 * normalize() to clamp "..", such requests are rejected outright: the rule
 * stays obvious to anyone auditing this later.
 */
export function resolveStaticPath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  if (decoded.includes('\0')) return null;
  if (decoded.split(/[/\\]/).includes('..')) return null;

  const rootPath = resolve(root);
  const candidate = resolve(join(rootPath, normalize(decoded)));

  if (candidate !== rootPath && !candidate.startsWith(rootPath + sep)) return null;
  return candidate;
}

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Serves a file from the UI bundle. Unknown paths fall back to index.html so
 * the client-side view stack survives a reload. Returns false when there is
 * nothing to serve, letting the caller answer 404.
 */
export async function serveStatic(
  root: string,
  urlPath: string,
  response: ServerResponse,
): Promise<boolean> {
  const requested = resolveStaticPath(root, urlPath === '/' ? '/index.html' : urlPath);
  if (requested === null) return false;

  const filePath = await firstReadableFile([requested, join(root, 'index.html')]);
  if (filePath === null) return false;

  const isEntryDocument = filePath.endsWith('index.html');
  response.writeHead(200, {
    'content-type': contentTypeFor(filePath),
    'cache-control': isEntryDocument ? 'no-store' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });

  createReadStream(filePath).pipe(response);
  return true;
}

async function firstReadableFile(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      const stats = await stat(candidate);
      if (stats.isFile()) return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}
