import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ART_HOSTS =
  /(?:^|\.)(?:image\.tmdb\.org|images\.metahub\.space|live\.metahub\.space|mzstatic\.com|tvmaze\.com|kitsu\.io|fanart\.tv)$/i;

export function isAllowedArtUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!ART_HOSTS.test(parsed.hostname)) return null;
  return parsed;
}

export async function sendArtProxy(response: ServerResponse, target: URL): Promise<void> {
  let upstream: Response;
  try {
    upstream = await fetch(target.href, {
      headers: { 'user-agent': 'tvm-core' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'unreachable' }));
    return;
  }
  if (!upstream.ok || upstream.body === null) {
    try {
      await upstream.body?.cancel();
    } catch {
      // Drop the error body.
    }
    response.writeHead(upstream.ok ? 502 : upstream.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: `upstream ${upstream.status}` }));
    return;
  }
  const type = upstream.headers.get('content-type') ?? 'image/jpeg';
  if (!type.startsWith('image/')) {
    try {
      await upstream.body.cancel();
    } catch {
      // Not an image.
    }
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_image' }));
    return;
  }
  response.writeHead(200, {
    'content-type': type,
    'cache-control': 'public, max-age=86400',
  });
  try {
    await pipeline(Readable.fromWeb(upstream.body), response);
  } catch {
    try {
      await upstream.body.cancel();
    } catch {
      // Client left.
    }
  }
}
