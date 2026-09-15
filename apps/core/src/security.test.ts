import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { accessError, createUnlockLimiter, setSecurityHeaders } from './security.ts';
import { readSecret, writeSecret } from './providers/secrets.ts';
import { createPlanService } from './providers/plans.ts';
import { createDevUnlockService } from './providers/devUnlock.ts';
import { masterKeyPath, devUnlockFlagPath, entitlementPath } from './update/paths.ts';

const dirs: string[] = [];
function folder(): string { const dir = mkdtempSync(join(tmpdir(), 'tvm-security-')); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
function request(headers: Record<string, string> = {}, remote = '127.0.0.1'): IncomingMessage {
  return { headers: { host: '127.0.0.1:7345', ...headers }, method: 'POST', socket: { remoteAddress: remote, localAddress: '127.0.0.1' } } as IncomingMessage;
}
describe('card payment security headers', () => {
  function headers(): Record<string, string> {
    const set: Record<string, string> = {};
    setSecurityHeaders({ setHeader: (name: string, value: string) => { set[name] = value; } } as never);
    return set;
  }

  it('lets Stripe load its script and mount its card iframe', () => {
    const csp = headers()['content-security-policy'] ?? '';
    // Without these the payment element silently never appears: the browser
    // blocks the script and the iframe, and the console error is easy to miss.
    expect(csp).toContain("script-src 'self' https://js.stripe.com");
    expect(csp).toContain('frame-src');
    expect(csp).toContain('https://js.stripe.com');
    expect(csp).toContain('https://hooks.stripe.com');
    // Nothing else gained script access along the way.
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("script-src *");
  });

  it('leaves the Payment Request API available to Stripe', () => {
    // payment=() would disable Apple Pay and Google Pay inside the element.
    expect(headers()['permissions-policy']).toContain('payment=(self "https://js.stripe.com")');
  });

  it('accepts the signed Stripe webhook from off-box, and nothing else', () => {
    const remote = (path: string, method = 'POST') => accessError(
      { headers: { host: '127.0.0.1:7345' }, method, socket: { remoteAddress: '203.0.113.9', localAddress: '127.0.0.1' } } as IncomingMessage,
      path,
      {},
    );
    // The webhook proves itself with an HMAC signature instead of an origin.
    expect(remote('/api/billing/webhook')).toBeNull();
    // The exemption is exactly one path and one method; everything else in the
    // billing surface stays local-only.
    expect(remote('/api/billing/webhook', 'GET')).not.toBeNull();
    expect(remote('/api/billing/checkout')).not.toBeNull();
    expect(remote('/api/billing/refund')).not.toBeNull();
    expect(remote('/api/billing/stripe/keys')).not.toBeNull();
    expect(remote('/api/billing/webhook/../checkout')).not.toBeNull();
  });
});

describe('initial test security', () => {
  it('blocks cross-site requests, rebinding and remote admin, allows local UI', () => {
    expect(accessError(request({ origin: 'https://evil.example' }), '/api/dev/unlock', {})).toBe('untrusted_origin');
    expect(accessError(request({ host: 'evil.example:7345' }), '/api/plan', {})).toBe('untrusted_host');
    expect(accessError(request({ origin: 'http://127.0.0.1:5173' }), '/api/plan', {})).toBeNull();
    expect(accessError(request({}, '192.168.1.9'), '/api/profiles', {})).toBe('lan_authentication_required');
    const token = 'a'.repeat(32);
    expect(accessError(request({ authorization: `Bearer ${token}` }, '192.168.1.9'), '/api/dev/unlock', { TVM_LAN_TOKEN: token })).toBe('local_access_required');
  });
  it('limits unlock attempts and restores access after the window', () => {
    let now = 0; const allowed = createUnlockLimiter(() => now);
    for (let i = 0; i < 5; i++) expect(allowed()).toBe(true);
    expect(allowed()).toBe(false); now = 60_001; expect(allowed()).toBe(true);
  });
  it('encrypts and migrates tokens without changing their value; rejects tampering', () => {
    const dir = folder(); const path = join(dir, 'secrets', 'rd-token');
    mkdirSync(join(dir, 'secrets')); writeFileSync(path, 'legacy-private-token');
    expect(readSecret(path)).toBe('legacy-private-token');
    expect(readFileSync(path, 'utf8')).not.toContain('legacy-private-token');
    writeSecret(path, 'new-private-token'); expect(readSecret(path)).toBe('new-private-token');
    if (process.platform === 'win32') expect(readFileSync(masterKeyPath(dir), 'utf8')).toMatch(/^tvm-dpapi-v1:/);
    writeFileSync(path, 'tvm-secret-v1:broken'); expect(readSecret(path)).toBeNull();
  });
  it('retains the DEV entry point but ignores a forged plain flag', () => {
    const dir = folder(); writeFileSync(devUnlockFlagPath(dir), JSON.stringify({ unlocked: true }));
    expect(createDevUnlockService({ dataDir: dir }).unlocked()).toBe(false);
  });
  it('requires consent, supports decline, deduplicates orders and preserves a one-time pack on cancellation', () => {
    const plans = createPlanService({ dataDir: folder() });
    expect(() => plans.checkout({ planId: 'basic' })).toThrow(/Confirm/);
    const order = { planId: 'basic', consent: true, requestId: 'test-order-1', liveTv: false, synthwave: true } as const;
    expect(() => plans.checkout({ ...order, simulate: 'decline' })).toThrow(/declined/);
    expect(plans.status().id).toBe('free');
    plans.checkout(order); plans.checkout(order);
    expect(plans.billing().receipts).toHaveLength(1);
    expect(plans.receipt()).toMatchObject({ monthlyPence: 499, oneTimePence: 499, chargedPence: 0 });
    expect(() => plans.checkout({ ...order, liveTv: true })).toThrow(/different transaction/);
    plans.cancel({ consent: true, requestId: 'test-cancel-1' });
    expect(plans.status()).toMatchObject({ id: 'free', synthwave: true, pricePence: 0 });
    plans.checkout({ ...order, requestId: 'test-order-2' });
    expect(plans.receipt()?.oneTimePence).toBe(0);
  });
  it('does not activate sandbox orders in production or trust corrupted entitlements', () => {
    const dir = folder(); const plans = createPlanService({ dataDir: dir });
    plans.checkout({ planId: 'premium', consent: true, requestId: 'test-corruption' });
    writeFileSync(entitlementPath(dir), 'broken'); expect(plans.status().id).toBe('free');
    const production = createPlanService({ dataDir: folder(), env: { TVM_ENV: 'production' } });
    expect(() => production.checkout({ planId: 'basic', consent: true, requestId: 'production-test' })).toThrow(/Live billing/);
  });
});
