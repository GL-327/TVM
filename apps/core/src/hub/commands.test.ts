import { describe, expect, it, vi } from 'vitest';
import { ack, expireCommands, getCommand, inbox, sendCommand } from './commands.ts';
import { revoke } from './devices.ts';
import { fixture } from './testSupport.ts';

// Exercise real sealing/storage independently of the OS credential wrapper.
vi.mock('../providers/secureFile.ts', async original => ({ ...await original<typeof import('../providers/secureFile.ts')>(), windowsProtect: (value: string) => value }));

function ready() {
  const f = fixture(); const target = f.linked(); f.beat(target.installation.id);
  let key = 0;
  const send = (overrides: Record<string, unknown> = {}) => f.transaction(b => sendCommand(b, {
    v: 1, idempotencyKey: `key-${++key}`, target: target.installation.id, action: 'playback.pause', ...overrides,
  }, f.viewer, f.now()));
  const apply = (id: string, status: string, device = target.installation.id) => f.transaction(b => {
    expireCommands(b, f.now()); return ack(b, id, device, { status }, f.now());
  });
  return { ...f, target, send, apply };
}
describe('Hub commands', () => {
  it('deduplicates keys within one account even when retried with different content', () => {
    const f = ready(); const c = f.send({ idempotencyKey: 'same', stateVersion: 4 });
    expect(f.send({ idempotencyKey: 'same', action: 'unknown', target: 'bad' })).toEqual(c);
    expect(c).toMatchObject({ seq: 1, status: 'pending', stateVersion: 4 });
    const other = f.linked('other', f.other); f.beat(other.installation.id, undefined, f.other);
    const different = f.transaction(b => sendCommand(b, { v: 1, target: other.installation.id, action: 'nav.back', idempotencyKey: 'same' }, f.other, f.now()), f.other);
    expect(different.id).not.toBe(c.id);
  });
  it('checks account ownership, capability, liveness and known actions', () => {
    const f = ready();
    const foreign = f.linked('foreign', f.other);
    expect(() => f.send({ target: foreign.installation.id })).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => f.transaction(b => getCommand(b, 'cmd_missing'), f.other)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => f.send({ action: 'unknown' })).toThrow(expect.objectContaining({ code: 'invalid_action' }));
    f.beat(f.target.installation.id, { seq: 1, state: 'idle', capabilities: ['nav.back'] });
    expect(() => f.send()).toThrow(expect.objectContaining({ code: 'unsupported' }));
    f.advance(60_001);
    expect(() => f.send({ action: 'nav.back' })).toThrow(expect.objectContaining({ code: 'target_offline' }));
  });

  it('treats idempotency keys as exact opaque strings', () => {
    const f = ready();
    const a = f.send({ idempotencyKey: 'key' }); const b = f.send({ idempotencyKey: ' key ' });
    expect(b.id).not.toBe(a.id); expect(b.idempotencyKey).toBe(' key ');
  });
  it.each([
    { v: 2 }, { ttlSec: 0 }, { ttlSec: 121 }, { ttlSec: '30' }, { stateVersion: -1 },
    { action: 'playback.seek', payload: { positionSec: -1 } },
    { action: 'playback.skip', payload: { deltaSec: '5' } },
    { action: 'nav.dpad', payload: { direction: 'diagonal' } },
    { action: 'play.title', payload: {} }, { action: 'play.live_channel', payload: {} },
  ])('validates the command envelope and action payload: %j', invalid => {
    const f = ready(); expect(() => f.send(invalid)).toThrow(expect.objectContaining({ status: 400 }));
  });
  it.each([
    ['playback.seek', { positionSec: 10 }], ['playback.skip', { deltaSec: -10 }], ['nav.dpad', { direction: 'left' }],
    ['play.title', { mediaId: 'm', positionSec: 20 }], ['play.live_channel', { channelId: 'c' }],
  ])('accepts %s and carries only its defined fields', (action, payload) => {
    const f = ready(); const c = f.send({ action, payload: { ...payload, secret: 'do not carry' } });
    expect(c.payload).toEqual(payload);
  });
  it('lazily expires pending commands, persists timeout after a refused ack, and retains accepted ones', () => {
    const f = ready(); const pending = f.send({ ttlSec: 1 }); const accepted = f.send({ ttlSec: 1 });
    f.apply(accepted.id, 'accepted'); f.advance(1001);
    expect(() => f.apply(pending.id, 'accepted')).toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    const b = f.store.read().accounts[f.viewer.accountId]!;
    expect(getCommand(b, pending.id).status).toBe('timed_out');
    expect(getCommand(b, accepted.id).status).toBe('accepted');
    expect(f.apply(accepted.id, 'applied').status).toBe('applied');
  });
  it('allows only monotonic transitions, with target-only acknowledgements', () => {
    const f = ready(); const c = f.send(); const another = f.linked('another');
    expect(() => f.apply(c.id, 'accepted', another.installation.id)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => f.apply(c.id, 'applied')).toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    f.apply(c.id, 'accepted');
    expect(() => f.apply(c.id, 'accepted')).toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    f.apply(c.id, 'applied');
    expect(() => f.apply(c.id, 'rejected')).toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    const rejected = f.send(); expect(f.apply(rejected.id, 'rejected').status).toBe('rejected');
    const fromAccepted = f.send(); f.apply(fromAccepted.id, 'accepted');
    expect(f.apply(fromAccepted.id, 'rejected').status).toBe('rejected');
  });
  it('orders inbox entries by sequence, filtering cursor, target, accepted and expired commands', () => {
    const f = ready(); const a = f.send(); const b = f.send(); const expired = f.send({ ttlSec: 1 }); const accepted = f.send();
    f.apply(accepted.id, 'accepted'); const another = f.linked('another'); f.beat(another.installation.id);
    f.send({ target: another.installation.id }); f.advance(1001);
    const result = f.transaction(store => { expireCommands(store, f.now()); return inbox(store, f.target.installation.id, a.seq); });
    expect(result.map(c => c.id)).toEqual([b.id]);
    expect(f.transaction(store => getCommand(store, expired.id)).status).toBe('timed_out');
  });
  it('revocation rejects pending and accepted commands while preserving applied commands', () => {
    const f = ready(); const a = f.send(); const b = f.send(); const c = f.send();
    f.apply(b.id, 'accepted'); f.apply(c.id, 'accepted'); f.apply(c.id, 'applied');
    f.transaction(store => revoke(store, f.target.installation.id, f.viewer, f.now()));
    const store = f.store.read().accounts[f.viewer.accountId]!;
    expect([store.commands[a.id]?.status, store.commands[b.id]?.status, store.commands[c.id]?.status]).toEqual(['rejected', 'rejected', 'applied']);
    expect(store.commands[a.id]?.reason).toBe('device_revoked');
    expect(() => f.send()).toThrow(expect.objectContaining({ status: 404 }));
  });
});
