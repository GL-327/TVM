import type { SyncItem } from './schema.ts';
import { itemId, valueHash, type SnapshotItem } from './stores.ts';

export interface ItemVersion { updatedAt: number; hash: string | null }
export interface SyncLedger {
  versions: Record<string, ItemVersion>;
  pending: Record<string, SyncItem>;
}

/** A missing local row becomes a tombstone only once this device has actually seen it. */
export function observeLocal(ledger: SyncLedger, local: ReadonlyMap<string, SnapshotItem>, now: number): boolean {
  let changed = false;
  for (const [id, row] of local) {
    const prior = ledger.versions[id];
    if (prior?.hash === row.hash) continue;
    const updatedAt = prior ? Math.max(prior.updatedAt + 1, Math.min(row.changedAt, now)) : row.item.updatedAt;
    ledger.versions[id] = { updatedAt, hash: row.hash };
    ledger.pending[id] = { ...row.item, updatedAt };
    changed = true;
  }
  for (const [id, version] of Object.entries(ledger.versions)) {
    if (version.hash === null || local.has(id)) continue;
    const split = id.indexOf(':');
    const updatedAt = Math.max(now, version.updatedAt + 1);
    ledger.versions[id] = { updatedAt, hash: null };
    ledger.pending[id] = { kind: id.slice(0, split) as SyncItem['kind'], key: id.slice(split + 1),
      value: null, updatedAt, deleted: true };
    changed = true;
  }
  return changed;
}

export function mergeRemote(ledger: SyncLedger, incoming: readonly SyncItem[]): SyncItem[] {
  const changes: SyncItem[] = [];
  for (const item of incoming) {
    const id = itemId(item);
    const prior = ledger.versions[id];
    if (prior && prior.updatedAt > item.updatedAt) continue;
    const hash = item.deleted ? null : valueHash(item.value);
    // On a tie the server's first accepted value is authoritative.
    delete ledger.pending[id];
    ledger.versions[id] = { updatedAt: item.updatedAt, hash };
    if (!prior || prior.hash !== hash) changes.push(item);
  }
  return changes;
}
