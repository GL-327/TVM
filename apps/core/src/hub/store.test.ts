import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { openJson, sealJson } from '../providers/vault.ts';
import { hubPath, masterKeyPath } from '../update/paths.ts';
import { readActivity } from './activity.ts';
import { sendCommand } from './commands.ts';
import { HubUnavailableError, createHubStore, type HubDocument } from './store.ts';
import { fixture, registrationInput } from './testSupport.ts';

vi.mock('../providers/secureFile.ts', async original => ({ ...await original<typeof import('../providers/secureFile.ts')>(), windowsProtect: (value: string) => value }));

describe('sealed Hub storage and activity retention', () => {
  it('persists schema/revision in ciphertext and backs up exactly the previous revision', () => {
    const f = fixture(); f.linked(); const path = hubPath(f.dataDir);
    const first = readFileSync(path, 'utf8');
    expect(openJson<HubDocument>(f.dataDir, first)?.rev).toBe(1);
    f.linked('b'); const doc = createHubStore(f.dataDir).read();
    expect(doc.schema).toBe(1); expect(doc.rev).toBe(2);
    expect(readFileSync(`${path}.bak`, 'utf8')).toBe(first);
    expect(readFileSync(path, 'utf8')).not.toContain(registrationInput().name);
    expect(readdirSync(joinSecrets(f.dataDir)).filter(p => p.includes('.tmp_'))).toEqual([]);
  });
  it('fails closed on unreadable ciphertext, preserving the original and backup on writes', () => {
    const f = fixture(); f.linked(); f.linked('b'); const path = hubPath(f.dataDir);
    const backup = readFileSync(`${path}.bak`, 'utf8'); writeFileSync(path, 'damaged ciphertext');
    expect(() => f.store.read()).toThrow(HubUnavailableError);
    expect(() => f.linked('c')).toThrow(HubUnavailableError);
    expect(readFileSync(path, 'utf8')).toBe('damaged ciphertext'); expect(readFileSync(`${path}.bak`, 'utf8')).toBe(backup);
  });
  it.each([
    null, {}, { schema: 2, rev: 1, accounts: {}, unassignedPairs: {} },
    { schema: 1, rev: -1, accounts: {}, unassignedPairs: {} },
    { schema: 1, rev: 1, accounts: { acc_a: {} }, unassignedPairs: {} },
    { schema: 1, rev: 1, accounts: {}, unassignedPairs: { pair_bad: {} } },
  ])('fails closed on authenticated but invalid schema: %j', value => {
    const f = fixture(); f.linked(); const path = hubPath(f.dataDir);
    writeFileSync(path, sealJson(f.dataDir, value));
    expect(() => f.store.read()).toThrow(HubUnavailableError);
  });
  it('fails closed on malformed installation records', () => {
    const f = fixture(); const a = f.linked(); const doc = f.store.read();
    doc.accounts[f.viewer.accountId]!.installations[a.installation.id]!.slot = -1;
    writeFileSync(hubPath(f.dataDir), sealJson(f.dataDir, doc));
    expect(() => f.store.read()).toThrow(HubUnavailableError);
  });
  it('never regenerates a deleted master key or resets a missing primary with a backup', () => {
    const f = fixture(); f.linked(); const key = masterKeyPath(f.dataDir); rmSync(key);
    expect(() => f.store.read()).toThrow(HubUnavailableError); expect(existsSync(key)).toBe(false);
    const g = fixture(); g.linked(); g.linked('b'); rmSync(hubPath(g.dataDir));
    expect(() => createHubStore(g.dataDir).read()).toThrow(HubUnavailableError);
  });
  it('leaves the primary intact when writing the backup fails', () => {
    const f = fixture(); f.linked(); const path = hubPath(f.dataDir); const original = readFileSync(path, 'utf8');
    mkdirSync(`${path}.bak`);
    expect(() => f.linked('b')).toThrow(HubUnavailableError);
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(readdirSync(joinSecrets(f.dataDir)).filter(p => p.includes('.tmp_'))).toEqual([]);
  });
  it('prunes commands after 24 hours and finished pairs after one hour', () => {
    const f = fixture(); const a = f.linked(); f.beat(a.installation.id);
    f.transaction(b => sendCommand(b, { v: 1, idempotencyKey: 'retained', target: a.installation.id, action: 'nav.back' }, f.viewer, f.now()));
    const signed = f.accounts.signInDev(); const viewer = { accountId: signed.account.id, name: 'Dev', role: signed.account.role };
    const p = f.pairing.start(registrationInput(), 'http://localhost');
    f.pairing.decide(p.userCode, false, viewer, signed.token, 'ip');
    f.advance(3_600_000); f.store.transact(() => undefined);
    expect(Object.values(f.store.read().accounts[viewer.accountId]!.pairs)).toHaveLength(0);
    expect(Object.values(f.store.read().accounts[f.viewer.accountId]!.commands)).toHaveLength(1);
    f.advance(86_400_000); f.store.transact(() => undefined);
    expect(Object.values(f.store.read().accounts[f.viewer.accountId]!.commands)).toHaveLength(0);
  });
  it('never copies titles/media ids to activity, and enforces the 90-day/500-event cap', () => {
    const f = fixture(); const a = f.linked();
    f.beat(a.installation.id, { seq: 0, state: 'playing', nowPlaying: { mediaId: 'private-media-id', title: 'Private film title',
      artworkUrl: null, positionSec: 0, durationSec: null, profileId: 'profile-a' } });
    f.transaction(b => {
      for (let i = 0; i < 505; i++) sendCommand(b, { v: 1, idempotencyKey: `media-${i}`, target: a.installation.id,
        action: 'play.title', payload: { mediaId: 'private-media-id' } }, f.viewer, f.now());
      expect(readActivity(b, 500)).toHaveLength(500); expect(readActivity(b)).toHaveLength(50); expect(readActivity(b, 0)).toEqual([]);
      const log = JSON.stringify(b.activity);
      expect(log).not.toContain('Private film title'); expect(log).not.toContain('private-media-id');
      expect(log).not.toContain('payload'); expect(log).not.toContain('mediaId');
    });
    f.advance(90 * 86_400_000); f.store.transact(() => undefined);
    expect(f.store.read().accounts[f.viewer.accountId]!.activity).toEqual([]);
  });
});

function joinSecrets(dataDir: string): string { return `${dataDir}/secrets`; }
