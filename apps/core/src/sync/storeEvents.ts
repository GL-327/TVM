import { basename, dirname } from 'node:path';

const listeners = new Map<string, () => void>();

export function watchSyncStores(directory: string, changed: () => void): () => void {
  listeners.set(directory, changed);
  return () => {
    if (listeners.get(directory) === changed) listeners.delete(directory);
  };
}

export function syncStoreChanged(directory: string): void {
  const parent = dirname(directory);
  const root = basename(parent) === 'profiles' ? dirname(parent) : directory;
  listeners.get(root)?.();
}

export function isSyncProfileDirectory(directory: string): boolean {
  return listeners.has(dirname(dirname(directory)));
}
