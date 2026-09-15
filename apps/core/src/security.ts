import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function tokenMatches(header: string | undefined, expected: string | undefined): boolean {
  if (!expected || expected.length < 32 || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

/**
 * Stripe's webhook is the one endpoint that must accept a request from the
 * public internet. Every check below is a network-origin check — loopback,
 * host name, Origin header — and Stripe satisfies none of them.
 *
 * It does not need to. The request carries an HMAC-SHA256 signature over its
 * raw body, made with a secret only Stripe and this server hold, and
 * payments.webhook() verifies that in constant time before reading a single
 * field. A forged request fails the signature and changes nothing; if no
 * webhook secret is configured, every request is refused. That is stronger
 * authentication than "arrived from 127.0.0.1", not weaker, which is why this
 * exemption is safe and why it is limited to exactly this one path.
 */
const SIGNED_WEBHOOK = '/api/billing/webhook';

export function accessError(request: IncomingMessage, path: string, env: NodeJS.ProcessEnv, sessionAuthenticated = false): string | null {
  if (path === SIGNED_WEBHOOK && request.method === 'POST') return null;
  const local = isLoopback(request.socket.remoteAddress);
  let host: URL;
  try {
    host = new URL(`http://${request.headers.host ?? ''}`);
    const name = host.hostname.replace(/^\[|\]$/g, '');
    if (!['localhost', '127.0.0.1', '::1', request.socket.localAddress?.replace('::ffff:', '')].includes(name)) return 'untrusted_host';
  } catch { return 'untrusted_host'; }

  const origin = request.headers.origin;
  if (origin !== undefined) {
    const allowed = new Set([host.origin]);
    if (env['TVM_ENV'] !== 'production') {
      for (const name of ['127.0.0.1', 'localhost']) {
        for (const port of ['5173', '15173']) allowed.add(`http://${name}:${port}`);
      }
    }
    if (!allowed.has(origin)) return 'untrusted_origin';
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') return 'cross_site_request';
  if (!local && path !== '/api/health') {
    if (!sessionAuthenticated && !tokenMatches(request.headers.authorization, env['TVM_LAN_TOKEN'])) return 'lan_authentication_required';
    if (/^\/api\/(dev|billing|maintenance|update|system|privacy)(\/|$)/.test(path) ||
        /^\/api\/plan/.test(path) && request.method !== 'GET') return 'local_access_required';
  }
  const contentType = request.headers['content-type'];
  if (path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? 'GET') &&
      contentType !== undefined && !/^application\/json(?:;|$)/i.test(contentType)) return 'json_required';
  return null;
}

export function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-frame-options', 'SAMEORIGIN');
  // payment=() would switch off the Payment Request API, and with it Apple Pay
  // and Google Pay inside Stripe's element.
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")');
  // Stripe.js must be loaded from Stripe rather than bundled — their terms
  // require it, so that fraud checks cannot go stale — and the card fields are
  // an iframe from js.stripe.com, with hooks.stripe.com used for 3-D Secure.
  // These three origins are the whole of the addition; script-src stays
  // otherwise closed.
  response.setHeader('content-security-policy', [
    "default-src 'self'",
    "script-src 'self' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "media-src 'self' https: http://127.0.0.1:* blob:",
    "connect-src 'self' https: http://127.0.0.1:*",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; '));
}

export function createUnlockLimiter(now = Date.now): () => boolean {
  let attempts: number[] = [];
  return () => {
    const time = now();
    attempts = attempts.filter((at) => time - at < 60_000);
    if (attempts.length >= 5) return false;
    attempts.push(time);
    return true;
  };
}
