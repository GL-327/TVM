import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireCapability } from './entitlementGate.ts';
import { liveTvIsActive } from './liveTv.ts';
import { createPlanService } from './plans.ts';
import { writeSealed } from './vault.ts';
import { entitlementPath } from '../update/paths.ts';

vi.mock('./secureFile.ts', async original => ({ ...await original<typeof import('./secureFile.ts')>(), windowsProtect: (value: string) => value }));
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'tvm-gate-')); dirs.push(dataDir);
  const env = { TVM_LIVE_TV_ONLINE: '1' };
  return { dataDir, env, plans: createPlanService({ dataDir, env }) };
}
describe('Live TV entitlement and health', () => {
  for (const liveTv of [false, true]) for (const liveTvHealthy of [false, true]) for (const dev of [false, true]) {
    it(`gates entitled=${liveTv}, healthy=${liveTvHealthy}, dev=${dev}`, () => {
      const decision = requireCapability('liveTv', { liveTv, liveTvHealthy, dev });
      if (!liveTv && !dev) expect(decision).toMatchObject({ ok: false, status: 403, error: 'live_tv_not_entitled' });
      else if (!liveTvHealthy) expect(decision).toMatchObject({ ok: false, status: 503, error: 'live_tv_unavailable', message: expect.any(String) });
      else expect(decision).toEqual({ ok: true });
    });
  }
  it.each(['quarter', 'year'] as const)('honors legacy %s only until its known expiry', term => {
    const now = new Date('2026-11-17T12:00:00Z');
    const grant = { liveTvAddon: true, liveTvTerm: term, liveTvExpiresAt: '2026-11-17T12:00:01Z' };
    expect(liveTvIsActive({ ...grant, now, serviceOnline: false })).toBe(true);
    expect(liveTvIsActive({ ...grant, now: new Date(grant.liveTvExpiresAt) })).toBe(false);
    expect(liveTvIsActive({ ...grant, liveTvExpiresAt: undefined, now })).toBe(false);
    expect(liveTvIsActive({ ...grant, liveTvExpiresAt: 'invalid', now })).toBe(false);
  });
  it('preserves manual lifetime grants through outages and hides legacy purchase menus', () => {
    const f = fixture(); f.plans.syncAccountTier('max', true);
    const before = readFileSync(entitlementPath(f.dataDir), 'utf8');
    expect(f.plans.status()).toMatchObject({ id: 'max', liveTv: true, liveTvHealthy: true, liveTvTerm: 'lifetime', catalog: [], liveTvTerms: [] });
    f.env.TVM_LIVE_TV_ONLINE = '0';
    expect(f.plans.status()).toMatchObject({ id: 'max', liveTv: true, liveTvHealthy: false });
    expect(requireCapability('liveTv', f.plans.status())).toMatchObject({ status: 503 });
    expect(readFileSync(entitlementPath(f.dataDir), 'utf8')).toBe(before);
    f.env.TVM_LIVE_TV_ONLINE = '1';
    expect(requireCapability('liveTv', f.plans.status())).toEqual({ ok: true });
  });
  it.each(['quarter', 'year'] as const)('does not extend %s grants on account refresh or a base-tier update', term => {
    const f = fixture();
    writeSealed(f.dataDir, entitlementPath(f.dataDir), { id: 'premium', styleId: 'classic', source: 'checkout', overrides: {}, liveTvAddon: true, liveTvTerm: term, liveTvExpiresAt: '2020-01-01T00:00:00Z' });
    expect(f.plans.syncAccountTier('max', true).liveTv).toBe(false);
    expect(f.plans.syncAccountTier('max', true).liveTv).toBe(false);
    f.env.TVM_LIVE_TV_ONLINE = '0';
    expect(f.plans.status()).toMatchObject({ id: 'max', liveTv: false, liveTvHealthy: false });
    expect(requireCapability('liveTv', f.plans.status())).toMatchObject({ status: 403 });
  });
  it('preserves valid finite legacy grants instead of replacing them with lifetime', () => {
    const f = fixture();
    writeSealed(f.dataDir, entitlementPath(f.dataDir), { id: 'premium', styleId: 'classic', source: 'checkout', overrides: {}, liveTvAddon: true, liveTvTerm: 'year', liveTvExpiresAt: '2099-01-01T00:00:00Z' });
    expect(f.plans.syncAccountTier('max', true)).toMatchObject({ liveTv: true, liveTvTerm: 'year', liveTvExpiresAt: '2099-01-01T00:00:00Z' });
  });
});
