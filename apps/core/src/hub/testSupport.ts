import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { createAccountsService } from '../providers/accounts.ts';
import { createHubContext } from './routes.ts';
import { bucket, transactHub } from './store.ts';
import { register, resolveDevice, type Viewer } from './devices.ts';
import { heartbeat } from './presence.ts';
import { ACTION_CAPABILITY } from './vocab.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
export const registrationInput = (clientId = 'client-a') => ({
  clientId, platform: 'roku', name: 'Living room', appVersion: '1.0',
  capabilities: [...new Set(Object.values(ACTION_CAPABILITY)), 'input.physical', 'future.capability'],
});
export function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'tvm-hub-')); dirs.push(dataDir);
  let time = Date.parse('2026-11-17T12:00:00Z');
  const now = () => time;
  const accounts = createAccountsService({ dataDir, termsVersion: 'test', now: () => new Date(time) });
  const ctx = createHubContext({ dataDir, accounts, now });
  const viewer: Viewer = { accountId: 'acc_a', name: 'Ada', role: 'member', profileId: 'profile-a' };
  const other: Viewer = { accountId: 'acc_b', name: 'Grace', role: 'member', profileId: 'profile-b' };
  const linked = (clientId = 'client-a', who = viewer) => ctx.store.transact(d => register(bucket(d, who.accountId), registrationInput(clientId), who, now()));
  const beat = (id: string, value: unknown = { seq: 0, state: 'idle' }, who = viewer) =>
    ctx.store.transact(d => heartbeat(bucket(d, who.accountId).installations[id]!, value, now()));
  const credential = (linkedDevice: ReturnType<typeof linked>) => `${linkedDevice.installation.id}.${linkedDevice.deviceSecret}`;
  const resolve = (value: string) => resolveDevice(ctx.store.read(), value, now());
  const transaction = <T>(work: (b: ReturnType<typeof bucket>) => T, who = viewer) =>
    transactHub(ctx.store, d => work(bucket(d, who.accountId)));
  return { ...ctx, dataDir, viewer, other, linked, beat, credential, resolve, transaction, advance: (ms: number) => { time += ms; } };
}
