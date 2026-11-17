import { recordActivity } from './activity.ts';
import { actor, deviceParty, findDevice, online, type Viewer } from './devices.ts';
import { bad, HubError, notFound } from './errors.ts';
import { opaqueId, type AccountBucket } from './store.ts';
import { bodyObject, identifier, nonnegative, text } from './validation.ts';
import { ACTION_CAPABILITY, type Action, type Command } from './vocab.ts';

/** Copy only action fields; never keep a caller's arbitrary payload. */
function payloadFor(action: Action, value: unknown): Record<string, unknown> {
  const p = value === undefined ? {} : bodyObject(value);
  switch (action) {
    case 'playback.seek':
      if (!nonnegative(p['positionSec'])) bad();
      return { positionSec: p['positionSec'] };
    case 'playback.skip':
      if (typeof p['deltaSec'] !== 'number' || !Number.isFinite(p['deltaSec'])) bad();
      return { deltaSec: p['deltaSec'] };
    case 'nav.dpad':
      if (!['up', 'down', 'left', 'right'].includes(p['direction'] as string)) bad();
      return { direction: p['direction'] };
    case 'play.title': {
      const mediaId = identifier(p['mediaId'], 1024);
      if (p['positionSec'] !== undefined && !nonnegative(p['positionSec'])) bad();
      return { mediaId, ...(p['positionSec'] === undefined ? {} : { positionSec: p['positionSec'] }) };
    }
    case 'play.live_channel': return { channelId: identifier(p['channelId'], 1024) };
    default: return {};
  }
}
export function expireCommands(b: AccountBucket, now: number): void {
  for (const c of Object.values(b.commands)) {
    if (c.status !== 'pending' || now < Date.parse(c.expiresAt)) continue;
    c.status = 'timed_out'; c.reason = null; c.updatedAt = new Date(now).toISOString();
    recordActivity(b, now, 'command.timed_out', { installationId: c.actor.installationId, name: 'Account' },
      { installationId: c.target, name: b.installations[c.target]?.name ?? 'Device' });
  }
}
export function sendCommand(b: AccountBucket, value: unknown, viewer: Viewer, now: number): Command {
  const input = bodyObject(value);
  const key = identifier(input['idempotencyKey'], 200);
  const original = Object.values(b.commands).find(c => c.idempotencyKey === key);
  if (original !== undefined) return original;
  if (input['v'] !== 1) bad();
  const target = findDevice(b, text(input['target'], 100));
  const action = input['action'];
  const known = typeof action === 'string' && Object.hasOwn(ACTION_CAPABILITY, action);
  if (known && !target.capabilities.includes(ACTION_CAPABILITY[action as Action])) throw new HubError(409, 'unsupported');
  if (!online(target, now)) throw new HubError(409, 'target_offline');
  if (!known) bad('invalid_action');
  const ttl = input['ttlSec'] ?? 30;
  if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0 || ttl > 120) bad();
  if (input['stateVersion'] !== undefined && (!Number.isSafeInteger(input['stateVersion']) || (input['stateVersion'] as number) < 0)) bad();
  const payload = payloadFor(action as Action, input['payload']);
  const c: Command = {
    id: opaqueId('cmd'), idempotencyKey: key, actor: { accountId: viewer.accountId, installationId: viewer.installationId ?? null },
    target: target.id, action: action as Action, payload, createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl * 1000).toISOString(), seq: b.nextSeq++, status: 'pending', reason: null,
    updatedAt: new Date(now).toISOString(), ...(input['stateVersion'] === undefined ? {} : { stateVersion: input['stateVersion'] as number }),
  };
  b.commands[c.id] = c;
  recordActivity(b, now, 'command.sent', actor(viewer), deviceParty(target));
  return c;
}
export function getCommand(b: AccountBucket | undefined, id: string): Command {
  return b?.commands[id] ?? notFound();
}
export function inbox(b: AccountBucket, installationId: string, after: number): Command[] {
  return Object.values(b.commands).filter(c => c.target === installationId && c.status === 'pending' && c.seq > after)
    .sort((a, z) => a.seq - z.seq);
}
export function ack(b: AccountBucket, id: string, installationId: string, value: unknown, now: number): Command {
  const c = getCommand(b, id);
  if (c.target !== installationId) notFound();
  const input = bodyObject(value);
  const status = input['status'];
  if (!['accepted', 'applied', 'rejected'].includes(status as string)) bad();
  const allowed = (c.status === 'pending' && (status === 'accepted' || status === 'rejected'))
    || (c.status === 'accepted' && (status === 'applied' || status === 'rejected'));
  if (!allowed) throw new HubError(409, 'invalid_transition');
  const reason = input['reason'] === undefined || input['reason'] === null ? null : text(input['reason'], 200);
  c.status = status as Command['status']; c.reason = reason; c.updatedAt = new Date(now).toISOString();
  if (c.status === 'applied' || c.status === 'rejected') {
    const target = findDevice(b, installationId);
    recordActivity(b, now, c.status === 'applied' ? 'command.applied' : 'command.rejected', deviceParty(target), deviceParty(target));
  }
  return c;
}
