import { readFileSync } from 'node:fs';
import { readSealed, writeSealed } from './vault.ts';

/** Migrate only valid legacy JSON, never treat unreadable ciphertext as data. */
export function readPrivateJson<T>(dataDir: string, path: string): T | null {
  const encrypted = readSealed<T>(dataDir, path);
  if (encrypted !== null) return encrypted;
  try {
    const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!text.startsWith('{') && !text.startsWith('[')) return null;
    const value = JSON.parse(text) as T;
    writeSealed(dataDir, path, value);
    return value;
  } catch {
    return null;
  }
}
