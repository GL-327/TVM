import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeatureFlags, resolveFlags } from './featureFlags.ts';

vi.mock('./secureFile.ts', async original => ({ ...await original<typeof import('./secureFile.ts')>(), windowsProtect: (value: string) => value }));
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
describe('feature flags', () => {
  it('defaults to visible, healthy, manual activation and no new Live TV orders', () => {
    expect(resolveFlags()).toEqual({ 'liveTv.visible': true, 'liveTv.orderable': false, 'liveTv.healthy': true, selfServeBilling: false });
    expect(resolveFlags({ TVM_LIVE_TV_ONLINE: '0' })['liveTv.healthy']).toBe(false);
  });
  it('supports every environment override, ahead of file overrides', () => {
    expect(resolveFlags({ TVM_FLAG_LIVE_TV_VISIBLE: '0', TVM_FLAG_LIVE_TV_ORDERABLE: 'true', TVM_FLAG_LIVE_TV_HEALTHY: 'false', TVM_FLAG_SELF_SERVE_BILLING: '1' }, { 'liveTv.visible': true }))
      .toEqual({ 'liveTv.visible': false, 'liveTv.orderable': true, 'liveTv.healthy': false, selfServeBilling: true });
    expect(resolveFlags({ TVM_FLAG_SELF_SERVE_BILLING: 'mistyped' }).selfServeBilling).toBe(false);
  });
  it('seals partial operator overrides, retains omitted flags and fails closed on damage', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tvm-flags-')); dirs.push(dataDir);
    const flags = createFeatureFlags({ dataDir, env: {} });
    flags.set({ 'liveTv.orderable': true });
    flags.set({ 'liveTv.healthy': false });
    expect(createFeatureFlags({ dataDir, env: {} }).get()).toMatchObject({ 'liveTv.orderable': true, 'liveTv.healthy': false });
    const path = join(dataDir, 'secrets', 'flags.enc');
    expect(readFileSync(path, 'utf8')).not.toContain('orderable');
    expect(() => flags.set({ selfServeBilling: 'true' })).toThrow('invalid_flags');
    expect(() => flags.set({ unknown: true })).toThrow('invalid_flags');
    writeFileSync(path, 'damaged');
    expect(() => flags.set({ selfServeBilling: true })).toThrow('flags_unreadable');
  });
});
