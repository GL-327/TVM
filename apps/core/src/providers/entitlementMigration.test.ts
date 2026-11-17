import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyLegacyLiveGrant, entitlementMigrationReport } from './entitlementMigration.ts';
import { writeSealed } from './vault.ts';

vi.mock('./secureFile.ts', async original => ({ ...await original<typeof import('./secureFile.ts')>(), windowsProtect: (value: string) => value }));
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const at = new Date('2026-11-17T12:00:00Z');
describe('entitlement migration dry run', () => {
  it('reports manual accounts, tiers, claims, receipts and subscriptions without replaying or repricing', () => {
    const input = {
      accounts: { accounts: [
        { id: 'a', tier: 'stream-live', activated: true }, { id: 'b', tier: 'stream', activated: true, suspended: true },
        { id: 'c', tier: 'unknown', activated: true }, { id: 'd', role: 'dev' },
      ] },
      entitlement: { id: 'premium', liveTvAddon: true, liveTvTerm: 'quarter', liveTvExpiresAt: '2026-11-01', themeBundle: true },
      billing: { receipts: [{ id: 'r', planId: 'premium', liveTv: true, chargedPence: 3999 }] },
      payments: { orders: [{ paymentIntentId: 'pi_1', planId: 'max', status: 'refunded', chargedPence: 1000 }] },
      subscriptions: { current: { subscriptionId: 'sub_1', planId: 'max', state: 'active', liveTv: true, currentPeriodEnd: 2_000_000_000 } },
    };
    const before = JSON.stringify(input);
    const report = entitlementMigrationReport(input, at);
    expect(report).toMatchObject({ schemaVersion: 1, dryRun: true, generatedAt: at.toISOString(),
      summary: { manualAccounts: 4, tiers: 5, receipts: 2, subscriptions: 1, liveTvGrants: { valid: 2, expired: 1, ambiguous: 0 } },
      preservedOwnership: { themeBundle: true } });
    expect(report.manualAccounts[0]?.mapping).toMatchObject({ base: true, liveTv: true, source: 'manual' });
    expect(report.manualAccounts[1]?.mapping.base).toBe(false);
    expect(report.manualAccounts[2]?.operatorVerification).toBe(true);
    expect(report.receipts.every(receipt => receipt.mapping.replayGrant === false && receipt.mapping.reprice === false)).toBe(true);
    expect(report.subscriptions[0]).toMatchObject({ operatorVerification: true, mapping: { rebill: false, reprice: false } });
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each([
    [{ liveTvAddon: true, liveTvTerm: 'lifetime' }, 'valid'],
    [{ liveTvAddon: true, liveTvTerm: 'year', liveTvExpiresAt: '2027-01-01' }, 'valid'],
    [{ liveTvAddon: true, liveTvTerm: 'quarter', liveTvExpiresAt: '2020-01-01' }, 'expired'],
    [{ liveTvAddon: true, liveTvTerm: 'year' }, 'ambiguous'],
    [{ liveTvAddon: true, liveTvExpiresAt: 'garbled' }, 'ambiguous'],
    [{ liveTvAddon: true }, 'ambiguous'], [{ liveTvTerm: 'lifetime' }, 'ambiguous'], [{ liveTvAddon: false }, 'none'],
  ])('classifies legacy claims %j', (grant, classification) => {
    expect(classifyLegacyLiveGrant(grant, at).classification).toBe(classification);
  });
  it('CLI reads sealed stores without creating or upgrading any files', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tvm-migration-')); dirs.push(dataDir);
    const script = fileURLToPath(new URL('../../scripts/entitlement-migration-report.mjs', import.meta.url));
    const empty = JSON.parse(execFileSync(process.execPath, [script, dataDir], { encoding: 'utf8', windowsHide: true }));
    expect(empty).toMatchObject({ dryRun: true, summary: { manualAccounts: 0 } });
    expect(readdirSync(dataDir)).toEqual([]);
    const secrets = join(dataDir, 'secrets'); mkdirSync(secrets);
    const keyPath = join(secrets, 'master.key');
    const rawKey = randomBytes(32).toString('base64'); writeFileSync(keyPath, rawKey);
    writeSealed(dataDir, join(secrets, 'accounts.enc'), { version: 1, accounts: [{ id: 'a', tier: 'stream-live', activated: true }] });
    // A legacy raw key must stay raw: normal vault reads would DPAPI-upgrade it on Windows.
    writeFileSync(keyPath, rawKey);
    const files = readdirSync(secrets).map(file => ({ file, bytes: readFileSync(join(secrets, file)), mtime: statSync(join(secrets, file)).mtimeMs }));
    const report = JSON.parse(execFileSync(process.execPath, [script, dataDir], { encoding: 'utf8', windowsHide: true }));
    expect(report.summary.manualAccounts).toBe(1);
    expect(report.stores.find((store: { store: string }) => store.store === 'accounts').state).toBe('read');
    for (const file of files) {
      expect(readFileSync(join(secrets, file.file))).toEqual(file.bytes);
      expect(statSync(join(secrets, file.file)).mtimeMs).toBe(file.mtime);
    }
    expect(existsSync(join(secrets, 'quotes.enc'))).toBe(false);
    expect(readdirSync(secrets).sort()).toEqual(files.map(file => file.file).sort());
  });
  it('CLI flags unreadable stores without creating a missing master key', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tvm-migration-broken-')); dirs.push(dataDir);
    const secrets = join(dataDir, 'secrets'); mkdirSync(secrets);
    const path = join(secrets, 'entitlement.enc'); writeFileSync(path, 'damaged');
    const script = fileURLToPath(new URL('../../scripts/entitlement-migration-report.mjs', import.meta.url));
    let failure: { status?: number; stdout?: string } = {};
    try { execFileSync(process.execPath, [script, dataDir], { encoding: 'utf8', windowsHide: true }); }
    catch (error) { failure = error as typeof failure; }
    expect(failure.status).toBe(2);
    const report = JSON.parse(failure.stdout!);
    expect(report.stores.find((store: { store: string }) => store.store === 'entitlement')).toMatchObject({ state: 'unreadable', operatorVerification: true });
    expect(report.warnings).toContain('entitlement:unreadable_operator_verification_required');
    expect(readdirSync(secrets)).toEqual(['entitlement.enc']); expect(readFileSync(path, 'utf8')).toBe('damaged');
  });
});
