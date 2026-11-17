import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openJson, sealJson } from '../providers/vault.ts';
import { hubPath, masterKeyPath } from '../update/paths.ts';
import { HubError, HubUnavailableError } from './errors.ts';
import { object } from './validation.ts';
import { ACTIONS, ACTIVITY_TYPES, PLATFORMS, type Activity, type Command, type NowPlaying, type Registration } from './vocab.ts';

export { HubUnavailableError } from './errors.ts';
export interface Installation extends Omit<Registration, 'clientId'> {
  id: string; clientHash: string; slot: number; room: string | null; createdAt: string;
  lastSeenAt: string | null; lastSeq: number; state: 'idle' | 'playing' | 'paused';
  nowPlaying: NowPlaying | null; revokedAt: string | null;
}
export interface DeviceSession {
  hash: string; previous: { hash: string; expiresAt: string }[];
}
export interface Pair {
  id: string; deviceHash: string; userHash: string; salt: string; input: Omit<Registration, 'clientId'> & { clientHash: string };
  requestedAt: string; expiresAt: string; interval: number; lastPollAt: string | null;
  status: 'pending' | 'approved' | 'denied' | 'consumed' | 'expired'; finishedAt: string | null;
  installationId: string | null; accountToken: string | null;
}
export interface AccountBucket {
  installations: Record<string, Installation>; sessions: Record<string, DeviceSession>;
  commands: Record<string, Command>; pairs: Record<string, Pair>; activity: Activity[]; nextSeq: number;
}
export interface HubDocument {
  schema: 1; rev: number; accounts: Record<string, AccountBucket>;
  /** Starts have no account until somebody approves or denies them. */
  unassignedPairs: Record<string, Pair>;
}
export function opaqueId(prefix: string): string { return `${prefix}_${randomBytes(16).toString('base64url')}`; }
export function bucket(document: HubDocument, accountId: string): AccountBucket {
  return document.accounts[accountId] ??= { installations: {}, sessions: {}, commands: {}, pairs: {}, activity: [], nextSeq: 1 };
}
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const nullableDate = (v: unknown): boolean => v === null || date(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');
const nullableString = (v: unknown): boolean => v === null || typeof v === 'string';
function validInput(v: unknown): boolean {
  return object(v) && typeof v['clientHash'] === 'string' && typeof v['name'] === 'string'
    && PLATFORMS.includes(v['platform'] as Registration['platform']) && nullableString(v['model'])
    && typeof v['appVersion'] === 'string' && nullableString(v['build']) && strings(v['capabilities']);
}
function validPlaying(v: unknown): boolean {
  return v === null || (object(v) && typeof v['mediaId'] === 'string' && typeof v['title'] === 'string'
    && nullableString(v['artworkUrl']) && typeof v['profileId'] === 'string'
    && typeof v['positionSec'] === 'number' && Number.isFinite(v['positionSec']) && v['positionSec'] >= 0
    && (v['durationSec'] === null || (typeof v['durationSec'] === 'number' && Number.isFinite(v['durationSec']) && v['durationSec'] >= 0)));
}
function validPair(v: unknown): boolean {
  return object(v) && typeof v['id'] === 'string' && typeof v['deviceHash'] === 'string' && typeof v['userHash'] === 'string'
    && typeof v['salt'] === 'string' && validInput(v['input']) && date(v['requestedAt']) && date(v['expiresAt'])
    && integer(v['interval']) && v['interval'] >= 5 && nullableDate(v['lastPollAt']) && nullableDate(v['finishedAt'])
    && ['pending', 'approved', 'denied', 'consumed', 'expired'].includes(v['status'] as string)
    && nullableString(v['installationId']) && nullableString(v['accountToken']);
}
function recordOf(v: unknown, validate: (entry: unknown) => boolean): boolean {
  return object(v) && Object.values(v).every(validate);
}
function validDocument(v: unknown): v is HubDocument {
  if (!object(v) || v['schema'] !== 1 || !integer(v['rev']) || !recordOf(v['unassignedPairs'], validPair)) return false;
  return recordOf(v['accounts'], b => {
    if (!object(b) || !integer(b['nextSeq']) || b['nextSeq'] < 1) return false;
    const installations = b['installations'];
    if (!recordOf(installations, i => object(i) && validInput(i) && typeof i['id'] === 'string'
      && integer(i['slot']) && nullableString(i['room']) && date(i['createdAt']) && nullableDate(i['lastSeenAt'])
      && Number.isSafeInteger(i['lastSeq']) && (i['lastSeq'] as number) >= -1
      && ['idle', 'playing', 'paused'].includes(i['state'] as string) && validPlaying(i['nowPlaying']) && nullableDate(i['revokedAt']))) return false;
    if (!object(installations) || Object.entries(installations).some(([id, i]) => !object(i) || i['id'] !== id)) return false;
    if (!recordOf(b['sessions'], s => object(s) && typeof s['hash'] === 'string' && Array.isArray(s['previous'])
      && s['previous'].every(p => object(p) && typeof p['hash'] === 'string' && date(p['expiresAt'])))) return false;
    if (!recordOf(b['commands'], c => object(c) && typeof c['id'] === 'string' && typeof c['idempotencyKey'] === 'string'
      && object(c['actor']) && typeof c['actor']['accountId'] === 'string' && nullableString(c['actor']['installationId'])
      && typeof c['target'] === 'string' && ACTIONS.includes(c['action'] as Command['action']) && object(c['payload'])
      && date(c['createdAt']) && date(c['expiresAt']) && integer(c['seq']) && date(c['updatedAt']) && nullableString(c['reason'])
      && ['pending', 'accepted', 'applied', 'rejected', 'timed_out'].includes(c['status'] as string))) return false;
    const party = (p: unknown): boolean => object(p) && nullableString(p['installationId']) && typeof p['name'] === 'string';
    return recordOf(b['pairs'], validPair) && Array.isArray(b['activity']) && b['activity'].every(e => object(e)
      && typeof e['id'] === 'string' && date(e['at']) && ACTIVITY_TYPES.includes(e['type'] as Activity['type'])
      && party(e['actor']) && party(e['target']) && nullableString(e['detail']));
  });
}

export function prune(document: HubDocument, now: number): void {
  const pairs = (entries: Record<string, Pair>): void => {
    for (const [id, pair] of Object.entries(entries)) {
      if (now >= Date.parse(pair.expiresAt) && (pair.status === 'pending' || pair.status === 'approved')) {
        pair.status = 'expired'; pair.finishedAt = pair.expiresAt; pair.accountToken = null;
      }
      if (pair.finishedAt !== null && now - Date.parse(pair.finishedAt) >= 3_600_000) delete entries[id];
    }
  };
  pairs(document.unassignedPairs);
  for (const b of Object.values(document.accounts)) {
    pairs(b.pairs);
    for (const [id, c] of Object.entries(b.commands)) if (now - Date.parse(c.createdAt) >= 86_400_000) delete b.commands[id];
    for (const session of Object.values(b.sessions)) session.previous = session.previous.filter(p => Date.parse(p.expiresAt) > now);
    b.activity = b.activity.filter(e => now - Date.parse(e.at) < 90 * 86_400_000).slice(-500);
  }
}

/** Synchronous transactions do not yield between validation, mutation and rename. */
export function createHubStore(dataDir: string, now: () => number = Date.now) {
  const path = hubPath(dataDir);
  let observed = false;
  function read(): HubDocument {
    try {
      // statSync distinguishes ENOENT from EACCES; existsSync would hide IO errors.
      const stat = statSync(path, { throwIfNoEntry: false });
      if (stat === undefined) {
        if (observed || statSync(`${path}.bak`, { throwIfNoEntry: false }) !== undefined) throw new HubUnavailableError();
        return { schema: 1, rev: 0, accounts: {}, unassignedPairs: {} };
      }
      observed = true;
      // openJson must never create a replacement key for an existing Hub.
      if (!existsSync(masterKeyPath(dataDir))) throw new HubUnavailableError();
      const value = openJson<unknown>(dataDir, readFileSync(path, 'utf8'));
      if (!validDocument(value)) throw new HubUnavailableError();
      return value;
    } catch (error) { throw new HubUnavailableError(error); }
  }
  function durableWrite(target: string, contents: string): void {
    const temp = `${target}.${opaqueId('tmp')}`;
    let fd: number | undefined;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, contents, 'utf8'); fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temp, target);
    } finally {
      if (fd !== undefined) closeSync(fd);
      rmSync(temp, { force: true });
    }
  }
  return {
    read,
    transact<T>(work: (document: HubDocument) => T): T {
      const document = read();
      const before = JSON.stringify(document);
      prune(document, now());
      const result = work(document);
      if (JSON.stringify(document) !== before) {
        document.rev += 1;
        try {
          mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
          const sealed = sealJson(dataDir, document);
          if (existsSync(path)) durableWrite(`${path}.bak`, readFileSync(path, 'utf8'));
          durableWrite(path, sealed);
          observed = true;
          // Windows cannot open directories for fsync. The files themselves are flushed above.
          if (process.platform !== 'win32') {
            const fd = openSync(dirname(path), 'r');
            try { fsyncSync(fd); } finally { closeSync(fd); }
          }
        } catch (error) { throw new HubUnavailableError(error); }
      }
      return result;
    },
  };
}
export type HubStore = ReturnType<typeof createHubStore>;

/** Persist lazy expiry and polling counters even when returning a protocol error. */
export function transactHub<T>(store: HubStore, work: (document: HubDocument) => T): T {
  const outcome = store.transact(document => {
    try { return { value: work(document) }; }
    catch (error) {
      if (error instanceof HubError) return { error };
      throw error;
    }
  });
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}
