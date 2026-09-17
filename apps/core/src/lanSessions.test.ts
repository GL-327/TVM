import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLanSessions, LAN_COOKIE, serveLanPairing } from './lanSessions.ts';
import { accessError } from './security.ts';

const token = 'a'.repeat(48);
function request(headers: Record<string, string> = {}, encrypted = false) {
  return { method: 'GET', headers: { host: '192.168.1.2:7345', ...headers }, socket: { remoteAddress: '192.168.1.3', localAddress: '192.168.1.2', encrypted } } as unknown as IncomingMessage;
}
function response() {
  const headers: Record<string, string> = {};
  let body = '';
  return {
    headers,
    body: () => body,
    response: {
      setHeader: (key: string, value: string) => { headers[key] = value; },
      end: (value = '') => { body = String(value); },
    } as unknown as ServerResponse,
  };
}
describe('LAN sessions', () => {
  it('authenticates media without exposing the bearer token and keeps remote admin blocked', () => {
    const env = { TVM_LAN_TOKEN: token }; const sessions = createLanSessions(env);
    const result = response();
    expect(sessions.create(request(), result.response)).toBeNull();
    expect(sessions.create(request({ authorization: `Bearer ${token}` }), result.response)).toBeGreaterThan(Date.now());
    const cookie = result.headers['set-cookie']!;
    expect(cookie).toContain(`${LAN_COOKIE}=`);
    expect(cookie).toContain('HttpOnly; SameSite=Strict');
    expect(cookie).not.toContain(token);
    const client = request({ cookie: cookie.split(';')[0]! });
    expect(sessions.authenticated(client)).toBe(true);
    expect(accessError(client, '/api/stream/abc/segment-1.ts', env, sessions.authenticated(client))).toBeNull();
    expect(accessError({ ...client, method: 'POST' } as IncomingMessage, '/api/dev/unlock', env, true)).toBeNull();
    expect(accessError(client, '/api/dev/overrides', env, true)).toBe('local_access_required');
    expect(accessError(request({ origin: 'https://evil.test' }), '/api/profiles', env, true)).toBe('untrusted_origin');
    sessions.revoke(client, result.response);
    expect(sessions.authenticated(client)).toBe(false);
    expect(result.headers['set-cookie']).toContain('Max-Age=0');
  });
  it('expires sessions, rejects forged cookies and revokes them on token rotation', () => {
    let now = 100; const env = { TVM_LAN_TOKEN: token }; const sessions = createLanSessions(env, () => now);
    const result = response(); const login = request({ authorization: `Bearer ${token}` }, true);
    const expiry = sessions.create(login, result.response)!;
    expect(result.headers['set-cookie']).toContain('; Secure');
    const client = request({ cookie: result.headers['set-cookie']!.split(';')[0]! });
    expect(sessions.authenticated(request({ cookie: `${LAN_COOKIE}=forged` }))).toBe(false);
    now = expiry; expect(sessions.authenticated(client)).toBe(false);
    sessions.create(login, result.response);
    const rotated = request({ cookie: result.headers['set-cookie']!.split(';')[0]! });
    expect(sessions.authenticated(rotated)).toBe(true);
    env.TVM_LAN_TOKEN = 'b'.repeat(48); expect(sessions.authenticated(rotated)).toBe(false);
  });
  it('accepts a Roku-style bearer on media APIs and still blocks remote admin', () => {
    const env = { TVM_LAN_TOKEN: token };
    const roku = request({ authorization: `Bearer ${token}` });
    expect(accessError(roku, '/api/health', env)).toBeNull();
    expect(accessError(roku, '/api/home', env)).toBeNull();
    expect(accessError(roku, '/api/playback', env)).toBeNull();
    expect(accessError(request(), '/api/home', env)).toBe('lan_authentication_required');
    expect(accessError(request(), '/api/health', env)).toBeNull();
    expect(accessError(roku, '/api/maintenance/factory-reset', env)).toBe('local_access_required');
  });
  it('serves the pairing page without a token and keeps API pairing on POST /api/lan/session', () => {
    const page = response();
    expect(serveLanPairing('/connect', request(), page.response)).toBe(true);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body()).toContain('Connection code from your PC');
    expect(serveLanPairing('/api/home', request(), response().response)).toBe(false);
  });
});
