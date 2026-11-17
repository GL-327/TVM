import { describe, expect, it, vi } from 'vitest';
import { findDevice, publicDevice, rename, revoke, setRoom } from './devices.ts';
import { fixture } from './testSupport.ts';

// The sandbox has no loaded Windows user profile. Keep real AES/file IO; stub only DPAPI.
vi.mock('../providers/secureFile.ts', async original => ({ ...await original<typeof import('../providers/secureFile.ts')>(), windowsProtect: (value: string) => value }));

describe('Hub installations and presence', () => {
  it('registers idempotently, hashes identity/secrets, and rotates with exactly 60 seconds of grace', () => {
    const f = fixture(); const first = f.linked(); const second = f.linked();
    expect(second.installation.id).toBe(first.installation.id);
    expect(second.deviceSecret).not.toBe(first.deviceSecret);
    expect(f.resolve(f.credential(first)).installationId).toBe(first.installation.id);
    expect(JSON.stringify(f.store.read())).not.toContain(first.deviceSecret);
    expect(JSON.stringify(f.store.read())).not.toContain('client-a');
    f.advance(59_999); expect(f.resolve(f.credential(first))).toBeTruthy();
    f.advance(1); expect(() => f.resolve(f.credential(first))).toThrow(expect.objectContaining({ code: 'auth_required' }));
    expect(f.resolve(f.credential(second))).toBeTruthy();
  });

  it('keeps slots fixed across heartbeats, renames and revocation; a revoked client signs in afresh', () => {
    const f = fixture(); const a = f.linked('a'); const b = f.linked('b'); const c = f.linked('c');
    expect([a.installation.slot, b.installation.slot, c.installation.slot]).toEqual([0, 1, 2]);
    f.beat(c.installation.id);
    f.transaction(store => { rename(store, b.installation.id, 'Bedroom', f.viewer, f.now()); revoke(store, a.installation.id, f.viewer, f.now()); });
    expect(f.linked('b').installation).toMatchObject({ id: b.installation.id, slot: 1, name: 'Bedroom' });
    expect(f.linked('c').installation.slot).toBe(2);
    const signedAgain = f.linked('a');
    expect(signedAgain.installation.id).not.toBe(a.installation.id);
    expect(signedAgain.installation.slot).toBe(3);
  });

  it('allocates the lowest free slot without moving survivors', () => {
    const f = fixture(); const a = f.linked('a'); const b = f.linked('b'); f.linked('c');
    f.transaction(store => { delete store.installations[b.installation.id]; delete store.sessions[b.installation.id]; });
    expect(f.linked('d').installation.slot).toBe(1);
    expect(f.linked('a').installation.slot).toBe(a.installation.slot);
    expect(f.linked('c').installation.slot).toBe(2);
  });

  it('hashes the exact opaque clientId without whitespace normalisation', () => {
    const f = fixture();
    expect(f.linked('client').installation.id).not.toBe(f.linked(' client ').installation.id);
  });

  it('computes staleness on read and ignores stale seq without refreshing liveness or capabilities', () => {
    const f = fixture(); const a = f.linked();
    const view = () => f.transaction(b => publicDevice(findDevice(b, a.installation.id), f.viewer, f.now()));
    expect(view()).toMatchObject({ state: 'unknown', presence: 'offline', lastSeenAgeSec: null });
    f.beat(a.installation.id, { seq: 4, state: 'paused' }); f.advance(60_000);
    expect(view()).toMatchObject({ presence: 'online', state: 'paused', lastSeenAgeSec: 60 });
    expect(f.beat(a.installation.id, { seq: 4, state: 'idle', capabilities: [] })).toEqual({ ignored: true });
    f.advance(1); expect(view()).toMatchObject({ presence: 'offline', state: 'offline' });
    expect(view().capabilities).toContain('future.capability');
    f.beat(a.installation.id, { seq: 5, state: 'idle', capabilities: [] });
    expect(view()).toMatchObject({ presence: 'online', state: 'idle', capabilities: [], physicalInput: false });
  });

  it('restricts nowPlaying to the matching profile or dev role and never leaks internal fields', () => {
    const f = fixture(); const a = f.linked();
    const playing = { mediaId: 'private-media', title: 'Private title', artworkUrl: null, positionSec: 10, durationSec: 50, profileId: 'profile-a' };
    f.beat(a.installation.id, { seq: 0, state: 'playing', nowPlaying: playing });
    f.transaction(b => {
      const d = findDevice(b, a.installation.id);
      expect(publicDevice(d, { ...f.viewer, profileId: 'profile-b' }, f.now()).nowPlaying).toEqual({ restricted: true });
      expect(publicDevice(d, { ...f.viewer, profileId: undefined }, f.now()).nowPlaying).toEqual({ restricted: true });
      expect(publicDevice(d, f.viewer, f.now()).nowPlaying).toEqual(playing);
      expect(publicDevice(d, { ...f.viewer, role: 'dev', profileId: undefined }, f.now()).nowPlaying).toEqual(playing);
      const view = publicDevice(d, { ...f.viewer, installationId: d.id }, f.now());
      expect(view.isCurrent).toBe(true); expect(view.physicalInput).toBe(true);
      expect(view).not.toHaveProperty('clientHash'); expect(view).not.toHaveProperty('lastSeq');
    });
  });

  it('isolates accounts, validates names/rooms, and revocation invalidates credentials', () => {
    const f = fixture(); const a = f.linked();
    expect(f.linked('client-a', f.other).installation.id).not.toBe(a.installation.id);
    expect(() => f.transaction(b => findDevice(b, a.installation.id), f.other)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => f.transaction(b => rename(b, a.installation.id, ' '.repeat(3), f.viewer, f.now()))).toThrow(expect.objectContaining({ code: 'invalid_name' }));
    f.transaction(b => setRoom(b, a.installation.id, 'Kitchen', f.viewer, f.now()));
    f.transaction(b => setRoom(b, a.installation.id, null, f.viewer, f.now()));
    f.transaction(b => revoke(b, a.installation.id, f.viewer, f.now()));
    expect(() => f.resolve(f.credential(a))).toThrow(expect.objectContaining({ code: 'device_revoked' }));
    expect(() => f.resolve(`${a.installation.id}.${'x'.repeat(43)}`)).toThrow(expect.objectContaining({ code: 'auth_required' }));
  });
});
