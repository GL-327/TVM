import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hashToken } from '../providers/accounts.ts';
import { recordActivity } from './activity.ts';
import { HubError, notFound } from './errors.ts';
import { opaqueId, type AccountBucket, type HubDocument, type Installation } from './store.ts';
import { optionalText, registration, text } from './validation.ts';
import { HEARTBEAT_SEC, type ActivityParty, type Device, type Registration } from './vocab.ts';

export interface Viewer { accountId: string; name: string; role: 'member' | 'dev'; profileId?: string; installationId?: string }
export interface DeviceIdentity { accountId: string; installationId: string }
export function actor(viewer: Viewer): ActivityParty { return { installationId: viewer.installationId ?? null, name: viewer.name }; }
export function deviceParty(device: Installation): ActivityParty { return { installationId: device.id, name: device.name }; }
export function findDevice(b: AccountBucket | undefined, id: string, allowRevoked = false): Installation {
  const device = b?.installations[id];
  if (device === undefined || (!allowRevoked && device.revokedAt !== null)) notFound();
  return device;
}
export function online(device: Installation, now: number): boolean {
  return device.revokedAt === null && device.lastSeenAt !== null && now - Date.parse(device.lastSeenAt) <= 2 * HEARTBEAT_SEC * 1000;
}
export function publicDevice(device: Installation, viewer: Viewer, now: number): Device {
  const present = online(device, now);
  return {
    id: device.id, name: device.name, room: device.room, platform: device.platform, model: device.model,
    appVersion: device.appVersion, build: device.build, slot: device.slot, createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    lastSeenAgeSec: device.lastSeenAt === null ? null : Math.max(0, Math.floor((now - Date.parse(device.lastSeenAt)) / 1000)),
    presence: present ? 'online' : 'offline',
    state: device.revokedAt !== null ? 'revoked' : device.lastSeenAt === null ? 'unknown' : present ? device.state : 'offline',
    isCurrent: viewer.installationId === device.id, capabilities: [...device.capabilities],
    physicalInput: device.capabilities.includes('input.physical'),
    nowPlaying: device.nowPlaying === null || device.revokedAt !== null ? null
      : viewer.role === 'dev' || viewer.profileId === device.nowPlaying.profileId ? { ...device.nowPlaying } : { restricted: true },
  };
}
export function rotateSecret(b: AccountBucket, id: string, now: number): string {
  const secret = randomBytes(32).toString('base64url');
  const previous = b.sessions[id];
  b.sessions[id] = {
    hash: hashToken(secret),
    previous: previous === undefined ? [] : [
      ...previous.previous.filter(p => Date.parse(p.expiresAt) > now),
      { hash: previous.hash, expiresAt: new Date(now + 60_000).toISOString() },
    ],
  };
  return secret;
}
/** Shared by sign-in and pairing. Revoked tombstones keep their original slot. */
export function install(b: AccountBucket, input: Omit<Registration, 'clientId'> & { clientHash: string }, viewer: Viewer, now: number): Installation {
  const existing = Object.values(b.installations).find(d => d.clientHash === input.clientHash && d.revokedAt === null);
  if (existing !== undefined) {
    existing.platform = input.platform; existing.model = input.model; existing.appVersion = input.appVersion;
    existing.build = input.build; existing.capabilities = [...input.capabilities];
    recordActivity(b, now, 'device.signed_in', actor(viewer), deviceParty(existing));
    return existing;
  }
  const used = new Set(Object.values(b.installations).map(d => d.slot));
  let slot = 0;
  while (used.has(slot)) slot += 1;
  const device: Installation = {
    ...input, capabilities: [...input.capabilities], id: opaqueId('inst'), slot, room: null,
    createdAt: new Date(now).toISOString(), lastSeenAt: null, lastSeq: -1, state: 'idle', nowPlaying: null, revokedAt: null,
  };
  b.installations[device.id] = device;
  recordActivity(b, now, 'device.linked', actor(viewer), deviceParty(device));
  return device;
}
export function register(b: AccountBucket, value: unknown, viewer: Viewer, now: number) {
  const { clientId, ...input } = registration(value);
  const device = install(b, { ...input, clientHash: hashToken(clientId) }, viewer, now);
  const deviceSecret = rotateSecret(b, device.id, now);
  return { installation: publicDevice(device, viewer, now), deviceSecret, heartbeatSec: HEARTBEAT_SEC };
}
export function resolveDevice(document: HubDocument, credential: string | undefined, now: number): DeviceIdentity {
  const match = /^(inst_[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(credential ?? '');
  if (match === null) throw new HubError(401, 'auth_required');
  const id = match[1]!;
  const digest = Buffer.from(hashToken(match[2]!), 'hex');
  for (const [accountId, b] of Object.entries(document.accounts)) {
    const device = b.installations[id];
    const session = b.sessions[id];
    if (device === undefined || session === undefined) continue;
    const hashes = [session.hash, ...session.previous.filter(p => Date.parse(p.expiresAt) > now).map(p => p.hash)];
    const valid = hashes.some(h => {
      const expected = Buffer.from(h, 'hex');
      return expected.length === digest.length && timingSafeEqual(expected, digest);
    });
    if (!valid) break;
    if (device.revokedAt !== null) throw new HubError(401, 'device_revoked');
    return { accountId, installationId: id };
  }
  throw new HubError(401, 'auth_required');
}
export function rename(b: AccountBucket, id: string, value: unknown, viewer: Viewer, now: number): Installation {
  const device = findDevice(b, id);
  device.name = text(value, 40, 'invalid_name');
  recordActivity(b, now, 'device.renamed', actor(viewer), deviceParty(device));
  return device;
}
export function setRoom(b: AccountBucket, id: string, value: unknown, viewer: Viewer, now: number): Installation {
  const device = findDevice(b, id);
  if (value === undefined) throw new HubError(400, 'invalid_request');
  device.room = optionalText(value, 80);
  recordActivity(b, now, 'device.room', actor(viewer), deviceParty(device));
  return device;
}
export function revoke(b: AccountBucket, id: string, viewer: Viewer, now: number, signout = false): Installation {
  const device = findDevice(b, id, true);
  if (device.revokedAt === null) {
    device.revokedAt = new Date(now).toISOString(); device.nowPlaying = null;
    for (const c of Object.values(b.commands)) {
      if (c.target === id && (c.status === 'pending' || c.status === 'accepted')) {
        c.status = 'rejected'; c.reason = 'device_revoked'; c.updatedAt = device.revokedAt;
        recordActivity(b, now, 'command.rejected', actor(viewer), deviceParty(device));
      }
    }
    recordActivity(b, now, signout ? 'device.signed_out' : 'device.revoked', actor(viewer), deviceParty(device));
  }
  return device;
}
